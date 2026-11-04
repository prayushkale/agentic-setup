import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { main, parseArgs, type Io } from '../src/cli.js';
import { runWalkthrough, type Prompter } from '../src/ui/walkthrough.js';
import { loadManifest } from '../src/manifest/load.js';
import { Ctx } from '../src/fs/ctx.js';
import { loadState } from '../src/state/state.js';
import { snapshotPaths } from '../src/engine/snapshot.js';
import { FakeRunner, type FakeStep } from './helpers.js';

const ROOT = resolve(import.meta.dirname, 'fixtures/cli-root');
const PKG = resolve(import.meta.dirname, '..');
const CANCEL = Symbol('cancel');

/** Scripted prompter: each prompt takes the next answer (a value, or a function of the prompt options). */
class ScriptPrompter implements Prompter {
  readonly asked: { kind: string; message: string }[] = [];
  readonly notes: string[] = [];
  constructor(private readonly answers: unknown[]) {}
  answersLeft(): number { return this.answers.length; }
  private next(kind: string, o: { message: string }): Promise<never> {
    this.asked.push({ kind, message: o.message });
    if (this.answers.length === 0) throw new Error(`unexpected ${kind}: ${o.message}`);
    const a = this.answers.shift();
    return Promise.resolve((typeof a === 'function' ? a(o) : a) as never);
  }
  select<T>(o: { message: string }) { return this.next('select', o) as Promise<T | symbol>; }
  multiselect<T>(o: { message: string }) { return this.next('multiselect', o) as Promise<T[] | symbol>; }
  confirm(o: { message: string }) { return this.next('confirm', o) as Promise<boolean | symbol>; }
  note(message: string, title?: string) { this.notes.push(`${title ?? ''}\n${message}`); }
  isCancel(v: unknown): v is symbol { return v === CANCEL; }
}

function homeHash(home: string, withOwn = true): Record<string, string> {
  const all = snapshotPaths([home]);
  return withOwn ? all : Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(join(home, '.agentic-setup'))));
}

function setup(root = ROOT, steps: FakeStep[] = []) {
  const home = mkdtempSync(join(tmpdir(), 'as-cli-home-'));
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# mine\nno trailing newline');
  const lines: string[] = [];
  const runners: FakeRunner[] = [];
  const io = (o: Partial<Io> = {}): Partial<Io> => ({
    env: { HOME: home, PATH: '', AGENTIC_SETUP_ROOT: root },
    isTTY: false,
    out: (s) => lines.push(s),
    err: (s) => lines.push(`ERR ${s}`),
    runnerFor: (ctx) => { const r = new FakeRunner(steps, ctx); runners.push(r); return r; },
    ...o,
  });
  return { home, lines, runners, io, text: () => lines.join('\n') };
}

/** Fixture root copy where `risky-tool` keeps curl-script but is low risk. */
function lowRiskCurlRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'as-cli-root-'));
  cpSync(ROOT, root, { recursive: true });
  const f = join(root, 'manifest', 'items.yaml');
  writeFileSync(f, readFileSync(f, 'utf8').replace('risk: high\n    risk_reason: Runs a downloaded shell script with your user rights.\n', 'risk: low\n'));
  return root;
}

