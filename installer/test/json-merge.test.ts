import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeJson, trackJsonBefore, undoJsonTrack, unmergeJson } from '../src/fs/json-merge.js';
import { Ctx } from '../src/fs/ctx.js';

const settings = () => ({
  model: 'opus',
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'user-guard.sh' }] },
    ],
  },
});

const patch = () => ({
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook' }] },
    ],
    SessionStart: [{ hooks: [{ type: 'command', command: 'hello' }] }],
  },
  statusLine: { type: 'command', command: 'ccstatus' },
});

describe('mergeJson', () => {
  it('mergeJson is idempotent: merge(merge(a,p),p) deep-equals merge(a,p)', () => {
    const once = mergeJson(settings(), patch());
    const twice = mergeJson(once.result, patch());
    expect(twice.result).toEqual(once.result);
    expect(twice.added).toEqual([]);
  });

  it('appends to an existing hooks.PreToolUse array instead of replacing it', () => {
    const { result } = mergeJson(settings(), patch()) as { result: any };
    expect(result.hooks.PreToolUse).toHaveLength(2);
    expect(result.hooks.PreToolUse[0].hooks[0].command).toBe('user-guard.sh');
    expect(result.hooks.PreToolUse[1].hooks[0].command).toBe('rtk hook');
    expect(result.model).toBe('opus');
  });

  it('mergeJson keeps user scalar and reports conflict', () => {
    const r = mergeJson({ model: 'opus', a: { b: 1 } }, { model: 'sonnet', a: { b: 2, c: 3 } });
    expect(r.result).toEqual({ model: 'opus', a: { b: 1, c: 3 } });
    expect(r.conflicts).toEqual([
      { path: ['model'], existing: 'opus', wanted: 'sonnet' },
      { path: ['a', 'b'], existing: 1, wanted: 2 },
    ]);
    expect(r.added.map((p) => p.path)).toEqual([['a', 'c']]);
  });

  it('reports a type mismatch as a conflict and leaves the user value', () => {
    const r = mergeJson({ hooks: 'none' }, { hooks: { X: [1] } });
    expect(r.result).toEqual({ hooks: 'none' });
    expect(r.conflicts).toHaveLength(1);
    expect(r.added).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const a = settings();
    const p = patch();
    mergeJson(a, p);
    expect(a).toEqual(settings());
    expect(p).toEqual(patch());
  });

  it('treats an absent target as an empty object', () => {
    const r = mergeJson(undefined, { a: { b: [1] } });
    expect(r.result).toEqual({ a: { b: [1] } });
    expect(unmergeJson(r.result, r.added)).toEqual({});
  });
});

describe('unmergeJson', () => {
  it('unmergeJson(mergeJson(a,p)) deep-equals a', () => {
    const cases: [unknown, unknown][] = [
      [settings(), patch()],
      [{}, patch()],
      [{ hooks: {} }, patch()],
      [{ list: [1, 2] }, { list: [2, 3, 4] }],
      [{ model: 'opus' }, { model: 'sonnet', env: { A: '1' } }],
    ];
    for (const [a, p] of cases) {
      const before = structuredClone(a);
      const { result, added } = mergeJson(a, p);
      expect(unmergeJson(result, added)).toEqual(before);
    }
  });

  it('keeps a container it created when the user added to it', () => {
    const { result, added } = mergeJson({}, { env: { A: '1' } }) as { result: any; added: any };
    result.env.USER = 'mine';
    expect(unmergeJson(result, added)).toEqual({ env: { USER: 'mine' } });
  });

  it('does not prune a pre-existing container that becomes empty', () => {
    const { result, added } = mergeJson({ hooks: {} }, { hooks: { X: [1] } });
    expect(unmergeJson(result, added)).toEqual({ hooks: {} });
  });

  it('removes its array element even after the user reordered the array', () => {
    const { result, added } = mergeJson({ list: ['u1'] }, { list: ['ours'] }) as { result: any; added: any };
    result.list = ['ours', 'u1', 'u2'];
    expect(unmergeJson(result, added)).toEqual({ list: ['u1', 'u2'] });
  });

  it('leaves a value the user changed after install', () => {
    const { result, added } = mergeJson({}, { a: 1 }) as { result: any; added: any };
    result.a = 2;
    expect(unmergeJson(result, added)).toEqual({ a: 2 });
  });
});

describe('jsonTrack (R22)', () => {
  it('unparseable settings.json before the command: every tracked path counts as existed, nothing is removed', () => {
    const home = mkdtempSync(join(tmpdir(), 'as-track-'));
    const file = join(home, 'settings.json');
    writeFileSync(file, '{ // a comment\n  "model": "x"\n}\n');
    const ctx = new Ctx({ home, repoRoot: home });
    const track = { file, paths: [['enabledPlugins', 'p@mk']] };
    const before = trackJsonBefore(ctx, track);
    expect(before).toEqual({ fileExisted: true, existed: [[true, true]] });
    const after = '{\n  "enabledPlugins": {\n    "p@mk": true\n  }\n}\n';
    writeFileSync(file, after);
    undoJsonTrack(ctx, track, before);
    expect(readFileSync(file, 'utf8')).toBe(after);
  });
});
