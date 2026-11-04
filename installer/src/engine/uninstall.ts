import { hashFile, type Ctx } from '../fs/ctx.js';
import { undoBlock } from '../fs/blocks.js';
import { undoJsonMerge, undoJsonTrack, type UndoResult } from '../fs/json-merge.js';
import type { Runner } from '../run/runner.js';
import { loadState, saveState, type AppliedAction } from '../state/state.js';
import { sameSnapshot, snapshotPaths } from './snapshot.js';

/** `done`: nothing of this action is left to undo, so it leaves state. `note`: tell the user. */
type Outcome = { done: boolean; note?: string };

const LEFT_ALONE = 'left alone: edited since install';

function fromUndo(r: UndoResult, file: string): Outcome {
  if (r.status === 'skipped') return { done: false, note: `${file} (${LEFT_ALONE})` };
  if (r.status === 'missing') return { done: true, note: `${file} (already gone: removed since install)` };
  if (r.userChanged) return { done: true, note: `${file} (edited since install: removed only our part)` };
  return { done: true };
}

function undoCopy(ctx: Ctx, a: Extract<AppliedAction, { kind: 'copy' }>): Outcome {
  const u = a.undoData;
  if (u.afterHash === null) return { done: true };
  const cur = hashFile(a.to);
  if (cur === null) {
    ctx.removeEmptyDirs(u.createdDirs);
    return { done: true, note: `${a.to} (already gone: removed since install)` };
  }
  if (cur !== u.afterHash) return { done: false, note: `${a.to} (${LEFT_ALONE})` };
  if (u.originalHash === null) ctx.remove(a.to);
  else if (u.backupPath && hashFile(u.backupPath) === u.originalHash) ctx.copy(u.backupPath, a.to);
  else return { done: false, note: `${a.to} (left alone: backup of the original is missing)` };
  ctx.removeEmptyDirs(u.createdDirs);
  return { done: true };
}

/** Runs the action's `undo` (a pending run may have half-run, so its undo may fail), then checks the snapshot. */
async function undoRun(ctx: Ctx, runner: Runner, a: Extract<AppliedAction, { kind: 'run' }>): Promise<Outcome> {
  if (a.undo) await runner.run(a.undo, { allowFail: a.undoData.pending === true });
  if (!ctx.dryRun && a.jsonTrack && a.undoData.jsonBefore) undoJsonTrack(ctx, a.jsonTrack, a.undoData.jsonBefore);
  if (ctx.dryRun || !a.snapshot?.length) return { done: true };
  if (sameSnapshot(snapshotPaths(a.snapshot), a.undoData.snapshotBefore)) return { done: true };
  return { done: true, note: `${a.snapshot.join(', ')} (differs from before install after \`${a.undo ?? a.cmd}\`)` };
}

async function undoOne(ctx: Ctx, runner: Runner, a: AppliedAction): Promise<Outcome> {
  switch (a.kind) {
    case 'json-merge': return fromUndo(undoJsonMerge(ctx, a.file, a.undoData), a.file);
    case 'block': return fromUndo(undoBlock(ctx, a.file, a.id, a.style, a.undoData), a.file);
    case 'copy': return undoCopy(ctx, a);
    case 'run': return undoRun(ctx, runner, a);
  }
}

const target = (a: AppliedAction): string => (a.kind === 'run' ? a.cmd : a.kind === 'copy' ? a.to : a.file);
const createdDirs = (a: AppliedAction): string[] => (a.kind === 'run' ? [] : a.undoData.createdDirs);

/**
 * Reverses the recorded actions of `ids`, items in reverse install order and each item's actions
 * in reverse order, saving state after each one. An action that could not be undone (the user
 * edited our part, or its undo failed) is reported in `userChanged` and stays in state; an item
 * counts as removed only when all its actions were undone. Empty dirs the item created go last.
 */
export async function uninstall(ids: string[], ctx: Ctx, runner: Runner): Promise<{
  removed: string[]; userChanged: string[];
}> {
  const st = loadState(ctx.home);
  const save = () => saveState(ctx.home, st, ctx.dryRun);
  const removed: string[] = [];
  const userChanged: string[] = [];
  for (const id of Object.keys(st.items).filter((k) => ids.includes(k)).reverse()) {
    const rec = st.items[id];
    const dirs = rec.actions.flatMap(createdDirs);
    for (let i = rec.actions.length - 1; i >= 0; i--) {
      const a = rec.actions[i];
      let o: Outcome;
      try {
        o = await undoOne(ctx, runner, a);
      } catch (e) {
        o = { done: false, note: `${target(a)} (undo failed: ${e instanceof Error ? e.message : String(e)})` };
      }
      if (o.note) userChanged.push(`${id}: ${o.note}`);
      if (o.done) {
        rec.actions.splice(i, 1);
        save();
      }
    }
    ctx.removeEmptyDirs(dirs);
    if (rec.actions.length === 0) {
      delete st.items[id];
      removed.push(id);
      save();
    }
  }
  return { removed, userChanged };
}
