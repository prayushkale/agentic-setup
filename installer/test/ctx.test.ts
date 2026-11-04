import { describe, it, expect, beforeEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync,
  chmodSync, lstatSync, readlinkSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Ctx } from '../src/fs/ctx.js';
import { applyJsonMerge, undoJsonMerge } from '../src/fs/json-merge.js';
import { applyBlock, undoBlock } from '../src/fs/blocks.js';
import { loadState, saveState, type State } from '../src/state/state.js';

let home: string;
let repo: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'as-home-'));
  repo = mkdtempSync(join(tmpdir(), 'as-repo-'));
});

const ctx = (dryRun = false) => new Ctx({ home, repoRoot: repo, dryRun });

/**
 * relative path → sha256 (files) or 'dir' for every entry under root. With `skipOwn`, the
 * installer's own dir (`.agentic-setup`: state and backups) is left out.
 */
function snapshot(root: string, skipOwn = false): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (skipOwn && d === root && e.name === '.agentic-setup') continue;
      if (e.isDirectory()) { out[relative(root, p)] = 'dir'; walk(p); }
      else out[relative(root, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(root);
  return out;
}

const hookPatch = {
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook' }] }] },
};

describe('Ctx', () => {
  it('readText returns null for a missing file and writeText creates parent dirs', () => {
    const c = ctx();
    const f = join(home, '.gemini', 'sub', 'GEMINI.md');
    expect(c.readText(f)).toBeNull();
    const r = c.writeText(f, 'hi\n');
    expect(readFileSync(f, 'utf8')).toBe('hi\n');
    expect(r.createdDirs).toEqual([join(home, '.gemini'), join(home, '.gemini', 'sub')]);
    expect(r.beforeHash).toBeNull();
    expect(c.planned).toEqual([{ file: f, before: null, after: 'hi\n' }]);
  });

  it('backs up the original once per Ctx under backups/<timestamp>/<path relative to home>', () => {
    const f = join(home, '.claude', 'CLAUDE.md');
    mkdirSync(join(home, '.claude'));
    writeFileSync(f, 'original');
    const c = ctx();
    const r1 = c.writeText(f, 'one');
    const r2 = c.writeText(f, 'two');
    expect(r1.backupPath).not.toBeNull();
    expect(r2.backupPath).toBe(r1.backupPath);
    expect(readFileSync(r1.backupPath!, 'utf8')).toBe('original');
    const rel = relative(join(home, '.agentic-setup', 'backups'), r1.backupPath!);
    const [stamp, ...rest] = rel.split('/');
    expect(stamp).not.toContain(':');
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rest.join('/')).toBe('.claude/CLAUDE.md');
    // A second Ctx gets its own backup dir.
    const r3 = ctx().writeText(f, 'three');
    expect(r3.backupPath).not.toBe(r1.backupPath);
    expect(readFileSync(r3.backupPath!, 'utf8')).toBe('two');
  });

  it('copy copies bytes, applies mode and records created dirs', () => {
    writeFileSync(join(repo, 'hook.sh'), '#!/bin/sh\necho hi\n');
    const c = ctx();
    const to = join(home, '.claude', 'hooks', 'hook.sh');
    const r = c.copy(join(repo, 'hook.sh'), to, 0o755);
    expect(readFileSync(to, 'utf8')).toBe('#!/bin/sh\necho hi\n');
    expect(statSync(to).mode & 0o777).toBe(0o755);
    expect(r.createdDirs).toEqual([join(home, '.claude'), join(home, '.claude', 'hooks')]);
  });

  it('remove backs up then deletes', () => {
    const f = join(home, 'x.txt');
    writeFileSync(f, 'bye');
    const c = ctx();
    const r = c.remove(f);
    expect(existsSync(f)).toBe(false);
    expect(readFileSync(r.backupPath!, 'utf8')).toBe('bye');
  });

  it('dry-run writes nothing', () => {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), '{"model":"opus"}');
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# Mine\n');
    writeFileSync(join(home, 'old.txt'), 'old');
    writeFileSync(join(repo, 'f.sh'), 'echo\n');
    const before = snapshot(home);

    const c = ctx(true);
    c.writeText(join(home, '.gemini', 'GEMINI.md'), 'new\n');
    applyJsonMerge(c, join(home, '.claude', 'settings.json'), hookPatch);
    applyJsonMerge(c, join(home, '.codex', 'hooks.json'), hookPatch);
    applyBlock(c, join(home, '.claude', 'CLAUDE.md'), 'rule', 'Be careful.', 'md');
    c.copy(join(repo, 'f.sh'), join(home, '.claude', 'hooks', 'f.sh'), 0o755);
    c.remove(join(home, 'old.txt'));
    saveState(home, { version: 1, items: {} }, true);

    expect(snapshot(home)).toEqual(before);
    expect(c.planned.length).toBeGreaterThanOrEqual(6);
    // Later reads in the same dry run see the planned content.
    expect(c.readText(join(home, '.gemini', 'GEMINI.md'))).toBe('new\n');
    expect(c.exists(join(home, 'old.txt'))).toBe(false);
  });

  it('refuses to touch a JSON file with comments and names it', () => {
    const f = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'));
    const jsonc = '{\n  // my comment\n  "model": "opus"\n}\n';
    writeFileSync(f, jsonc);
    expect(() => applyJsonMerge(ctx(), f, hookPatch)).toThrow(f);
    expect(readFileSync(f, 'utf8')).toBe(jsonc);
    expect(existsSync(join(home, '.agentic-setup'))).toBe(false);
  });
});

