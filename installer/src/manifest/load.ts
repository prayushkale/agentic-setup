import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Manifest } from './types.js';
import { validateManifest } from './validate.js';

const listOf = (doc: unknown, key: string): unknown =>
  doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>)[key] : doc;

/**
 * Reads items.yaml and packs.yaml from `dir` (each a bare list or `{items|packs: [...]}`).
 * Repo-relative paths in the manifest resolve against `repoRoot`, default `dir`
 * (the real repo passes its root, with `dir` = <root>/manifest).
 */
export function loadManifest(dir: string, repoRoot: string = dir): Manifest {
  const packs = listOf(parse(readFileSync(join(dir, 'packs.yaml'), 'utf8')), 'packs') ?? [];
  const items = listOf(parse(readFileSync(join(dir, 'items.yaml'), 'utf8')), 'items') ?? [];
  const m = { packs, items };
  const r = validateManifest(m, repoRoot);
  if (!r.ok) throw new Error(`Invalid manifest:\n- ${r.errors.join('\n- ')}`);
  return m as Manifest;
}
