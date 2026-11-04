import { existsSync, readFileSync } from 'node:fs';
import type { Action } from '../actions.js';
import { adapters, skillActions, type Adapter } from '../adapters/index.js';
import { q } from '../adapters/shared.js';
import { pluginMarketplace } from '../adapters/claude-code.js';
import { hasBinary, type Env } from '../detect.js';
import type { AgentId, InstallSpec, Item, Manifest } from '../manifest/types.js';
import type { Runner } from '../run/runner.js';
import { mergeJson } from '../fs/json-merge.js';
import { isComplete, type State } from '../state/state.js';

export interface AgentPlan {
  agent: AgentId;
  actions: Action[];
  /** InstallSpec fields the item uses that this agent cannot take ("not available for X"). */
  unsupported: (keyof InstallSpec)[];
  /** Parts already set up outside agentic-setup for this agent; no action is planned for them. */
  already: string[];
}

export interface PlanEntry {
  item: Item;
  /** `partial`: in state but not fully installed (R23); uninstall it, then install again. */
  status: 'install' | 'already' | 'skip-conflict' | 'unsupported' | 'partial';
  perAgent: AgentPlan[];
  /** Agent-independent actions in order: skills, `commands`, then `post_install` (see splitShared). */
  shared: Action[];
  reason?: string;
  /** User JSON values the merges keep, and what they add into those objects (R27). */
  kept?: string[];
  /** Installed already for other agents: this entry adds agents to the record (R23). */
  addsAgents?: boolean;
}

/** Fields handled once per item by the engine, not by adapters. */
const SHARED_FIELDS: (keyof InstallSpec)[] = ['skills', 'commands', 'commands_unless'];

/** `shared` split into what runs before the per-agent actions and the trailing `post_install` runs. */
export function splitShared(e: PlanEntry): { pre: Action[]; post: Action[] } {
  if (e.addsAgents) return { pre: e.shared, post: [] };
  const n = e.item.post_install?.length ?? 0;
  return { pre: e.shared.slice(0, e.shared.length - n), post: e.shared.slice(e.shared.length - n) };
}

/** Binary name of a non-item `requires` entry such as `node>=20`. */
export const requiredBinary = (r: string): string => r.split('>=')[0].trim();

/** `ids` plus the item ids they require (transitively), dependencies first. */
function expand(m: Manifest, ids: string[]): Item[] {
  const byId = new Map(m.items.map((i) => [i.id, i]));
  const out: Item[] = [];
  const seen = new Set<string>();
  const visit = (id: string, chain: string[]): void => {
    if (seen.has(id)) return;
    const item = byId.get(id);
    if (!item) throw new Error(`unknown item "${id}"${chain.length ? ` (required by ${chain.at(-1)})` : ''}`);
    if (chain.includes(id)) throw new Error(`requires cycle: ${[...chain, id].join(' -> ')}`);
    for (const r of item.requires ?? []) if (byId.has(r)) visit(r, [...chain, id]);
    seen.add(id);
    out.push(item);
  };
  for (const id of ids) visit(id, []);
  return out;
}

/** InstallSpec fields the item uses that `agent` cannot take. A hook spec only for other agents counts. */
export function unsupportedFields(item: Item, agent: AgentId, ad: Adapter = adapters[agent]): (keyof InstallSpec)[] {
  return (Object.keys(item.install) as (keyof InstallSpec)[]).filter((k) => {
    const v = item.install[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0) || SHARED_FIELDS.includes(k)) return false;
    if (!ad.supports(k)) return true;
    return k === 'hooks' && !item.install.hooks?.[agent];
  });
}

/** Drops an mcp `run` action when the agent already has a server of that name (readOnly probe). */
async function existingMcp(item: Item, agent: AgentId, runner: Runner): Promise<boolean> {
  const name = item.install.mcp?.name;
  if (!name) return false;
  if (agent === 'claude-code') {
    return (await runner.run(`claude mcp get ${q(name)}`, { allowFail: true, readOnly: true })).code === 0;
  }
  if (agent === 'command-code') {
    const r = await runner.run('cmd mcp list', { allowFail: true, readOnly: true });
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return r.code === 0 && new RegExp(`(^|[\\s"'\`])${esc}($|[\\s"'\`:])`, 'm').test(r.stdout);
  }
  return false;
}

