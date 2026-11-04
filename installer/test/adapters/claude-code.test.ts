import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Item, InstallSpec } from '../../src/manifest/types.js';
import type { Env } from '../../src/detect.js';
import type { Action } from '../../src/actions.js';
import { adapters, skillActions } from '../../src/adapters/index.js';
import { Ctx } from '../../src/fs/ctx.js';
import { applyJsonMerge } from '../../src/fs/json-merge.js';
import { applyBlock } from '../../src/fs/blocks.js';
import { FakeRunner } from '../helpers.js';

let home: string;
let repo: string;
let env: Env;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'as-home-'));
  repo = mkdtempSync(join(tmpdir(), 'as-repo-'));
  env = { home, path: '', platform: 'darwin' };
});

const item = (install: InstallSpec, id = 'x'): Item => ({
  id, name: id, pack: 'core', summary: '', benefit: ['quality'], details: '', kinds: ['hook'],
  agents: ['claude-code'], source: { type: 'local', ref: '' }, redistribution: 'own', risk: 'low',
  token_cost: 0, install, verify: 'true',
});
const cc = adapters['claude-code']!;

describe('claude-code adapter', () => {
  it('claude-code maps rtk hook to settings.json merge', () => {
    const a = cc.actions(item({ hooks: { 'claude-code': { event: 'PreToolUse', matcher: 'Bash', command: 'rtk hook' } } }), env, repo);
    expect(a).toEqual([{
      kind: 'json-merge', file: join(home, '.claude', 'settings.json'),
      patch: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook' }] }] } },
    }]);
  });

  it('claude-code maps context7 http mcp to claude mcp add with undo', () => {
    const a = cc.actions(item({ mcp: { name: 'context7', transport: 'http', url: 'https://mcp.context7.com/mcp' } }), env, repo);
    expect(a).toEqual([{
      kind: 'run', cmd: 'claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp',
      undo: 'claude mcp remove context7 -s user',
    }]);
  });

  it('claude-code maps stdio mcp', () => {
    const a = cc.actions(item({ mcp: { name: 's', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] } }), env, repo);
    expect(a[0]).toMatchObject({ cmd: 'claude mcp add --scope user s -- npx -y pkg', undo: 'claude mcp remove s -s user' });
  });

  it('claude-code maps statusLine settings', () => {
    const settings = { statusLine: { type: 'command', command: 'bash ~/.claude/sl.sh' } };
    expect(cc.actions(item({ settings }), env, repo)).toEqual([
      { kind: 'json-merge', file: join(home, '.claude', 'settings.json'), patch: settings },
    ]);
  });

  it('claude-code maps plugin to marketplace add (no undo) then install with uninstall, both tracking settings keys', () => {
    const a = cc.actions(item({ plugin: { marketplace: 'owner/repo', name: 'p@m' } }), env, repo);
    const file = join(home, '.claude', 'settings.json');
    expect(a).toEqual([
      { kind: 'run', cmd: 'claude plugin marketplace add owner/repo', jsonTrack: { file, paths: [['extraKnownMarketplaces', 'm']] } },
      { kind: 'run', cmd: 'claude plugin install p@m', undo: 'claude plugin uninstall p@m', jsonTrack: { file, paths: [['enabledPlugins', 'p@m']] } },
    ]);
  });

  it('claude-code maps rule to CLAUDE.md block', () => {
    writeFileSync(join(repo, 'rule.md'), 'be nice\n');
    const a = cc.actions(item({ rule: 'rule.md' }, 'r1'), env, repo);
    expect(a).toEqual([{ kind: 'block', file: join(home, '.claude', 'CLAUDE.md'), id: 'r1', body: 'be nice', style: 'md' }]);
    expect(cc.instructionsFile(env)).toBe(join(home, '.claude', 'CLAUDE.md'));
  });

  it('claude-code copies local_skills file by file and files with mode', () => {
    mkdirSync(join(repo, 'skills', 'foo', 'sub'), { recursive: true });
    writeFileSync(join(repo, 'skills', 'foo', 'SKILL.md'), 's');
    writeFileSync(join(repo, 'skills', 'foo', 'sub', 'a.sh'), 'x');
    const a = cc.actions(item({
      local_skills: ['skills/foo'], files: [{ from: 'h.sh', to: '~/.claude/hooks/h.sh', mode: 0o755 }, { from: 'n', to: '~/n' }],
    }), env, repo);
    expect(a).toEqual([
      { kind: 'copy', from: join(repo, 'skills/foo/SKILL.md'), to: join(home, '.claude/skills/foo/SKILL.md') },
      { kind: 'copy', from: join(repo, 'skills/foo/sub/a.sh'), to: join(home, '.claude/skills/foo/sub/a.sh') },
      { kind: 'copy', from: join(repo, 'h.sh'), to: join(home, '.claude/hooks/h.sh'), mode: 0o755 },
      { kind: 'copy', from: join(repo, 'n'), to: join(home, 'n') },
    ]);
  });

  it('supports reports fields', () => {
    expect(cc.supports('hooks')).toBe(true);
    expect(cc.supports('plugin')).toBe(true);
    expect(cc.supports('commands')).toBe(false);
  });

  it('applying claude-code actions twice through Ctx leaves settings.json identical', async () => {
    const settingsFile = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(settingsFile, '{\n  "hooks": {\n    "PreToolUse": [{"matcher":"Edit","hooks":[{"type":"command","command":"x"}]}]\n  }\n}');
    writeFileSync(join(repo, 'rule.md'), 'rule body');
    const actions = cc.actions(item({
      hooks: { 'claude-code': { event: 'PreToolUse', matcher: 'Bash', command: 'rtk hook' } },
      settings: { statusLine: { type: 'command', command: 'sl' } },
      mcp: { name: 'c7', transport: 'http', url: 'https://x' },
      rule: 'rule.md',
    }, 'multi'), env, repo);
    const runner = new FakeRunner();
    const exec = async (ctx: Ctx) => {
      for (const a of actions as Action[]) {
        if (a.kind === 'json-merge') applyJsonMerge(ctx, a.file, a.patch);
        else if (a.kind === 'block') applyBlock(ctx, a.file, a.id, a.body, a.style);
        else if (a.kind === 'copy') ctx.copy(a.from, a.to, a.mode);
        else await runner.run(a.cmd);
      }
    };
    await exec(new Ctx({ home, repoRoot: repo }));
    const once = readFileSync(settingsFile, 'utf8');
    const md = readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8');
    await exec(new Ctx({ home, repoRoot: repo }));
    expect(readFileSync(settingsFile, 'utf8')).toBe(once);
    expect(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8')).toBe(md);
    expect(JSON.parse(once).hooks.PreToolUse).toHaveLength(2);
    expect(runner.calls).toHaveLength(2);
  });
});

