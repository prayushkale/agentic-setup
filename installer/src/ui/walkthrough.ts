import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as clack from '@clack/prompts';
import { adapters } from '../adapters/index.js';
import { detectAgents, type Env } from '../detect.js';
import { applyPlan } from '../engine/apply.js';
import { doctor } from '../engine/doctor.js';
import { buildPlan, unsupportedFields, type PlanEntry } from '../engine/plan.js';
import { Ctx } from '../fs/ctx.js';
import { AGENT_IDS, type AgentId, type Item, type Manifest, type PackId } from '../manifest/types.js';
import { makeRunner, type Runner } from '../run/runner.js';
import { loadState } from '../state/state.js';
import { saveProfile, type Profile } from '../profile.js';
import { needsOwnConfirm, renderCard, wrap } from './card.js';

/** The few prompt calls the walk-through makes, so tests can script them. */
export interface Prompter {
  select<T>(o: { message: string; options: { value: T; label: string; hint?: string }[]; initialValue?: T }): Promise<T | symbol>;
  multiselect<T>(o: {
    message: string; options: { value: T; label: string; hint?: string }[]; initialValues?: T[]; required?: boolean;
  }): Promise<T[] | symbol>;
  confirm(o: { message: string; initialValue?: boolean }): Promise<boolean | symbol>;
  note(message: string, title?: string): void;
  isCancel(v: unknown): v is symbol;
}

export const clackPrompter: Prompter = {
  select: (o) => clack.select(o as Parameters<typeof clack.select>[0]) as never,
  multiselect: (o) => clack.multiselect(o as Parameters<typeof clack.multiselect>[0]) as never,
  confirm: (o) => clack.confirm(o),
  note: (message, title) => clack.note(message, title),
  isCancel: (v): v is symbol => clack.isCancel(v),
};

export interface UiIo {
  prompter: Prompter;
  out: (s: string) => void;
  /** Runner for a given Ctx (the dry-run preview gets its own Ctx). */
  runnerFor: (ctx: Ctx) => Runner;
}

/** Thrown when the user cancels a prompt (Ctrl-C). Nothing has been written at that point. */
export class Cancelled extends Error {
  constructor() { super('cancelled'); this.name = 'Cancelled'; }
}

const ask = async <T>(p: Prompter, v: Promise<T | symbol>): Promise<T> => {
  const r = await v;
  if (p.isCancel(r)) throw new Cancelled();
  return r as T;
};

/** Sum of `token_cost` over the entries that will be installed. */
export const planTokens = (plan: PlanEntry[]): number =>
  plan.filter((e) => e.status === 'install').reduce((n, e) => n + e.item.token_cost, 0);

/** Plan review: one line per item with its status and per-agent notes, then the token total. */
export function renderPlan(plan: PlanEntry[], agents: AgentId[]): string {
  const lines: string[] = [];
  for (const e of plan) {
    const head = e.status === 'install' ? `+ ${e.item.id}` : `  ${e.item.id} (${e.status.replace('skip-', '')})`;
    lines.push(...wrap(`${head}  ≈+${e.item.token_cost} tok${e.reason ? ` — ${e.reason}` : ''}`, 76, 4));
    if (e.status === 'install' && e.item.risk !== 'low') {
      lines.push(...wrap(`    risk: ${e.item.risk} — ${e.item.risk_reason ?? 'no reason given'}`, 76, 6));
    }
    for (const p of e.perAgent) {
      const n = p.actions.length;
      const bits = [`${n} action${n === 1 ? '' : 's'}`];
      if (p.unsupported.length) bits.push(`${p.unsupported.join(', ')} not available`);
      if (p.already.length) bits.push(`already: ${p.already.join('; ')}`);
      lines.push(...wrap(`    ${p.agent}: ${bits.join('; ')}`, 76, 6));
    }
    if (e.status === 'install') for (const k of e.kept ?? []) lines.push(...wrap(`    ${k}`, 76, 6));
    if (e.status === 'install') {
      const missing = agents.filter((a) => !e.item.agents.includes(a));
      if (missing.length) lines.push(...wrap(`    not available for ${missing.join(', ')}`, 76, 6));
    }
  }
  if (!lines.length) lines.push('No items planned.');
  lines.push('', `Total: ≈ +${planTokens(plan)} tokens at startup`);
  return lines.join('\n');
}

const MAX_DIFF_LINES = 40;