/**
 * True only when `claude plugin marketplace list --json` ran (readOnly) and does not list `mk`.
 * A failed or unparsable probe counts as "maybe present", so a user's marketplace is never removed.
 */
async function marketplaceAbsent(mk: string, runner: Runner): Promise<boolean> {
  const r = await runner.run('claude plugin marketplace list --json', { allowFail: true, readOnly: true });
  if (r.code !== 0) return false;
  try {
    const list: unknown = JSON.parse(r.stdout);
    return Array.isArray(list) && !list.some((m) => (m as { name?: unknown })?.name === mk);
  } catch {
    return false;
  }
}

const isMarketplaceAdd = (a: Action): boolean => a.kind === 'run' && a.cmd.startsWith('claude plugin marketplace add ');

const isMcpAdd = (a: Action): boolean =>
  a.kind === 'run' && /^(claude|cmd) mcp add(-json)? /.test(a.cmd);

async function agentPlan(item: Item, agent: AgentId, env: Env, runner: Runner, repoRoot: string): Promise<AgentPlan> {
  const ad = adapters[agent];
  const unsupported = unsupportedFields(item, agent);
  const already = ad.alreadyInstalled?.(item, env) ?? [];
  let actions = ad.actions(item, env, repoRoot);
  if (actions.some(isMcpAdd) && await existingMcp(item, agent, runner)) {
    actions = actions.filter((a) => !isMcpAdd(a));
    already.push(`mcp server "${item.install.mcp!.name}" already configured for ${agent}`);
  }
  const mk = item.install.plugin && pluginMarketplace(item.install.plugin.name);
  if (agent === 'claude-code' && mk && actions.some(isMarketplaceAdd) && await marketplaceAbsent(mk, runner)) {
    actions = actions.map((a) => (isMarketplaceAdd(a) ? { ...a, undo: `claude plugin marketplace remove ${q(mk)}` } : a));
  }
  return { agent, actions, unsupported, already };
}

/** Tool name a `commands_unless` probe looks for (`command -v ccusage` → ccusage), else the item id. */
const probedTool = (item: Item): string =>
  /^command -v (\S+)/.exec(item.install.commands_unless ?? '')?.[1] ?? item.id;

const dotted = (p: (string | number)[]): string => (p.length ? p.join('.') : '(top level)');

/**
 * Dry-runs the entry's json-merge actions against `files` (path → parsed content so far in this
 * plan) and lists the user values the merge keeps and what it adds into those objects (R27).
 */
function keptValues(e: PlanEntry, files: Map<string, unknown>): string[] {
  const out: string[] = [];
  for (const a of e.perAgent.flatMap((p) => p.actions)) {
    if (a.kind !== 'json-merge') continue;
    if (!files.has(a.file)) {
      let cur: unknown;
      try {
        const text = existsSync(a.file) ? readFileSync(a.file, 'utf8') : '';
        cur = text.trim() === '' ? undefined : JSON.parse(text);
      } catch {
        continue; // Not plain JSON: applying fails with a clear error instead.
      }
      files.set(a.file, cur);
    }
    const { result, added, conflicts } = mergeJson(files.get(a.file), a.patch);
    files.set(a.file, result);
    const parents = new Set(conflicts.filter((c) => c.path.length > 1).map((c) => dotted(c.path.slice(0, -1))));
    for (const c of conflicts) out.push(`kept your existing ${dotted(c.path)} (${e.item.id})`);
    for (const x of added) {
      const parent = dotted(x.path.slice(0, -1));
      if (x.path.length > 1 && parents.has(parent)) out.push(`added ${dotted(x.path)} to your existing ${parent} (${e.item.id})`);
    }
  }
  return out;
}

/**
 * Plans `ids` (plus required items) for the chosen agents. An item recorded in state is
 * `already` when it covers every chosen agent, `partial` when its install did not complete, and
 * otherwise planned for the new agents only (R23). An item whose `detect` exits 0 is `already`;
 * an item conflicting with an earlier planned or an installed item is `skip-conflict`. When the
 * `commands_unless` probe exits 0 the item's `commands` (and their uninstall) are dropped (R24).
 * Missing required binaries are noted in `reason` only (doctor checks them). `repoRoot`
 * resolves the manifest's repo-relative paths.
 */
