import { readFileSync } from 'node:fs';
import type { Action } from '../actions.js';
import { hashFile, sha256, type Ctx } from '../fs/ctx.js';
import { applyBlock } from '../fs/blocks.js';
import { applyJsonMerge, trackJsonBefore } from '../fs/json-merge.js';
import type { Runner } from '../run/runner.js';
import { loadState, saveState, type AppliedAction, type CopyUndo, type InstalledItem, type State } from '../state/state.js';
import { splitShared, type PlanEntry } from './plan.js';
import { snapshotPaths } from './snapshot.js';

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Copies unless the target already holds the same bytes (then nothing is owned: afterHash null). */
function applyCopy(ctx: Ctx, a: Extract<Action, { kind: 'copy' }>): CopyUndo {
  const cur = hashFile(a.to);
  if (cur !== null && cur === sha256(readFileSync(a.from))) {
    return { originalHash: cur, afterHash: null, backupPath: null, createdDirs: [] };
  }
  const w = ctx.copy(a.from, a.to, a.mode);
  return { originalHash: w.beforeHash, afterHash: w.afterHash, backupPath: w.backupPath, createdDirs: w.createdDirs };
}

/**
 * Applies one action and records it in `rec`, saving state after it. A `run` action is recorded
 * as pending and saved before the command executes, so a crash or failure still leaves a trace;
 * the pending flag is cleared once it succeeds.
 */
async function applyOne(a: Action, rec: InstalledItem, st: State, ctx: Ctx, runner: Runner): Promise<void> {
  const save = () => saveState(ctx.home, st, ctx.dryRun);
  let applied: AppliedAction;
  if (a.kind === 'json-merge') applied = { ...a, undoData: applyJsonMerge(ctx, a.file, a.patch) };
  else if (a.kind === 'block') applied = { ...a, undoData: applyBlock(ctx, a.file, a.id, a.body, a.style) };
  else if (a.kind === 'copy') applied = { ...a, undoData: applyCopy(ctx, a) };
  else {
    const snap = () => (a.snapshot?.length ? snapshotPaths(a.snapshot) : {});
    const r: AppliedAction = { ...a, undoData: { snapshotBefore: snap(), snapshotAfter: {}, pending: true } };
    if (a.jsonTrack) r.undoData.jsonBefore = trackJsonBefore(ctx, a.jsonTrack);
    rec.actions.push(r);
    save();
    await runner.run(a.cmd);
    r.undoData.snapshotAfter = snap();
    delete r.undoData.pending;
    save();
    return;
  }
  rec.actions.push(applied);
  save();
}

/** The first id in `failed` that `e` requires, directly or through other plan items (R30). */
function failedRequirement(e: PlanEntry, plan: PlanEntry[], failed: Set<string>): string | undefined {
  const byId = new Map(plan.map((p) => [p.item.id, p.item]));
  const seen = new Set<string>();
  const walk = (reqs: string[]): string | undefined => {
    for (const r of reqs) {
      if (seen.has(r)) continue;
      seen.add(r);
      if (failed.has(r)) return r;
      const hit = walk(byId.get(r)?.requires ?? []);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(e.item.requires ?? []);
}

/**
 * Applies the `install` entries of a plan: per item, the shared actions (skills, commands), then
 * each agent's actions, then `post_install`. State is saved after every action. A failing action
 * stops its item (what was applied stays recorded, for uninstall, with `complete: false`) and the
 * next item goes on; an item that requires a failed item is skipped and counts as failed (R30).
 * An entry for an item already in state (installed for more agents, R23) merges its actions and
 * agents into the existing record.
 */
export async function applyPlan(plan: PlanEntry[], ctx: Ctx, runner: Runner): Promise<{
  installed: string[]; failed: { id: string; error: string }[];
}> {
  const st = loadState(ctx.home);
  const save = () => saveState(ctx.home, st, ctx.dryRun);
  const installed: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const failedIds = new Set<string>();
  for (const e of plan) {
    if (e.status !== 'install') continue;
    const dep = failedRequirement(e, plan, failedIds);
    if (dep) {
      // Not added to failedIds: dependents name the item that actually failed (found transitively).
      failed.push({ id: e.item.id, error: `skipped: requires ${dep}, which failed` });
      continue;
    }
    const { pre, post } = splitShared(e);
    const agents = e.perAgent.filter((p) => p.actions.length || !p.already.length).map((p) => p.agent);
    const prev = st.items[e.item.id];
    const rec: InstalledItem = prev ?? { id: e.item.id, agents: [], installedAt: new Date().toISOString(), actions: [], complete: false };
    const before = { agents: rec.agents, n: rec.actions.length };
    rec.agents = [...new Set([...rec.agents, ...agents])];
    rec.complete = false;
    st.items[e.item.id] = rec;
    try {
      for (const a of [...pre, ...e.perAgent.flatMap((p) => p.actions), ...post]) {
        await applyOne(a, rec, st, ctx, runner);
      }
      rec.complete = true;
      save();
      installed.push(e.item.id);
    } catch (err) {
      failed.push({ id: e.item.id, error: errText(err) });
      failedIds.add(e.item.id);
      if (rec.actions.length === before.n) {
        // Nothing was applied: a new record goes, an existing one is back as it was.
        if (prev) Object.assign(rec, { agents: before.agents, complete: true });
        else delete st.items[e.item.id];
        save();
      }
    }
  }
  return { installed, failed };
}