/** Line diff of one file: common head and tail trimmed, the middle shown as -/+ lines. */
function fileDiff(before: string | null, after: string | null): string[] {
  const split = (t: string | null) => (t === null || t === '' ? [] : t.replace(/\n$/, '').split('\n'));
  const a = split(before);
  const b = split(after);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const out = [...a.slice(s, a.length - e).map((l) => `- ${l}`), ...b.slice(s, b.length - e).map((l) => `+ ${l}`)];
  if (out.length > MAX_DIFF_LINES) return [...out.slice(0, MAX_DIFF_LINES), `  … ${out.length - MAX_DIFF_LINES} more lines`];
  return out;
}

/** What a dry run of the plan would change: per file a short diff, then the commands it would run. */
export function renderDiff(ctx: Ctx): string {
  const files = new Map<string, { before: string | null; after: string | null }>();
  for (const c of ctx.planned) {
    const f = files.get(c.file);
    if (f) f.after = c.after;
    else files.set(c.file, { before: c.before, after: c.after });
  }
  const lines: string[] = [];
  for (const [file, { before, after }] of files) {
    if (before === after) continue;
    const shown = file.startsWith(`${ctx.home}/`) ? `~/${file.slice(ctx.home.length + 1)}` : file;
    lines.push(`${before === null ? 'new' : after === null ? 'removed' : 'changed'}: ${shown}`);
    lines.push(...fileDiff(before, after).map((l) => `  ${l}`));
  }
  if (ctx.plannedCommands.length) {
    if (lines.length) lines.push('');
    lines.push('Would run:', ...ctx.plannedCommands.map((c) => `  $ ${c}`));
  }
  return lines.length ? lines.join('\n') : 'No file changes and no commands.';
}

/** Applies the plan to a fresh dry-run Ctx and returns that Ctx (nothing is written). */
export async function dryRun(plan: PlanEntry[], home: string, repoRoot: string, runnerFor: UiIo['runnerFor']): Promise<Ctx> {
  const dry = new Ctx({ home, repoRoot, dryRun: true });
  await applyPlan(plan, dry, runnerFor(dry));
  return dry;
}

/** Plan entries minus `drop` and anything that requires a dropped item. */
export function dropFromPlan(plan: PlanEntry[], drop: string[]): PlanEntry[] {
  const gone = new Set(drop);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of plan) {
      if (!gone.has(e.item.id) && (e.item.requires ?? []).some((r) => gone.has(r))) {
        gone.add(e.item.id);
        changed = true;
      }
    }
  }
  return plan.filter((e) => !gone.has(e.item.id));
}

const confirmText = (item: Item): string => {
  const parts = [`${item.name} (${item.id})`];
  if (item.risk === 'high') parts.push(`is high risk: ${item.risk_reason ?? ''}`);
  if (item.source.type === 'curl-script') {
    parts.push(`downloads and runs ${item.source.ref}`, `sha256 ${item.source.sha256 ?? '(none)'}`);
  }
  return `${parts.join('\n  ')}\n  Install it?`;
};

const skipReason = (item: Item): string =>
  item.risk === 'high'
    ? `high risk (${item.risk_reason ?? 'no reason given'})`
    : `downloads and runs ${item.source.ref}`;

/**
 * The own-confirm step for high-risk and curl-script items about to be installed. Items named in
 * `named` (a --profile) pass. On a TTY each is asked (default no); without one they are skipped.
 */
export async function gate(plan: PlanEntry[], o: {
  interactive: boolean; named: Set<string>; prompter: Prompter;
}): Promise<{ plan: PlanEntry[]; skipped: { id: string; why: string }[] }> {
  const skipped: { id: string; why: string }[] = [];
  for (const e of plan) {
    if (e.status !== 'install' || !needsOwnConfirm(e.item) || o.named.has(e.item.id)) continue;
    if (!o.interactive) {
      skipped.push({
        id: e.item.id,
        why: `${skipReason(e.item)}, needs a confirm (run it in a terminal, or name it in --profile)`,
      });
      continue;
    }
    if (!(await ask(o.prompter, o.prompter.confirm({ message: confirmText(e.item), initialValue: false })))) {
      skipped.push({ id: e.item.id, why: 'you said no at the confirm' });
    }
  }
  const kept = dropFromPlan(plan, skipped.map((s) => s.id));
  for (const e of plan) {
    if (!kept.includes(e) && !skipped.some((s) => s.id === e.item.id)) {
      skipped.push({ id: e.item.id, why: 'requires a skipped item' });
    }
  }
  return { plan: kept, skipped };
}