describe('skillActions', () => {
  it('skillActions builds one npx skills command with agent flags and undo', () => {
    const it2 = item({ skills: { repo: 'owner/repo', names: ['a', 'b'] } });
    const a = skillActions(it2, ['claude-code', 'codex', 'gemini-cli', 'command-code', 'generic'], env);
    expect(a).toEqual([{
      kind: 'run',
      cmd: 'DISABLE_TELEMETRY=1 npx -y skills add owner/repo -g -y -s a b -a claude-code -a codex -a gemini-cli -a command-code',
      undo: 'DISABLE_TELEMETRY=1 npx -y skills remove -g -y a b -a claude-code -a codex -a gemini-cli -a command-code',
      snapshot: [
        join(home, '.agents/skills/a'), join(home, '.agents/skills/b'),
        join(home, '.claude/skills/a'), join(home, '.claude/skills/b'),
        join(home, '.gemini/skills/a'), join(home, '.gemini/skills/b'),
        join(home, '.commandcode/skills/a'), join(home, '.commandcode/skills/b'),
      ],
    }]);
  });

  // e2e (Task 11): with no -a the skills CLI links every agent it detects (a generic-only item
  // landed in ~/.claude/skills too), and with a single -a claude-code it copies straight into
  // ~/.claude/skills and never writes ~/.agents/skills. `-a codex` targets ~/.agents/skills.
  it('skillActions with generic only targets ~/.agents/skills alone; none when no skills', () => {
    const a = skillActions(item({ skills: { repo: 'o/r', names: ['a'] } }), ['generic'], env);
    expect((a[0] as { cmd: string }).cmd).toBe('DISABLE_TELEMETRY=1 npx -y skills add o/r -g -y -s a -a codex');
    expect(skillActions(item({}), ['claude-code'], env)).toEqual([]);
  });

  it('skills undo only targets the agents it installed for', () => {
    const [a] = skillActions(item({ skills: { repo: 'o/r', names: ['a', 'b'] } }), ['gemini-cli', 'generic'], env) as { undo: string }[];
    // Names before the -a flags: the skills CLI's -a takes every following non-flag word.
    expect(a.undo).toBe('DISABLE_TELEMETRY=1 npx -y skills remove -g -y a b -a gemini-cli -a codex');
  });

  it('skillActions always writes the canonical ~/.agents/skills copy for claude-code', () => {
    const a = skillActions(item({ skills: { repo: 'o/r', names: ['a'] } }), ['claude-code', 'generic'], env);
    expect((a[0] as { cmd: string }).cmd).toBe('DISABLE_TELEMETRY=1 npx -y skills add o/r -g -y -s a -a claude-code -a codex');
  });
});

describe('skills telemetry', () => {
  it('skills commands disable skills telemetry per command', () => {
    const [a] = skillActions(item({ skills: { repo: 'o/r', names: ['a', "b c"] } }), ['claude-code'], env) as { cmd: string; undo: string }[];
    expect(a.cmd.startsWith('DISABLE_TELEMETRY=1 npx -y skills add o/r')).toBe(true);
    expect(a.undo).toBe("DISABLE_TELEMETRY=1 npx -y skills remove -g -y a 'b c' -a claude-code -a codex");
    expect(a.cmd).toContain("-s a 'b c'");
  });
});

describe('ctx.copy mode', () => {
  it('copy preserves source exec bit', () => {
    const src = join(repo, 's.sh');
    writeFileSync(src, '#!/bin/sh\n');
    chmodSync(src, 0o755);
    const ctx = new Ctx({ home, repoRoot: repo });
    ctx.copy(src, join(home, 'out', 's.sh'));
    expect(statSync(join(home, 'out', 's.sh')).mode & 0o777).toBe(0o755);
  });
});