export async function buildPlan(
  m: Manifest, ids: string[], agents: AgentId[], env: Env, runner: Runner, state: State, repoRoot: string,
): Promise<PlanEntry[]> {
  const itemIds = new Set(m.items.map((i) => i.id));
  const plan: PlanEntry[] = [];
  const jsonFiles = new Map<string, unknown>();
  for (const item of expand(m, ids)) {
    const e: PlanEntry = { item, status: 'install', perAgent: [], shared: [] };
    plan.push(e);
    const chosen = agents.filter((a) => item.agents.includes(a));
    const rec = state.items[item.id];
    if (rec && !isComplete(rec)) {
      e.status = 'partial';
      e.reason = `partially installed — run \`agentic-setup uninstall ${item.id}\` then install again`;
      continue;
    }
    if (rec) {
      const added = chosen.filter((a) => !rec.agents.includes(a));
      for (const a of added) e.perAgent.push(await agentPlan(item, a, env, runner, repoRoot));
      e.shared = skillActions(item, added, env, true);
      const notes = e.perAgent.flatMap((p) => p.already);
      if (!e.shared.length && !e.perAgent.some((p) => p.actions.length)) {
        e.status = 'already';
        e.reason = ['already installed by agentic-setup', ...notes].join('; ');
        continue;
      }
      e.addsAgents = true;
      e.reason = [`installed for ${rec.agents.join(', ')}; adding ${added.join(', ')}`, ...notes].join('; ');
      const kept = keptValues(e, jsonFiles);
      if (kept.length) e.kept = kept;
      continue;
    }
    const taken = [
      ...Object.keys(state.items),
      ...plan.filter((p) => p !== e && (p.status === 'install' || p.status === 'already')).map((p) => p.item.id),
    ];
    const clash = taken.find((t) => t !== item.id && (item.conflicts?.includes(t)
      || m.items.find((i) => i.id === t)?.conflicts?.includes(item.id)));
    if (clash) {
      e.status = 'skip-conflict';
      e.reason = `conflicts with ${clash}`;
      continue;
    }
    if (item.detect && (await runner.run(item.detect, { allowFail: true, readOnly: true })).code === 0) {
      e.status = 'already';
      e.reason = 'already installed (detected)';
      continue;
    }
    if (chosen.length === 0) {
      e.status = 'unsupported';
      e.reason = `not available for ${agents.join(', ')} (works with ${item.agents.join(', ')})`;
      continue;
    }
    for (const a of chosen) e.perAgent.push(await agentPlan(item, a, env, runner, repoRoot));
    const notes: string[] = [];
    let commands = item.install.commands ?? [];
    const unless = item.install.commands_unless;
    const keptTool = commands.length > 0 && unless !== undefined
      && (await runner.run(unless, { allowFail: true, readOnly: true })).code === 0;
    if (keptTool) {
      commands = [];
      notes.push(`kept your existing ${probedTool(item)}`);
    }
    e.shared = [
      ...skillActions(item, chosen, env),
      ...commands.map((cmd, i): Action => {
        const undo = i === 0 && item.uninstall?.length ? item.uninstall.join(' && ') : undefined;
        return undo ? { kind: 'run', cmd, undo } : { kind: 'run', cmd };
      }),
      ...(item.post_install ?? []).map((cmd): Action => ({ kind: 'run', cmd })),
    ];
    const missing = (item.requires ?? []).filter((r) => !itemIds.has(r) && !hasBinary(requiredBinary(r), env));
    if (missing.length) notes.push(`needs ${missing.join(', ')} (not found on PATH)`);
    const work = e.perAgent.some((p) => p.actions.length) || e.shared.length > 0;
    if (!work) {
      const already = e.perAgent.flatMap((p) => p.already);
      e.status = already.length || keptTool ? 'already' : 'unsupported';
      if (already.length || e.status === 'unsupported') {
        notes.unshift(already.length ? already.join('; ') : `not available for ${chosen.join(', ')}`);
      }
    }
    if (notes.length) e.reason = notes.join('; ');
    if (e.status === 'install') {
      const kept = keptValues(e, jsonFiles);
      if (kept.length) e.kept = kept;
    }
  }
  return plan;
}