export type DoctorStatus = 'ok' | 'manual' | 'FAIL';

/** Doctor result → status: a failing item that needs a key or manual step is `manual`, not failed. */
export function doctorStatus(m: Manifest, r: { id: string; ok: boolean }): DoctorStatus {
  if (r.ok) return 'ok';
  const item = m.items.find((i) => i.id === r.id);
  return item && (item.manual || item.needs_key) ? 'manual' : 'FAIL';
}

export interface RunReport { installed: string[]; failed: { id: string; error: string }[]; doctorFailed: string[] }

/**
 * Step 6: install (unless ctx is dry-run), doctor the installed items, print the summary.
 * `skipped` are items the user left out or the gate dropped.
 */
export async function installAndSummarize(o: {
  m: Manifest; plan: PlanEntry[]; agents: AgentId[]; ctx: Ctx; runner: Runner;
  skipped: { id: string; why: string }[]; out: (s: string) => void;
}): Promise<RunReport> {
  const { m, plan, agents, ctx, runner, out } = o;
  const toInstall = plan.filter((e) => e.status === 'install');
  let installed = toInstall.map((e) => e.item.id);
  let failed: RunReport['failed'] = [];
  const doctorLines: string[] = [];
  const doctorFailed: string[] = [];
  if (!ctx.dryRun) {
    ({ installed, failed } = await applyPlan(plan, ctx, runner));
    const res = await doctor(ctx, runner, m, installed);
    for (const r of res) {
      const s = doctorStatus(m, r);
      if (s === 'FAIL') doctorFailed.push(r.id);
      doctorLines.push(...wrap(`  ${r.id}  ${s}${s === 'ok' ? '' : `  ${r.detail}`}`, 78, 6));
    }
  }
  const lines: string[] = [ctx.dryRun ? 'Summary (dry run: nothing was written)' : 'Summary'];
  const list = (label: string, ids: string[]) => {
    if (ids.length) lines.push(...wrap(`${label}: ${ids.join(', ')}`, 78, 4));
  };
  list(ctx.dryRun ? 'would install' : 'installed', installed);
  for (const f of failed) lines.push(...wrap(`failed: ${f.id} — ${f.error}`, 78, 4));
  for (const s of o.skipped) lines.push(...wrap(`skipped ${s.id}: ${s.why}`, 78, 4));
  list('already installed', plan.filter((e) => e.status === 'already').map((e) => e.item.id));
  for (const e of plan.filter((p) => p.status === 'skip-conflict' || p.status === 'unsupported' || p.status === 'partial')) {
    lines.push(...wrap(`not installed ${e.item.id}: ${e.reason ?? e.status}`, 78, 4));
  }
  for (const a of agents) {
    const na = plan.flatMap((e) => {
      if (!e.item.agents.includes(a)) return [e.item.id];
      const f = unsupportedFields(e.item, a, adapters[a]);
      return f.length ? [`${e.item.id} (${f.join(', ')})`] : [];
    });
    list(`not available for ${a}`, na);
  }
  lines.push(`≈ +${toInstall.filter((e) => installed.includes(e.item.id)).reduce((n, e) => n + e.item.token_cost, 0)} tokens at startup`);
  const kept = toInstall.filter((e) => installed.includes(e.item.id)).flatMap((e) => e.kept ?? []);
  if (kept.length) lines.push(...kept.flatMap((k) => wrap(k, 78, 4)));
  if (doctorLines.length) lines.push('doctor:', ...doctorLines);
  const todos = toInstall.filter((e) => installed.includes(e.item.id) && (e.item.manual || e.item.needs_key));
  if (todos.length) {
    lines.push('manual to-dos:');
    for (const e of todos) {
      const t = [e.item.needs_key ? `set ${e.item.needs_key}` : '', e.item.manual ?? ''].filter(Boolean).join('; ');
      lines.push(...wrap(`  - ${e.item.id}: ${t}`, 78, 6));
    }
  }
  out(lines.join('\n'));
  return { installed, failed, doctorFailed };
}

export interface WalkOptions extends Partial<UiIo> {
  /** --agents: pre-selects these instead of the detected agents. */
  agents?: AgentId[];
  /** Receives the install result (for the exit code). */
  onReport?: (r: RunReport) => void;
  /** Called when a prompt was cancelled (Ctrl-C), as opposed to the user declining. */
  onCancel?: () => void;
}

