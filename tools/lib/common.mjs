// Shared helpers for gen-marketplace.mjs and gen-item-docs.mjs. Reads the manifest YAML directly.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse } from 'yaml';

const listOf = (doc, key) => (doc && !Array.isArray(doc) && typeof doc === 'object' ? doc[key] : doc) ?? [];

export function readManifest(root) {
  const read = (f) => parse(readFileSync(join(root, 'manifest', f), 'utf8'));
  return { packs: listOf(read('packs.yaml'), 'packs'), items: listOf(read('items.yaml'), 'items') };
}

/** Recursively lists files under `dir` (relative paths, sorted). Missing dir -> []. */
export function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p).map((f) => join(name, f)));
    else out.push(name);
  }
  return out;
}

/**
 * Compares `files` (Map relPath -> string|Buffer, relative to `root`) with disk. Under `check`,
 * returns the stale paths and writes nothing; otherwise writes the files. `owned` lists dirs
 * (relative to root) whose extra, ungenerated files count as stale (and are not deleted).
 */
export function sync(root, files, { check, owned = [] }) {
  const stale = [];
  for (const [rel, content] of files) {
    const abs = join(root, rel);
    const want = Buffer.from(content);
    if (!existsSync(abs) || !readFileSync(abs).equals(want)) {
      stale.push(rel);
      if (!check) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, want);
      }
    }
  }
  for (const dir of owned) {
    for (const f of walk(join(root, dir))) {
      const rel = join(dir, f);
      if (!files.has(rel)) stale.push(`${rel} (not generated)`);
    }
  }
  return stale;
}

export const rel = (root, p) => relative(root, p);