describe('reversible JSON and blocks through Ctx', () => {
  it('writing through a symlinked settings.json keeps the link and updates the target', () => {
    mkdirSync(join(home, 'dotfiles'));
    mkdirSync(join(home, '.claude'));
    const real = join(home, 'dotfiles', 'settings.json');
    const link = join(home, '.claude', 'settings.json');
    const original = '{\n  "a": 1\n}';
    writeFileSync(real, original);
    chmodSync(real, 0o600);
    symlinkSync('../dotfiles/settings.json', link);
    const c = ctx();
    const u = applyJsonMerge(c, link, hookPatch);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe('../dotfiles/settings.json');
    expect(JSON.parse(readFileSync(real, 'utf8'))).toEqual({ a: 1, ...hookPatch });
    expect(statSync(real).mode & 0o777).toBe(0o600);
    expect(readFileSync(u.backupPath!, 'utf8')).toBe(original);
    expect(readdirSync(join(home, '.claude'))).toEqual(['settings.json']);
    // A copy onto the link writes through it too.
    const src = join(repo, 'x.json');
    writeFileSync(src, '{"b": 2}\n');
    ctx().copy(src, link);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe('{"b": 2}\n');
    writeFileSync(real, original);
    // Uninstall restores the original bytes through the link.
    const v = applyJsonMerge(ctx(), link, { c: 3 });
    expect(undoJsonMerge(ctx(), link, v).status).toBe('restored');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe(original);
  });

  it('uninstall restores original bytes when target had no trailing newline and pre-existing hooks', () => {
    const f = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'));
    const original =
      '{\n    "hooks": {\n        "PreToolUse": [\n            {"matcher": "Bash", "hooks": [{"type": "command", "command": "user-guard.sh"}]}\n        ]\n    },\n    "model":   "opus"\n}';
    writeFileSync(f, original);

    const undo = applyJsonMerge(ctx(), f, hookPatch);
    const written = readFileSync(f, 'utf8');
    expect(written.endsWith('\n')).toBe(false);
    expect(written).toContain('\n    "hooks"');
    const parsed = JSON.parse(written);
    expect(parsed.hooks.PreToolUse).toHaveLength(2);
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe('user-guard.sh');

    // Undo from a fresh Ctx (a later uninstall run), with undo data that went through state.json.
    const fromState = JSON.parse(JSON.stringify(undo));
    const res = undoJsonMerge(ctx(), f, fromState);
    expect(res).toEqual({ status: 'restored', userChanged: false });
    expect(readFileSync(f, 'utf8')).toBe(original);
  });

  it('a second merge of the same patch writes nothing and records nothing', () => {
    const f = join(home, 'settings.json');
    writeFileSync(f, '{"a": 1}\n');
    applyJsonMerge(ctx(), f, hookPatch);
    const after = readFileSync(f, 'utf8');
    const c = ctx();
    const undo2 = applyJsonMerge(c, f, hookPatch);
    expect(undo2.added).toEqual([]);
    expect(undo2.afterHash).toBeNull();
    expect(c.planned).toEqual([]);
    expect(readFileSync(f, 'utf8')).toBe(after);
  });

  it('uninstall unmerges and keeps the user edit when settings.json changed since install', () => {
    const f = join(home, 'settings.json');
    writeFileSync(f, '{\n\t"model": "opus"\n}\n');
    const undo = applyJsonMerge(ctx(), f, hookPatch);
    const cur = JSON.parse(readFileSync(f, 'utf8'));
    cur.theme = 'dark';
    writeFileSync(f, JSON.stringify(cur, null, '\t') + '\n');

    const res = undoJsonMerge(ctx(), f, undo);
    expect(res).toEqual({ status: 'unmerged', userChanged: true });
    expect(readFileSync(f, 'utf8')).toBe('{\n\t"model": "opus",\n\t"theme": "dark"\n}\n');
  });

  it('uninstall deletes a JSON file it created', () => {
    const f = join(home, '.codex', 'hooks.json');
    const undo = applyJsonMerge(ctx(), f, hookPatch);
    expect(readFileSync(f, 'utf8').endsWith('}\n')).toBe(true);
    undoJsonMerge(ctx(), f, undo);
    expect(existsSync(f)).toBe(false);
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  it('uninstall removes only own block when user edited outside it', () => {
    const f = join(home, '.claude', 'CLAUDE.md');
    mkdirSync(join(home, '.claude'));
    writeFileSync(f, '# Mine\nline');
    const undo = applyBlock(ctx(), f, 'rule', 'Be careful.', 'md');
    const installed = readFileSync(f, 'utf8');
    writeFileSync(f, 'Added on top\n' + installed + '\nAdded below\n');

    const res = undoBlock(ctx(), f, 'rule', 'md', JSON.parse(JSON.stringify(undo)));
    expect(res).toEqual({ status: 'removed', userChanged: true });
    expect(readFileSync(f, 'utf8')).toBe('Added on top\n# Mine\nline\nAdded below\n');
  });

  it('uninstall leaves the file alone when the user edited inside the block', () => {
    const f = join(home, '.claude', 'CLAUDE.md');
    mkdirSync(join(home, '.claude'));
    writeFileSync(f, '# Mine\n');
    const undo = applyBlock(ctx(), f, 'rule', 'Be careful.', 'md');
    const edited = readFileSync(f, 'utf8').replace('Be careful.', 'Be careful. My own note.');
    writeFileSync(f, edited);

    const res = undoBlock(ctx(), f, 'rule', 'md', JSON.parse(JSON.stringify(undo)));
    expect(res).toEqual({ status: 'skipped', userChanged: true });
    expect(readFileSync(f, 'utf8')).toBe(edited);
  });

  it('block uninstall restores exact bytes when nothing else changed', () => {
    const f = join(home, 'AGENTS.md');
    writeFileSync(f, '# Mine\n');
    const undo = applyBlock(ctx(), f, 'rule', 'Be careful.', 'md');
    expect(undoBlock(ctx(), f, 'rule', 'md', undo)).toEqual({ status: 'removed', userChanged: false });
    expect(readFileSync(f, 'utf8')).toBe('# Mine\n');
  });

  it('block uninstall puts back a replaced block body', () => {
    const f = join(home, 'AGENTS.md');
    writeFileSync(f, '# Mine\n');
    applyBlock(ctx(), f, 'rule', 'v1', 'md');
    const v1 = readFileSync(f, 'utf8');
    const undo = applyBlock(ctx(), f, 'rule', 'v2', 'md');
    undoBlock(ctx(), f, 'rule', 'md', undo);
    expect(readFileSync(f, 'utf8')).toBe(v1);
  });

  it('uninstall removes dirs it created and nothing else', () => {
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, 'unrelated', 'empty'), { recursive: true });
    const before = snapshot(home);

    const gem = join(home, '.gemini', 'GEMINI.md');
    const claude = join(home, '.claude', 'CLAUDE.md');
    const codex = join(home, '.codex', 'deep', 'hooks.json');
    const c = ctx();
    const u1 = applyBlock(c, gem, 'rule', 'Be careful.', 'md');
    const u2 = applyBlock(c, claude, 'rule', 'Be careful.', 'md');
    const u3 = applyJsonMerge(c, codex, hookPatch);
    expect(u1.createdDirs).toEqual([join(home, '.gemini')]);
    expect(u2.createdDirs).toEqual([]);
    expect(u3.createdDirs).toEqual([join(home, '.codex'), join(home, '.codex', 'deep')]);

    const u = ctx();
    undoJsonMerge(u, codex, u3);
    undoBlock(u, claude, 'rule', 'md', u2);
    undoBlock(u, gem, 'rule', 'md', u1);
    // Backups taken by the install and uninstall runs live in the installer's own dir.
    expect(snapshot(home, true)).toEqual(before);
    expect(existsSync(join(home, '.gemini'))).toBe(false);
    expect(existsSync(join(home, '.codex'))).toBe(false);
    expect(existsSync(join(home, '.claude'))).toBe(true);
  });

  it('keeps a created dir that the user put files in', () => {
    const gem = join(home, '.gemini', 'GEMINI.md');
    const undo = applyBlock(ctx(), gem, 'rule', 'Be careful.', 'md');
    writeFileSync(join(home, '.gemini', 'user.json'), '{}');
    undoBlock(ctx(), gem, 'rule', 'md', undo);
    expect(existsSync(gem)).toBe(false);
    expect(existsSync(join(home, '.gemini', 'user.json'))).toBe(true);
  });
});

