#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';
import { adapters } from './adapters/index.js';
import { detectAgents, type Env } from './detect.js';
import { doctor } from './engine/doctor.js';
import { buildPlan } from './engine/plan.js';
import { uninstall } from './engine/uninstall.js';
import { update } from './engine/update.js';
import { Ctx } from './fs/ctx.js';
import { loadManifest } from './manifest/load.js';
import { AGENT_IDS, PACK_IDS, type AgentId, type Manifest, type PackId } from './manifest/types.js';
import { loadProfile, saveProfile, type Profile } from './profile.js';
import { makeRunner, type Runner } from './run/runner.js';
import { loadState } from './state/state.js';
import { renderCard } from './ui/card.js';
import {
  Cancelled, clackPrompter, doctorStatus, dryRun, gate, installAndSummarize, renderDiff, renderPlan,
  runWalkthrough, type Prompter, type RunReport,
} from './ui/walkthrough.js';

const COMMANDS = ['init', 'list', 'info', 'install', 'uninstall', 'doctor', 'update'] as const;
export type Command = (typeof COMMANDS)[number];

export interface Args {
  cmd: Command;
  ids: string[];
  dryRun: boolean;
  yes: boolean;
  agents?: AgentId[];
  profile?: string;
  pack?: PackId;
  /** uninstall --all */
  all: boolean;
  help: boolean;
}

/** Bad command line: exit code 2. */
class UsageError extends Error {}

const USAGE = `Usage: agentic-setup [command] [options]

Commands:
  init               guided walk-through (default)
  list [--pack p]    one line per item
  info <id>          details of one item
  install [id...]    install items (default: the default packs)
  uninstall <id...>  reverse an install (--all for everything)
  doctor             check what is installed
  update [id...]     update installed items

Options:
  --dry-run          show what would change, write nothing
  --yes, -y          take the defaults, no prompts
  --agents a,b       agents to set up, from:
                     ${AGENT_IDS.join(', ')}
  --profile <file>   install a saved selection without prompts
  --pack <id>        list: only this pack
  --all              uninstall: every item agentic-setup installed`;

export function parseArgs(argv: string[]): Args {
  let parsed;
  try {
    parsed = parseNodeArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        'dry-run': { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        agents: { type: 'string' },
        profile: { type: 'string' },
        pack: { type: 'string' },
        all: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const { values: v, positionals } = parsed;
  const [first = 'init', ...ids] = positionals;
  if (!(COMMANDS as readonly string[]).includes(first)) throw new UsageError(`unknown command "${first}"`);
  const out: Args = { cmd: first as Command, ids, dryRun: v['dry-run'], yes: v.yes, all: v.all, help: v.help };
  if (v.agents !== undefined) {
    const list = v.agents.split(',').map((s) => s.trim()).filter(Boolean);
    for (const a of list) if (!(AGENT_IDS as readonly string[]).includes(a)) throw new UsageError(`unknown agent "${a}" (known: ${AGENT_IDS.join(', ')})`);
    if (!list.length) throw new UsageError('--agents needs at least one agent');
    out.agents = [...new Set(list)] as AgentId[];
  }
  if (v.pack !== undefined) {
    if (!(PACK_IDS as readonly string[]).includes(v.pack)) throw new UsageError(`unknown pack "${v.pack}" (known: ${PACK_IDS.join(', ')})`);
    out.pack = v.pack as PackId;
  }
  if (v.profile !== undefined) out.profile = v.profile;
  return out;
}

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));

/**
 * Where the manifest, docs and pack files live: $AGENTIC_SETUP_ROOT, else the bundled
 * `<package>/assets` (published package), else the repo root (`installer/..`, in dev).
 */
export function resolveRepoRoot(env: NodeJS.ProcessEnv, pkgDir = PKG_DIR): string {
  if (env.AGENTIC_SETUP_ROOT) return resolve(env.AGENTIC_SETUP_ROOT);
  const assets = join(pkgDir, 'assets');
  if (existsSync(join(assets, 'manifest', 'items.yaml'))) return assets;
  return resolve(pkgDir, '..');
}

