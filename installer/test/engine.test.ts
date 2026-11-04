import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentId, InstallSpec, Item, Manifest } from '../src/manifest/types.js';
import type { Env } from '../src/detect.js';
import { Ctx } from '../src/fs/ctx.js';
import { loadState, statePath } from '../src/state/state.js';
import { buildPlan } from '../src/engine/plan.js';
import { applyPlan } from '../src/engine/apply.js';
import { uninstall } from '../src/engine/uninstall.js';
import { doctor } from '../src/engine/doctor.js';
import { update } from '../src/engine/update.js';
import { snapshotPaths } from '../src/engine/snapshot.js';
import { installAndSummarize, renderPlan } from '../src/ui/walkthrough.js';
import { adapters } from '../src/adapters/index.js';
import { FakeRunner, type FakeStep } from './helpers.js';

function fresh() {
  const home = mkdtempSync(join(tmpdir(), 'as-eng-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'as-eng-repo-'));
  writeFileSync(join(repo, 'rule.md'), 'Be careful.\n');
  mkdirSync(join(repo, 'skills', 'demo'), { recursive: true });
  writeFileSync(join(repo, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n');
  writeFileSync(join(repo, 'skills', 'demo', 'run.sh'), '#!/bin/sh\necho hi\n');
  chmodSync(join(repo, 'skills', 'demo', 'run.sh'), 0o755);
  const env: Env = { home, path: '', platform: 'darwin' };
  return { home, repo, env };
}

const mkItem = (id: string, install: InstallSpec, extra: Partial<Item> = {}): Item => ({
  id, name: id, pack: 'core', summary: '', benefit: ['quality'], details: '', kinds: ['skill'],
  agents: ['claude-code', 'command-code', 'codex', 'gemini-cli', 'generic'],
  source: { type: 'local', ref: '' }, redistribution: 'own', risk: 'low', token_cost: 0,
  install, verify: 'true', ...extra,
});

const manifest = (items: Item[]): Manifest => ({ packs: [], items });

/** Hash of the whole HOME (files, dirs, links), excluding the installer's own ~/.agentic-setup (R5). */
function homeHash(home: string): Record<string, string> {
  const all = snapshotPaths([home]);
  return Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(join(home, '.agentic-setup'))));
}

async function install(
  m: Manifest, ids: string[], agents: AgentId[], f: ReturnType<typeof fresh>, runner: FakeRunner, dryRun = false,
) {
  const ctx = new Ctx({ home: f.home, repoRoot: f.repo, dryRun });
  const plan = await buildPlan(m, ids, agents, f.env, runner, loadState(f.home), f.repo);
  const res = await applyPlan(plan, ctx, runner);
  return { ctx, plan, res };
}

/** A fake `npx skills` that creates and removes skill dirs like the real tool would. */
function skillsTool(home: string): FakeStep[] {
  return [
    {
      match: 'skills add', effect: () => {
        for (const d of ['.agents/skills/foo', '.claude/skills/foo']) {
          mkdirSync(join(home, d), { recursive: true });
          writeFileSync(join(home, d, 'SKILL.md'), 'foo\n');
        }
      },
    },
    {
      match: 'skills remove', effect: () => {
        rmSync(join(home, '.agents'), { recursive: true, force: true });
        rmSync(join(home, '.claude', 'skills', 'foo'), { recursive: true, force: true });
      },
    },
  ];
}

describe('engine', () => {
  it('conflict detection marks second of two conflicting items skip-conflict', async () => {
    const f = fresh();
    const a = mkItem('a', { rule: 'rule.md' }, { conflicts: ['b'] });
    const b = mkItem('b', { rule: 'rule.md' });
    const plan = await buildPlan(manifest([a, b]), ['a', 'b'], ['generic'], f.env, new FakeRunner(), loadState(f.home), f.repo);
    expect(plan.map((e) => [e.item.id, e.status])).toEqual([['a', 'install'], ['b', 'skip-conflict']]);
    expect(plan[1].reason).toMatch(/conflicts with a/);
  });

  it('expands requires that are item ids and notes missing binaries', async () => {
    const f = fresh();
    const dep = mkItem('dep', { rule: 'rule.md' });
    const top = mkItem('top', { rule: 'rule.md' }, { requires: ['dep', 'no-such-bin-xyz>=2'] });
    const plan = await buildPlan(manifest([top, dep]), ['top'], ['generic'], f.env, new FakeRunner(), loadState(f.home), f.repo);
    expect(plan.map((e) => e.item.id)).toEqual(['dep', 'top']);
    expect(plan[1].status).toBe('install');
    expect(plan[1].reason).toMatch(/no-such-bin-xyz/);
  });

  it('lists unsupported fields per agent', async () => {
    const f = fresh();
    const it1 = mkItem('h', { hooks: { 'claude-code': { event: 'PreToolUse', command: 'x' } }, rule: 'rule.md' });
    const plan = await buildPlan(manifest([it1]), ['h'], ['claude-code', 'generic'], f.env, new FakeRunner(), loadState(f.home), f.repo);
    const g = plan[0].perAgent.find((p) => p.agent === 'generic')!;
    expect(g.unsupported).toEqual(['hooks']);
    expect(plan[0].perAgent.find((p) => p.agent === 'claude-code')!.unsupported).toEqual([]);
    const only = mkItem('o', { skills: { repo: 'o/r', names: ['foo'] } }, { agents: ['codex'] });
    const p2 = await buildPlan(manifest([only]), ['o'], ['generic'], f.env, new FakeRunner(), loadState(f.home), f.repo);
    expect(p2[0].status).toBe('unsupported');
    expect(p2[0].shared).toEqual([]);
  });

  it('already-installed item via detect is not applied or recorded', async () => {
    const f = fresh();
    const it1 = mkItem('d', { rule: 'rule.md' }, { detect: 'probe-d' });
    const runner = new FakeRunner([{ match: 'probe-d', result: { code: 0 } }]);
    const { plan, res } = await install(manifest([it1]), ['d'], ['generic'], f, runner);
    expect(plan[0].status).toBe('already');
    expect(res.installed).toEqual([]);
    expect(existsSync(join(f.home, '.agents', 'AGENTS.md'))).toBe(false);
    expect(loadState(f.home).items).toEqual({});
  });

  it('second install records nothing and reports already installed', async () => {
    const f = fresh();
    const it1 = mkItem('r', { rule: 'rule.md', local_skills: ['skills/demo'] });
    const m = manifest([it1]);
    const first = await install(m, ['r'], ['claude-code'], f, new FakeRunner());
    expect(first.res.installed).toEqual(['r']);
    const stateBytes = readFileSync(statePath(f.home), 'utf8');
    const before = homeHash(f.home);
    const second = await install(m, ['r'], ['claude-code'], f, new FakeRunner());
    expect(second.plan[0].status).toBe('already');
    expect(second.res.installed).toEqual([]);
    expect(readFileSync(statePath(f.home), 'utf8')).toBe(stateBytes);
    expect(homeHash(f.home)).toEqual(before);
  });

  it('uninstall restores the exact previous state', async () => {
    const f = fresh();
    mkdirSync(join(f.home, '.claude'));
    writeFileSync(join(f.home, '.claude', 'settings.json'), '{\n    "hooks": {\n        "PreToolUse": [{"matcher": "Bash", "hooks": []}]\n    }\n}');
    writeFileSync(join(f.home, '.claude', 'CLAUDE.md'), '# mine\nno trailing newline');
    const before = homeHash(f.home);
    const m = manifest([
      mkItem('merge', { settings: { statusLine: { type: 'command', command: 'sl' } } }),
      mkItem('block', { rule: 'rule.md' }),
      mkItem('copy', { local_skills: ['skills/demo'], files: [{ from: 'rule.md', to: '~/.config/x/rule.md' }] }),
      mkItem('run', { skills: { repo: 'o/r', names: ['foo'] } }),
    ]);
    const runner = new FakeRunner(skillsTool(f.home));
    const { res } = await install(m, ['merge', 'block', 'copy', 'run'], ['claude-code'], f, runner);
    expect(res.failed).toEqual([]);
    expect(res.installed).toEqual(['merge', 'block', 'copy', 'run']);
    expect(homeHash(f.home)).not.toEqual(before);
    const ctx = new Ctx({ home: f.home, repoRoot: f.repo });
    const u = await uninstall(['merge', 'block', 'copy', 'run'], ctx, runner);
    expect(u.userChanged).toEqual([]);
    expect(u.removed.sort()).toEqual(['block', 'copy', 'merge', 'run']);
    expect(homeHash(f.home)).toEqual(before);
    expect(loadState(f.home).items).toEqual({});
  });

  it('state records applied actions before a failing run action', async () => {
    const f = fresh();
    const it1 = mkItem('p', { settings: { a: 1 } }, { post_install: ['patch-it'] });
    const ok = mkItem('ok', { settings: { b: 2 } });
    const runner = new FakeRunner([{ match: 'patch-it', result: { code: 2, stderr: 'nope' } }]);
    const { res } = await install(manifest([it1, ok]), ['p', 'ok'], ['claude-code'], f, runner);
    expect(res.failed.map((x) => x.id)).toEqual(['p']);
    expect(res.failed[0].error).toMatch(/patch-it/);
    expect(res.installed).toEqual(['ok']);
    const st = loadState(f.home);
    const acts = st.items.p.actions;
    expect(acts.map((a) => a.kind)).toEqual(['json-merge', 'run']);
    expect(acts[1].kind === 'run' && acts[1].undoData.pending).toBe(true);
    const u = await uninstall(['p', 'ok'], new Ctx({ home: f.home, repoRoot: f.repo }), runner);
    expect(u.removed.sort()).toEqual(['ok', 'p']);
    expect(existsSync(join(f.home, '.claude'))).toBe(false);
  });

  it('dry-run apply writes nothing and runs nothing', async () => {
    const f = fresh();
    const before = snapshotPaths([f.home]);
    const m = manifest([
      mkItem('merge', { settings: { x: 1 } }),
      mkItem('copy', { local_skills: ['skills/demo'], rule: 'rule.md' }),
      mkItem('run', { skills: { repo: 'o/r', names: ['foo'] }, commands: ['npm i -g foo'] }),
    ]);
    const ctx = new Ctx({ home: f.home, repoRoot: f.repo, dryRun: true });
    const runner = new FakeRunner(skillsTool(f.home), ctx);
    const plan = await buildPlan(m, ['merge', 'copy', 'run'], ['claude-code'], f.env, runner, loadState(f.home), f.repo);
    const res = await applyPlan(plan, ctx, runner);
    expect(res.failed).toEqual([]);
    expect(snapshotPaths([f.home])).toEqual(before);
    expect(runner.calls).toEqual([]);
    expect(ctx.planned.length).toBeGreaterThan(0);
    expect(ctx.plannedCommands.some((c) => c.includes('skills add'))).toBe(true);
    expect(ctx.plannedCommands).toContain('npm i -g foo');
  });

  it('uninstall reports user-changed copy and leaves it', async () => {
    const f = fresh();
    const it1 = mkItem('c', { local_skills: ['skills/demo'] });
    await install(manifest([it1]), ['c'], ['claude-code'], f, new FakeRunner());
    const skill = join(f.home, '.claude', 'skills', 'demo', 'SKILL.md');
    expect(readFileSync(join(f.home, '.claude', 'skills', 'demo', 'run.sh')).length).toBeGreaterThan(0);
    writeFileSync(skill, 'my edit\n');
    const u = await uninstall(['c'], new Ctx({ home: f.home, repoRoot: f.repo }), new FakeRunner());
    expect(u.removed).toEqual([]);
    expect(u.userChanged.join('\n')).toMatch(/SKILL\.md.*left alone: edited since install/);
    expect(readFileSync(skill, 'utf8')).toBe('my edit\n');
    expect(existsSync(join(f.home, '.claude', 'skills', 'demo', 'run.sh'))).toBe(false);
    const left = loadState(f.home).items.c.actions;
    expect(left.map((a) => a.kind === 'copy' && a.to)).toEqual([skill]);
  });

  it('doctor reports failing verify and missing required binary', async () => {
    const f = fresh();
    const good = mkItem('good', { rule: 'rule.md' }, { verify: 'verify-good' });
    const bad = mkItem('bad', { rule: 'rule.md' }, { verify: 'verify-bad' });
    const needy = mkItem('needy', { rule: 'rule.md' }, { verify: 'verify-good', requires: ['no-such-bin-xyz>=1'] });
    const m = manifest([good, bad, needy]);
    const runner = new FakeRunner([{ match: 'verify-bad', result: { code: 1, stderr: 'missing file' } }]);
    await install(m, ['good', 'bad', 'needy'], ['generic'], f, runner);
    const r = await doctor(new Ctx({ home: f.home, repoRoot: f.repo }), runner, m);
    const by = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(by.good.ok).toBe(true);
    expect(by.bad.ok).toBe(false);
    expect(by.bad.detail).toMatch(/missing file/);
    expect(by.needy.ok).toBe(false);
    expect(by.needy.detail).toMatch(/no-such-bin-xyz/);
  });

  it('update reapplies post_install', async () => {
    const f = fresh();
    const it1 = mkItem('s', { skills: { repo: 'o/r', names: ['foo'] } }, { post_install: ['patch-foo'] });
    const m = manifest([it1]);
    const steps: FakeStep[] = [
      ...skillsTool(f.home),
      { match: 'skills update', effect: () => writeFileSync(join(f.home, '.agents', 'skills', 'foo', 'SKILL.md'), 'v2\n') },
      { match: 'patch-foo', effect: () => writeFileSync(join(f.home, '.agents', 'skills', 'foo', 'PATCHED'), 'p\n') },
    ];
    const runner = new FakeRunner(steps);
    await install(m, ['s'], ['claude-code'], f, runner);
    rmSync(join(f.home, '.agents', 'skills', 'foo', 'PATCHED'));
    runner.calls.length = 0;
    const res = await update(undefined, new Ctx({ home: f.home, repoRoot: f.repo }), runner, m);
    expect(res.failed).toEqual([]);
    expect(res.updated).toEqual(['s']);
    expect(runner.calls[0]).toMatch(/npx -y skills update -g -y foo$/);
    expect(runner.calls[1]).toBe('patch-foo');
    expect(existsSync(join(f.home, '.agents', 'skills', 'foo', 'PATCHED'))).toBe(true);
    const run = loadState(f.home).items.s.actions.find((a) => a.kind === 'run' && a.snapshot)!;
    expect(run.kind === 'run' && Object.keys(run.undoData.snapshotAfter).some((k) => k.endsWith('PATCHED'))).toBe(true);
  });

  it('existing mcp server for an agent is reported already and not re-added', async () => {
    const f = fresh();
    const it1 = mkItem('c7', { mcp: { name: 'context7', transport: 'http', url: 'https://x' } });
    const runner = new FakeRunner([
      { match: 'claude mcp get context7', result: { code: 0 } },
      { match: 'cmd mcp list', result: { stdout: 'serena: stdio uvx serena\n' } },
    ]);
    const { plan, res } = await install(manifest([it1]), ['c7'], ['claude-code', 'command-code'], f, runner);
    expect(plan[0].status).toBe('install');
    const cc = plan[0].perAgent.find((p) => p.agent === 'claude-code')!;
    expect(cc.actions).toEqual([]);
    expect(cc.already.join(' ')).toMatch(/context7/);
    expect(res.installed).toEqual(['c7']);
    expect(runner.calls.some((c) => c.startsWith('claude mcp add'))).toBe(false);
    expect(runner.calls.some((c) => c.startsWith('cmd mcp add'))).toBe(true);
    expect(loadState(f.home).items.c7.agents).toEqual(['command-code']);
  });

  // R18: `claude plugin` writes settings.json itself; uninstall must remove what it added.
  function fakeClaudePlugins(home: string, listed: string[]): FakeStep[] {
    const file = join(home, '.claude', 'settings.json');
    const edit = (fn: (s: Record<string, Record<string, unknown>>) => void) => () => {
      mkdirSync(join(home, '.claude'), { recursive: true });
      const s = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
      fn(s);
      writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
    };
    return [
      { match: 'claude plugin marketplace list', result: { stdout: JSON.stringify(listed.map((name) => ({ name }))) } },
      { match: 'claude plugin marketplace add', effect: edit((s) => { s.extraKnownMarketplaces = { ...s.extraKnownMarketplaces, mk: { source: { source: 'github', repo: 'o/mk' } } }; }) },
      { match: 'claude plugin marketplace remove', effect: edit((s) => { s.extraKnownMarketplaces = {}; }) },
      { match: 'claude plugin install', effect: edit((s) => { s.enabledPlugins = { ...s.enabledPlugins, 'p@mk': true }; }) },
      { match: 'claude plugin uninstall', effect: edit((s) => { s.enabledPlugins = {}; }) },
    ];
  }
  const pluginItem = () => mkItem('pl', { plugin: { marketplace: 'o/mk', name: 'p@mk' } }, { agents: ['claude-code'] });

  it('uninstall removes plugin-added settings keys and deletes settings.json it created', async () => {
    const f = fresh();
    const file = join(f.home, '.claude', 'settings.json');
    const runner = new FakeRunner(fakeClaudePlugins(f.home, []));
    const { res } = await install(manifest([pluginItem()]), ['pl'], ['claude-code'], f, runner);
    expect(res.installed).toEqual(['pl']);
    expect(JSON.parse(readFileSync(file, 'utf8')).enabledPlugins).toEqual({ 'p@mk': true });
    const u = await uninstall(['pl'], new Ctx({ home: f.home, repoRoot: f.repo }), runner);
    expect(u.removed).toEqual(['pl']);
    expect(runner.calls).toContain('claude plugin marketplace remove mk');
    expect(existsSync(file)).toBe(false);
  });

  it('pre-existing marketplace is never removed', async () => {
    const f = fresh();
    const file = join(f.home, '.claude', 'settings.json');
    mkdirSync(join(f.home, '.claude'));
    const mine = { model: 'x', extraKnownMarketplaces: { mk: { source: { source: 'github', repo: 'o/mk' } } } };
    writeFileSync(file, `${JSON.stringify(mine, null, 2)}\n`);
    const runner = new FakeRunner(fakeClaudePlugins(f.home, ['mk']));
    await install(manifest([pluginItem()]), ['pl'], ['claude-code'], f, runner);
    const u = await uninstall(['pl'], new Ctx({ home: f.home, repoRoot: f.repo }), runner);
    expect(u.removed).toEqual(['pl']);
    expect(runner.calls.some((c) => c.includes('marketplace remove'))).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(`${JSON.stringify(mine, null, 2)}\n`);
  });
});

describe('final review fixes', () => {
  it('post-install doctor only verifies installed ids', async () => {
    const f = fresh();
    const old = mkItem('old', { rule: 'rule.md' }, { verify: 'verify-old' });
    const nu = mkItem('nu', { settings: { n: 1 } }, { verify: 'verify-nu' });
    const m = manifest([old, nu]);
    await install(m, ['old'], ['generic'], f, new FakeRunner());
    const ctx = new Ctx({ home: f.home, repoRoot: f.repo });
    const runner = new FakeRunner();
    const plan = await buildPlan(m, ['nu'], ['claude-code'], f.env, runner, loadState(f.home), f.repo);
    await installAndSummarize({ m, plan, agents: ['claude-code'], ctx, runner, skipped: [], out: () => {} });
    expect(runner.calls).toContain('verify-nu');
    expect(runner.calls).not.toContain('verify-old');
    expect((await doctor(ctx, new FakeRunner(), m, ['nu'])).map((r) => r.id)).toEqual(['nu']);
  });

  it('item requiring a failed item is skipped', async () => {
    const f = fresh();
    const base = mkItem('base', { commands: ['boom'] });
    const mid = mkItem('mid', { settings: { mid: 1 } }, { requires: ['base'] });
    const top = mkItem('top', { settings: { top: 1 } }, { requires: ['mid'] });
    const runner = new FakeRunner([{ match: 'boom', result: { code: 1 } }]);
    const { res } = await install(manifest([base, mid, top]), ['top'], ['claude-code'], f, runner);
    expect(res.installed).toEqual([]);
    expect(res.failed.map((x) => x.id)).toEqual(['base', 'mid', 'top']);
    expect(res.failed[1].error).toBe('skipped: requires base, which failed');
    expect(res.failed[2].error).toBe('skipped: requires base, which failed');
    expect(existsSync(join(f.home, '.claude', 'settings.json'))).toBe(false);
  });

  it('partially installed item is reported partial, not already', async () => {
    const f = fresh();
    const it1 = mkItem('half', { rule: 'rule.md', commands: ['tool-install'] }, { agents: ['generic'] });
    const m = manifest([it1]);
    const first = await install(m, ['half'], ['generic'], f, new FakeRunner([{ match: 'tool-install', result: { code: 1 } }]));
    expect(first.res.failed.map((x) => x.id)).toEqual(['half']);
    expect(loadState(f.home).items.half.complete).toBe(false);
    const second = await install(m, ['half'], ['generic'], f, new FakeRunner());
    expect(second.plan[0].status).toBe('partial');
    expect(second.plan[0].reason).toMatch(/partially installed — run `agentic-setup uninstall half` then install again/);
    expect(second.res.installed).toEqual([]);
    expect(renderPlan(second.plan, ['generic'])).toMatch(/half \(partial\)/);
    const ok = await install(manifest([mkItem('fine', { rule: 'rule.md' })]), ['fine'], ['generic'], f, new FakeRunner());
    expect(loadState(f.home).items.fine.complete).toBe(true);
    expect(ok.res.installed).toEqual(['fine']);
  });

  it('installing an item for an additional agent adds only that agent\'s actions', async () => {
    const f = fresh();
    const it1 = mkItem('multi', { rule: 'rule.md', skills: { repo: 'o/r', names: ['foo'] }, commands: ['tool-install'] });
    const m = manifest([it1]);
    await install(m, ['multi'], ['claude-code'], f, new FakeRunner());
    const runner = new FakeRunner();
    const second = await install(m, ['multi'], ['claude-code', 'gemini-cli'], f, runner);
    const e = second.plan[0];
    expect(e.status).toBe('install');
    expect(e.perAgent.map((p) => p.agent)).toEqual(['gemini-cli']);
    expect(e.shared).toEqual([{
      kind: 'run',
      cmd: 'DISABLE_TELEMETRY=1 npx -y skills add o/r -g -y -s foo -a gemini-cli',
      undo: 'DISABLE_TELEMETRY=1 npx -y skills remove -g -y foo -a gemini-cli',
      snapshot: [join(f.home, '.gemini/skills/foo')],
    }]);
    expect(runner.calls.some((c) => c.includes('tool-install'))).toBe(false);
    const rec = loadState(f.home).items.multi;
    expect(rec.agents).toEqual(['claude-code', 'gemini-cli']);
    expect(rec.complete).toBe(true);
    expect(rec.actions.filter((a) => a.kind === 'block').map((a) => (a as { file: string }).file))
      .toEqual([join(f.home, '.claude', 'CLAUDE.md'), join(f.home, '.gemini', 'GEMINI.md')]);
    const third = await install(m, ['multi'], ['gemini-cli', 'claude-code'], f, new FakeRunner());
    expect(third.plan[0].status).toBe('already');
  });

  it('existing tool binary is not reinstalled and never uninstalled', async () => {
    const f = fresh();
    const it1 = mkItem('tool', { commands: ['tool-install'], commands_unless: 'command -v tool', settings: { t: 1 } }, {
      uninstall: ['tool-uninstall'],
    });
    const runner = new FakeRunner([{ match: 'command -v tool', result: { code: 0 } }]);
    const { plan, res } = await install(manifest([it1]), ['tool'], ['claude-code'], f, runner);
    expect(plan[0].status).toBe('install');
    expect(plan[0].shared).toEqual([]);
    expect(plan[0].reason).toMatch(/kept your existing tool/);
    expect(res.installed).toEqual(['tool']);
    expect(runner.calls).not.toContain('tool-install');
    expect(JSON.stringify(loadState(f.home).items.tool)).not.toMatch(/tool-(un)?install/);
    await uninstall(['tool'], new Ctx({ home: f.home, repoRoot: f.repo }), runner);
    expect(runner.calls).not.toContain('tool-uninstall');
    // Without the tool the commands run, and their undo is recorded.
    const g = fresh();
    const r2 = new FakeRunner([{ match: 'command -v tool', result: { code: 1 } }]);
    await install(manifest([it1]), ['tool'], ['claude-code'], g, r2);
    expect(r2.calls).toContain('tool-install');
  });

  it('json merge conflict is reported in the plan', async () => {
    const f = fresh();
    mkdirSync(join(f.home, '.claude'));
    writeFileSync(join(f.home, '.claude', 'settings.json'), '{"statusLine": {"type": "command", "command": "my-line"}}\n');
    const it1 = mkItem('sl', { settings: { statusLine: { type: 'command', command: 'theirs', padding: 0 } } });
    const plan = await buildPlan(manifest([it1]), ['sl'], ['claude-code'], f.env, new FakeRunner(), loadState(f.home), f.repo);
    expect(plan[0].kept).toEqual([
      'kept your existing statusLine.command (sl)',
      'added statusLine.padding to your existing statusLine (sl)',
    ]);
    const text = renderPlan(plan, ['claude-code']);
    expect(text).toContain('kept your existing statusLine.command (sl)');
    const lines: string[] = [];
    const ctx = new Ctx({ home: f.home, repoRoot: f.repo });
    await installAndSummarize({ m: manifest([it1]), plan, agents: ['claude-code'], ctx, runner: new FakeRunner(), skipped: [], out: (s) => lines.push(s) });
    expect(lines.join('\n')).toContain('kept your existing statusLine.command (sl)');
  });

  it('claude-code + generic with CLAUDE.md importing AGENTS.md yields one block', async () => {
    const f = fresh();
    mkdirSync(join(f.home, '.claude'));
    writeFileSync(join(f.home, '.claude', 'CLAUDE.md'), '# mine\n\n@~/.agents/AGENTS.md\n');
    const claudeBefore = readFileSync(join(f.home, '.claude', 'CLAUDE.md'), 'utf8');
    const it1 = mkItem('rules', { rule: 'rule.md' });
    const { res } = await install(manifest([it1]), ['rules'], ['claude-code', 'generic'], f, new FakeRunner());
    expect(res.installed).toEqual(['rules']);
    expect(readFileSync(join(f.home, '.claude', 'CLAUDE.md'), 'utf8')).toBe(claudeBefore);
    const agentsMd = readFileSync(join(f.home, '.agents', 'AGENTS.md'), 'utf8');
    expect(agentsMd.match(/Be careful\./g)).toHaveLength(1);
    // The absolute-path import counts too.
    writeFileSync(join(f.home, '.claude', 'CLAUDE.md'), `x\n  @${f.home}/.agents/AGENTS.md  \n`);
    expect(adapters['claude-code'].instructionsFile(f.env)).toBe(join(f.home, '.agents', 'AGENTS.md'));
    writeFileSync(join(f.home, '.claude', 'CLAUDE.md'), 'see @~/.agents/AGENTS.md inline\n');
    expect(adapters['claude-code'].instructionsFile(f.env)).toBe(join(f.home, '.claude', 'CLAUDE.md'));
    await uninstall(['rules'], new Ctx({ home: f.home, repoRoot: f.repo }), new FakeRunner());
    expect(existsSync(join(f.home, '.agents', 'AGENTS.md'))).toBe(false);
  });
});