describe('state', () => {
  it('loadState returns an empty state when none exists', () => {
    expect(loadState(home)).toEqual({ version: 1, items: {} });
  });

  it('state save is atomic and round-trips', () => {
    const s: State = {
      version: 1,
      items: {
        demo: {
          id: 'demo',
          agents: ['claude-code'],
          installedAt: '2026-11-03T00:00:00.000Z',
          actions: [{
            kind: 'block', file: join(home, 'AGENTS.md'), id: 'demo', body: 'x', style: 'md',
            undoData: {
              separator: '\n', previousBlock: null, blockHash: 'def', originalHash: null, afterHash: 'abc',
              backupPath: null, createdDirs: [],
            },
          }],
        },
      },
    };
    saveState(home, { version: 1, items: {} }, false);
    saveState(home, s, false);
    expect(loadState(home)).toEqual(s);
    const dir = join(home, '.agentic-setup');
    expect(readdirSync(dir)).toEqual(['state.json']);
    expect(readFileSync(join(dir, 'state.json'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('saveState in dry-run writes nothing', () => {
    saveState(home, { version: 1, items: {} }, true);
    expect(existsSync(join(home, '.agentic-setup'))).toBe(false);
  });

  it('loadState names the file when state.json is corrupt', () => {
    mkdirSync(join(home, '.agentic-setup'));
    writeFileSync(join(home, '.agentic-setup', 'state.json'), '{nope');
    expect(() => loadState(home)).toThrow(join(home, '.agentic-setup', 'state.json'));
  });
});