export interface Io {
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  prompter: Prompter;
  runnerFor: (ctx: Ctx) => Runner;
  out: (s: string) => void;
  err: (s: string) => void;
}

const defaultIo = (): Io => ({
  env: process.env,
  isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prompter: clackPrompter,
  runnerFor: makeRunner,
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
});

/** Ids of every item in a pack whose `default` is true (core). */
const defaultItems = (m: Manifest): string[] => {
  const packs = new Set(m.packs.filter((p) => p.default).map((p) => p.id));
  return m.items.filter((i) => packs.has(i.pack)).map((i) => i.id);
};

const exitFor = (r: RunReport): number => (r.failed.length || r.doctorFailed.length ? 1 : 0);

function listLines(m: Manifest, pack?: PackId): string[] {
  const items = m.items.filter((i) => !pack || i.pack === pack);
  const cols = items.map((i) => [i.id, i.pack, `≈+${i.token_cost} tok`, i.risk]);
  const w = [0, 1, 2, 3].map((c) => Math.max(0, ...cols.map((r) => r[c].length)));
  return items.map((i, n) => {
    const head = cols[n].map((s, c) => s.padEnd(w[c])).join('  ');
    const room = 80 - head.length - 2;
    const s = [...i.summary];
    const sum = s.length <= room ? i.summary : `${s.slice(0, Math.max(0, room - 1)).join('')}…`;
    return `${head}  ${sum}`.trimEnd();
  });
}

/** Non-interactive init/install: --yes, --profile, or `install <ids>`. */
async function installCmd(a: Args, io: Io, m: Manifest, env: Env, repoRoot: string, home: string): Promise<number> {
  let profile: Profile | undefined;
  if (a.profile) profile = loadProfile(resolve(a.profile), m);
  const agents = a.agents ?? profile?.agents ?? await detectAgents(env);
  const ids = a.cmd === 'install' && a.ids.length ? a.ids : profile?.items ?? defaultItems(m);
  for (const id of ids) if (!m.items.some((i) => i.id === id)) throw new UsageError(`unknown item "${id}"`);
  const needConfirm = !a.yes && !profile;
  if (needConfirm && !io.isTTY) throw new UsageError('not a terminal: pass --yes or --profile to install without prompts');
  const ctx = new Ctx({ home, repoRoot, dryRun: a.dryRun });
  const runner = io.runnerFor(ctx);
  const plan = await buildPlan(m, ids, agents, env, runner, loadState(home), repoRoot);
  const g = await gate(plan, { interactive: io.isTTY, named: new Set(profile?.items ?? []), prompter: io.prompter });
  io.out(renderPlan(g.plan, agents));
  if (a.dryRun || needConfirm) io.out(`\nChanges (dry run):\n${renderDiff(await dryRun(g.plan, home, repoRoot, io.runnerFor))}\n`);
  if (needConfirm) {
    const go = await io.prompter.confirm({ message: 'Install these items?', initialValue: true });
    if (io.prompter.isCancel(go)) throw new Cancelled();
    if (!go) { io.out('Nothing was written.'); return 0; }
  }
  const report = await installAndSummarize({ m, plan: g.plan, agents, ctx, runner, skipped: g.skipped, out: io.out });
  if (a.cmd === 'init' && !a.dryRun) {
    const skipped = new Set(g.skipped.map((s) => s.id));
    saveProfile(home, { agents, items: ids.filter((i) => !skipped.has(i)) });
  }
  return exitFor(report);
}

