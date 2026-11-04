import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Item, InstallSpec } from '../../src/manifest/types.js';
import type { Env } from '../../src/detect.js';
import type { Action } from '../../src/actions.js';
import { Ctx } from '../../src/fs/ctx.js';
import { applyJsonMerge, undoJsonMerge, type JsonMergeUndo } from '../../src/fs/json-merge.js';
import { applyBlock, undoBlock, type BlockUndo } from '../../src/fs/blocks.js';

export function fresh(): { home: string; repo: string; env: Env } {
  const home = mkdtempSync(join(tmpdir(), 'as-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'as-repo-'));
  return { home, repo, env: { home, path: '', platform: 'darwin' } };
}

export const mkItem = (install: InstallSpec, id = 'x'): Item => ({
  id, name: id, pack: 'core', summary: '', benefit: ['quality'], details: '', kinds: ['mcp'],
  agents: ['generic'], source: { type: 'local', ref: '' }, redistribution: 'own', risk: 'low',
  token_cost: 0, install, verify: 'true',
});

/** Applies file actions through Ctx and returns an undo function. */
export function applyAll(actions: Action[], home: string, repo: string): () => void {
  const ctx = new Ctx({ home, repoRoot: repo });
  const undos: (() => void)[] = [];
  for (const a of actions) {
    if (a.kind === 'json-merge') {
      const u: JsonMergeUndo = applyJsonMerge(ctx, a.file, a.patch);
      undos.unshift(() => { undoJsonMerge(ctx, a.file, u); });
    } else if (a.kind === 'block') {
      const u: BlockUndo = applyBlock(ctx, a.file, a.id, a.body, a.style);
      undos.unshift(() => { undoBlock(ctx, a.file, a.id, a.style, u); });
    }
  }
  return () => undos.forEach((f) => f());
}