describe('parseArgs', () => {
  it('parseArgs defaults to init', () => {
    expect(parseArgs([])).toMatchObject({ cmd: 'init', ids: [], dryRun: false, yes: false });
    expect(parseArgs(['--dry-run']).cmd).toBe('init');
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('parseArgs reads --agents list', () => {
    const a = parseArgs(['install', 'x', 'y', '--agents', 'claude-code,generic', '--yes', '--profile', 'p.yaml']);
    expect(a).toMatchObject({ cmd: 'install', ids: ['x', 'y'], agents: ['claude-code', 'generic'], yes: true, profile: 'p.yaml' });
    expect(parseArgs(['list', '--pack', 'core']).pack).toBe('core');
    expect(parseArgs(['uninstall', '--all']).all).toBe(true);
    expect(() => parseArgs(['--agents', 'hermes'])).toThrow(/unknown agent "hermes"/);
    expect(() => parseArgs(['list', '--pack', 'ios'])).toThrow(/unknown pack "ios"/);
    expect(() => parseArgs(['frobnicate'])).toThrow(/unknown command/);
  });
});

describe('main', () => {
  it('main install --dry-run --yes --agents claude-code writes nothing', async () => {
    const t = setup();
    const before = homeHash(t.home);
    const code = await main(['install', '--dry-run', '--yes', '--agents', 'claude-code'], t.io());
    expect(code).toBe(0);
    expect(homeHash(t.home)).toEqual(before);
    expect(t.text()).toContain('changed: ~/.claude/CLAUDE.md');
    expect(t.text()).toContain('≈ +420 tokens at startup');
    expect(t.text()).not.toContain('accept-gate'); // opt-in pack, not a default
  });

  it('install --yes without --profile on a TTY installs core and writes state, then uninstall --all restores HOME', async () => {
    const t = setup();
    const before = homeHash(t.home, false);
    expect(await main(['install', '--yes', '--agents', 'claude-code,generic'], t.io())).toBe(0);
    expect(Object.keys(loadState(t.home).items).sort()).toEqual(['agents-md', 'demo-skill']);
    expect(readFileSync(join(t.home, '.claude', 'CLAUDE.md'), 'utf8')).toContain('Plan first');
    expect(existsSync(join(t.home, '.agents', 'skills', 'demo-skill', 'SKILL.md'))).toBe(true);
    expect(await main(['uninstall', '--all'], t.io())).toBe(0);
    expect(homeHash(t.home, false)).toEqual(before);
  });

  it('curl-script item needs confirm under --yes', async () => {
    const root = lowRiskCurlRoot();
    // TTY: asked even with --yes; "no" leaves it out.
    let t = setup(root);
    let p = new ScriptPrompter([false]);
    expect(await main(['install', 'risky-tool', '--yes', '--dry-run', '--agents', 'claude-code'], t.io({ isTTY: true, prompter: p }))).toBe(0);
    expect(p.asked).toHaveLength(1);
    expect(p.asked[0].message).toContain('https://example.com/install.sh');
    expect(p.asked[0].message).toContain('0000000000000000000000000000000000000000000000000000000000000abc');
    expect(t.text()).not.toContain('echo install-risky');
    // TTY: "yes" installs it.
    t = setup(root);
    p = new ScriptPrompter([true]);
    await main(['install', 'risky-tool', '--yes', '--dry-run', '--agents', 'claude-code'], t.io({ isTTY: true, prompter: p }));
    expect(t.text()).toContain('echo install-risky');
    // No TTY: skipped, and the output says so.
    t = setup(root);
    await main(['install', 'risky-tool', '--yes', '--dry-run', '--agents', 'claude-code'], t.io());
    expect(t.text()).not.toContain('$ echo install-risky');
    expect(t.text().replace(/\s+/g, ' ')).toMatch(/skipped risky-tool: downloads and runs \S+, needs a confirm/i);
  });

  it('high-risk item: second confirm under --yes, skipped without a TTY, allowed when the profile names it', async () => {
    let t = setup();
    const p = new ScriptPrompter([(o: { message: string }) => { expect(o.message).toContain('user rights'); return false; }]);
    await main(['install', 'risky-tool', 'agents-md', '--yes', '--dry-run', '--agents', 'claude-code'], t.io({ isTTY: true, prompter: p }));
    expect(p.asked).toHaveLength(1);
    expect(t.text()).not.toContain('$ echo install-risky');

    t = setup();
    await main(['install', 'risky-tool', '--yes', '--dry-run', '--agents', 'claude-code'], t.io());
    expect(t.text()).toMatch(/skipped risky-tool: high risk/i);

    t = setup();
    const prof = join(t.home, 'p.yaml');
    writeFileSync(prof, 'agents: [claude-code]\nitems: [risky-tool]\n');
    await main(['install', '--profile', prof, '--yes', '--dry-run'], t.io());
    expect(t.text()).toContain('$ echo install-risky');
  });

  it('install --yes output shows risk_reason for a med item', async () => {
    const t = setup();
    await main(['install', 'accept-gate', '--yes', '--dry-run', '--agents', 'claude-code'], t.io());
    expect(t.text().replace(/\s+/g, ' ')).toContain('risk: med — The agent can write the pin file unless an OS sandbox denies it.');
  });

  it('uninstall unknown id is a no-op with message', async () => {
    const t = setup();
    expect(await main(['install', 'agents-md', '--yes', '--agents', 'claude-code'], t.io())).toBe(0);
    const before = homeHash(t.home);
    const r = t.runners.length;
    t.lines.length = 0;
    expect(await main(['uninstall', 'nope'], t.io())).toBe(0);
    expect(t.text()).toContain('not installed by agentic-setup: nope');
    expect(t.text()).toContain('removed: (none)');
    expect(homeHash(t.home)).toEqual(before);
    expect(t.runners.slice(r).every((x) => x.calls.length === 0)).toBe(true);
    expect(Object.keys(loadState(t.home).items)).toEqual(['agents-md']);
  });

  it('init without a TTY and without --yes or --profile refuses', async () => {
    const t = setup();
    expect(await main([], t.io())).toBe(2);
    expect(t.text()).toMatch(/--yes or --profile/);
  });

  it('list prints one line per item and filters by --pack', async () => {
    const t = setup();
    expect(await main(['list'], t.io())).toBe(0);
    expect(t.lines.filter((l) => l.trim())).toHaveLength(4);
    expect(t.text()).toMatch(/^agents-md\s+core\s+≈\+300 tok\s+low\s+General working rules/m);
    expect(t.text()).toMatch(/^risky-tool\s+verification\s+≈\+0 tok\s+high\s+/m);
    for (const l of t.lines) expect([...l].length).toBeLessThanOrEqual(80);
    const u = setup();
    await main(['list', '--pack', 'verification'], u.io());
    expect(u.lines.filter((l) => l.trim()).map((l) => l.split(/\s+/)[0])).toEqual(['accept-gate', 'risky-tool']);
  });

  it('info prints the item doc if present, else the card', async () => {
    let t = setup();
    expect(await main(['info', 'agents-md'], t.io())).toBe(0);
    expect(t.text()).toContain('Full details for the agents-md item.');
    t = setup();
    expect(await main(['info', 'demo-skill', '--agents', 'claude-code'], t.io())).toBe(0);
    expect(t.text()).toContain('≈ +120 tokens at startup');
    t = setup();
    expect(await main(['info', 'nope'], t.io())).toBe(2);
  });

  it('doctor shows manual for needs_key items that fail verify, and exits 1 for a real failure', async () => {
    const t = setup(ROOT, [
      { match: /^false$/, result: { code: 1 } },
      { match: /^true$/, result: { code: 1, stderr: 'broken' } },
    ]);
    const prof = join(t.home, 'p.yaml');
    writeFileSync(prof, 'agents: [claude-code]\nitems: [risky-tool]\n');
    await main(['install', '--profile', prof, '--yes'], t.io());
    t.lines.length = 0;
    expect(await main(['doctor'], t.io())).toBe(0);
    expect(t.text()).toMatch(/risky-tool\s+manual/);
    await main(['install', 'demo-skill', '--yes', '--agents', 'generic'], t.io());
    t.lines.length = 0;
    expect(await main(['doctor'], t.io())).toBe(1);
    expect(t.text()).toMatch(/demo-skill\s+FAIL/);
  });
});

describe('walkthrough', () => {
  const m = loadManifest(join(ROOT, 'manifest'), ROOT);
  const env = (home: string) => ({ home, path: '', platform: process.platform });

  it('walkthrough cancel writes nothing', async () => {
    for (let at = 0; at < 6; at++) {
      const home = mkdtempSync(join(tmpdir(), 'as-wt-'));
      const before = homeHash(home);
      const ctx = new Ctx({ home, repoRoot: ROOT });
      const answers: unknown[] = [['claude-code'], ['core'], 'each', 'yes', 'yes', true];
      answers[at] = CANCEL;
      const p = new ScriptPrompter(answers);
      const r = await runWalkthrough(m, env(home), ctx, new FakeRunner([], ctx), {
        prompter: p, out: () => {}, runnerFor: (c) => new FakeRunner([], c),
      });
      expect(r, `cancel at prompt ${at}`).toBeNull();
      expect(homeHash(home)).toEqual(before);
    }
  });

  it('med-risk reason shown when pack accepted with Accept all', async () => {
    const home = mkdtempSync(join(tmpdir(), 'as-wt-'));
    const ctx = new Ctx({ home, repoRoot: ROOT, dryRun: true });
    const p = new ScriptPrompter([['claude-code'], ['verification'], 'all', false, true]);
    await runWalkthrough(m, env(home), ctx, new FakeRunner([], ctx), {
      prompter: p, out: () => {}, runnerFor: (c) => new FakeRunner([], c),
    });
    const plan = p.notes.find((n) => n.startsWith('Plan\n'))!;
    expect(plan.replace(/\s+/g, ' ')).toContain('risk: med — The agent can write the pin file unless an OS sandbox denies it.');
    expect(plan.replace(/\s+/g, ' ')).toContain('risk: high — Runs a downloaded shell script');
  });

  it('walkthrough cancel makes main exit 130', async () => {
    const t = setup();
    expect(await main([], t.io({ isTTY: true, prompter: new ScriptPrompter([CANCEL]) }))).toBe(130);
  });

  it('walks packs and items, shows details on ?, installs, saves the profile', async () => {
    const home = mkdtempSync(join(tmpdir(), 'as-wt-'));
    const ctx = new Ctx({ home, repoRoot: ROOT });
    const out: string[] = [];
    const p = new ScriptPrompter([
      (o: unknown) => { expect((o as { initialValues: string[] }).initialValues).toEqual(['generic']); return ['claude-code', 'generic']; },
      (o: unknown) => { expect((o as { initialValues: string[] }).initialValues).toEqual(['core']); return ['core', 'verification']; },
      'all', // core: accept all
      'each', // verification: one by one
      (o: unknown) => { expect((o as { initialValue: string }).initialValue).toBe('no'); return '?'; },
      'yes', // accept-gate
      'no', // risky-tool
      true, // install?
    ]);
    const prof = await runWalkthrough(m, env(home), ctx, new FakeRunner([], ctx), {
      prompter: p, out: (s) => out.push(s), runnerFor: (c) => new FakeRunner([], c),
    });
    expect(prof).toEqual({ agents: ['claude-code', 'generic'], items: ['agents-md', 'demo-skill', 'accept-gate'] });
    expect(p.answersLeft()).toBe(0);
    const all = [...p.notes, ...out].join('\n');
    expect(all).toContain('≈ +500 tokens at startup');
    expect(all).toMatch(/not available for generic \(works with claude-code, gemini-cli\)/);
    expect(all).toContain('Accept gate details: how the pin file works.'); // the ? choice
    expect(all).toContain('Run the acceptance checks'); // dry-run diff of the rule block
    expect(Object.keys(loadState(home).items).sort()).toEqual(['accept-gate', 'agents-md', 'demo-skill']);
    expect(readFileSync(join(home, '.agentic-setup', 'profile.yaml'), 'utf8')).toContain('accept-gate');
    expect(JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).hooks.Stop).toBeTruthy();
  });
});

describe('packaging', () => {
  it('bundle-assets copies manifest, docs and own pack paths, never private/ or work/', () => {
    const src = mkdtempSync(join(tmpdir(), 'as-bundle-src-'));
    cpSync(ROOT, src, { recursive: true });
    for (const d of ['private', 'work', 'packs/unused']) {
      mkdirSync(join(src, d), { recursive: true });
      writeFileSync(join(src, d, 'secret.md'), 'x\n');
    }
    mkdirSync(join(src, 'templates'));
    writeFileSync(join(src, 'templates', 'AGENTS.md'), 't\n');
    const out = join(mkdtempSync(join(tmpdir(), 'as-bundle-out-')), 'assets');
    execFileSync(process.execPath, [resolve(PKG, '../tools/bundle-assets.mjs'), '--src', src, '--out', out]);
    const files = Object.keys(snapshotPaths([out])).map((f) => f.slice(out.length + 1)).filter(Boolean);
    expect(files).toContain('manifest/items.yaml');
    expect(files).toContain('docs/items/agents-md.md');
    expect(files).toContain('templates/AGENTS.md');
    expect(files).toContain('packs/core/demo-skill/SKILL.md');
    expect(files).toContain('packs/verification/gate.md');
    expect(files.some((f) => /^(private|work)(\/|$)|packs\/unused/.test(f))).toBe(false);
    expect(() => loadManifest(join(out, 'manifest'), out)).not.toThrow();
  });

  it('npm pack --dry-run lists no private/ or work/ paths', () => {
    const json = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: PKG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const paths: string[] = JSON.parse(json)[0].files.map((f: { path: string }) => f.path);
    expect(paths).toContain('dist/cli.js');
    expect(paths).toContain('assets/manifest/items.yaml');
    expect(paths.some((p) => /(^|\/)(private|work)(\/|$)/.test(p))).toBe(false);
    expect(paths).toEqual(expect.arrayContaining(['README.md', 'LICENSE', 'CHANGELOG.md']));
    expect(paths.every((p) => /^(dist|assets)\/|^(package\.json|README\.md|LICENSE|CHANGELOG\.md)$/.test(p))).toBe(true);
    expect(readdirSync(PKG)).toContain('dist');
  }, 120_000);
});