async function run(a: Args, io: Io): Promise<number> {
  if (a.help) { io.out(USAGE); return 0; }
  const home = io.env.HOME || homedir();
  const repoRoot = resolveRepoRoot(io.env);
  const manifestDir = join(repoRoot, 'manifest');
  if (!existsSync(join(manifestDir, 'items.yaml'))) throw new Error(`no manifest found at ${manifestDir}`);
  const m = loadManifest(manifestDir, repoRoot);
  const env: Env = { home, path: io.env.PATH ?? '', platform: process.platform };

  switch (a.cmd) {
    case 'list':
      for (const l of listLines(m, a.pack)) io.out(l);
      return 0;
    case 'info': {
      const id = a.ids[0];
      if (!id) throw new UsageError('info needs an item id');
      const item = m.items.find((i) => i.id === id);
      if (!item) throw new UsageError(`unknown item "${id}"`);
      const doc = join(repoRoot, item.details);
      io.out(existsSync(doc) ? readFileSync(doc, 'utf8').trimEnd() : renderCard(item, a.agents ?? await detectAgents(env), adapters));
      return 0;
    }
    case 'uninstall': {
      const ctx = new Ctx({ home, repoRoot, dryRun: a.dryRun });
      const st = loadState(home);
      const ids = a.all ? Object.keys(st.items) : a.ids;
      if (!ids.length) throw new UsageError('uninstall needs item ids, or --all');
      for (const id of ids) if (!st.items[id]) io.out(`not installed by agentic-setup: ${id}`);
      const known = ids.filter((id) => st.items[id]);
      const r = known.length ? await uninstall(known, ctx, io.runnerFor(ctx)) : { removed: [], userChanged: [] };
      if (a.dryRun && ctx.plannedCommands.length) io.out(`Would run:\n${ctx.plannedCommands.map((c) => `  $ ${c}`).join('\n')}`);
      io.out(`${a.dryRun ? 'would remove' : 'removed'}: ${r.removed.join(', ') || '(none)'}`);
      for (const n of r.userChanged) io.out(`  ${n}`);
      return 0;
    }
    case 'doctor': {
      const ctx = new Ctx({ home, repoRoot, dryRun: true });
      const res = await doctor(ctx, io.runnerFor(ctx), m);
      if (!res.length) { io.out('Nothing installed by agentic-setup.'); return 0; }
      let bad = false;
      for (const r of res) {
        const s = doctorStatus(m, r);
        bad ||= s === 'FAIL';
        io.out(`${r.id}  ${s}${s === 'ok' ? '' : `  ${r.detail}`}`);
      }
      return bad ? 1 : 0;
    }
    case 'update': {
      const ctx = new Ctx({ home, repoRoot, dryRun: a.dryRun });
      const r = await update(a.ids.length ? a.ids : undefined, ctx, io.runnerFor(ctx), m);
      if (a.dryRun && ctx.plannedCommands.length) io.out(`Would run:\n${ctx.plannedCommands.map((c) => `  $ ${c}`).join('\n')}`);
      io.out(`${a.dryRun ? 'would update' : 'updated'}: ${r.updated.join(', ') || '(none)'}`);
      for (const f of r.failed) io.out(`failed: ${f.id} — ${f.error}`);
      return r.failed.length ? 1 : 0;
    }
    case 'install':
      return installCmd(a, io, m, env, repoRoot, home);
    case 'init': {
      if (a.yes || a.profile) return installCmd(a, io, m, env, repoRoot, home);
      if (!io.isTTY) throw new UsageError('init needs a terminal; pass --yes or --profile to run without prompts');
      const ctx = new Ctx({ home, repoRoot, dryRun: a.dryRun });
      let cancelled = false;
      let code = 0;
      await runWalkthrough(m, env, ctx, io.runnerFor(ctx), {
        prompter: io.prompter, out: io.out, runnerFor: io.runnerFor, agents: a.agents,
        onCancel: () => { cancelled = true; },
        onReport: (r) => { code = exitFor(r); },
      });
      if (cancelled) { io.out('Cancelled. Nothing was written.'); return 130; }
      return code;
    }
  }
}

/** CLI entry. Returns the exit code: 0 ok, 1 failure, 2 usage error, 130 cancelled. */
export async function main(argv: string[], io: Partial<Io> = {}): Promise<number> {
  const full: Io = { ...defaultIo(), ...io };
  try {
    return await run(parseArgs(argv), full);
  } catch (e) {
    if (e instanceof Cancelled) { full.out('Cancelled. Nothing was written.'); return 130; }
    if (e instanceof UsageError) { full.err(`${e.message}\n\n${USAGE}`); return 2; }
    full.err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

const isEntry = (): boolean => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isEntry()) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