/**
 * `init`: agents → packs → per-item cards → plan review → own confirms for high-risk and
 * curl-script items → dry-run diff → confirm → install, doctor, summary, save the profile.
 * Returns null when the user cancels or declines; nothing is written then.
 */
export async function runWalkthrough(
  m: Manifest, env: Env, ctx: Ctx, runner: Runner, opts: WalkOptions = {},
): Promise<Profile | null> {
  const p = opts.prompter ?? clackPrompter;
  const out = opts.out ?? ((s: string) => process.stdout.write(`${s}\n`));
  const runnerFor = opts.runnerFor ?? makeRunner;
  try {
    // 1. Agents.
    const agents = await ask(p, p.multiselect<AgentId>({
      message: 'Which coding agents should this set up?',
      options: AGENT_IDS.map((a) => ({ value: a, label: a, hint: a === 'generic' ? 'skills + AGENTS.md for any agent' : undefined })),
      initialValues: opts.agents ?? await detectAgents(env),
      required: true,
    }));
    // 2. Packs.
    const packIds = await ask(p, p.multiselect<PackId>({
      message: 'Which packs?',
      options: m.packs.map((k) => ({ value: k.id, label: k.title, hint: k.summary })),
      initialValues: m.packs.filter((k) => k.default).map((k) => k.id),
      required: false,
    }));
    // 3. Items, one at a time (or the whole pack).
    const selected: string[] = [];
    const declined: { id: string; why: string }[] = [];
    for (const pack of m.packs.filter((k) => packIds.includes(k.id))) {
      const items = m.items.filter((i) => i.pack === pack.id);
      if (!items.length) continue;
      const mode = await ask(p, p.select<'all' | 'each'>({
        message: `${pack.title}: ${items.length} item${items.length === 1 ? '' : 's'}`,
        options: [
          { value: 'all', label: 'Accept all', hint: items.map((i) => i.id).join(', ') },
          { value: 'each', label: 'Choose one by one' },
        ],
        initialValue: pack.default ? 'all' : 'each',
      }));
      for (const item of items) {
        if (mode === 'all') { selected.push(item.id); continue; }
        p.note(renderCard(item, agents, adapters), item.name);
        for (;;) {
          const a = await ask(p, p.select<'yes' | 'no' | '?'>({
            message: `Install ${item.name}?`,
            options: [
              { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' },
              { value: '?', label: '? Show details' },
            ],
            initialValue: pack.default ? 'yes' : 'no',
          }));
          if (a === '?') {
            const f = join(ctx.repoRoot, item.details);
            p.note(existsSync(f) ? readFileSync(f, 'utf8').trimEnd() : renderCard(item, agents, adapters), item.details);
            continue;
          }
          if (a === 'yes') selected.push(item.id);
          else declined.push({ id: item.id, why: 'you said no' });
          break;
        }
      }
    }
    if (!selected.length) {
      out('Nothing selected; nothing was written.');
      return null;
    }
    // 4. Plan review.
    const first = await buildPlan(m, selected, agents, env, runnerFor(ctx), loadState(ctx.home), ctx.repoRoot);
    p.note(renderPlan(first, agents), 'Plan');
    // 5. Own confirms, dry-run diff, confirm.
    const g = await gate(first, { interactive: true, named: new Set(), prompter: p });
    const dry = await dryRun(g.plan, ctx.home, ctx.repoRoot, runnerFor);
    p.note(renderDiff(dry), 'Changes (dry run)');
    const n = g.plan.filter((e) => e.status === 'install').length;
    const go = await ask(p, p.confirm({
      message: `Install ${n} item${n === 1 ? '' : 's'} (≈ +${planTokens(g.plan)} tokens)?${ctx.dryRun ? ' [dry run]' : ''}`,
      initialValue: true,
    }));
    if (!go) {
      out('Nothing was written.');
      return null;
    }
    // 6. Install, doctor, summary, profile.
    const report = await installAndSummarize({
      m, plan: g.plan, agents, ctx, runner, skipped: [...declined, ...g.skipped], out,
    });
    opts.onReport?.(report);
    const skippedIds = new Set(g.skipped.map((s) => s.id));
    const profile: Profile = { agents, items: selected.filter((i) => !skippedIds.has(i)) };
    if (!ctx.dryRun) saveProfile(ctx.home, profile);
    return profile;
  } catch (e) {
    if (e instanceof Cancelled) {
      opts.onCancel?.();
      return null;
    }
    throw e;
  }
}
