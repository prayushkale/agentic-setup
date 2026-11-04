#!/usr/bin/env node
// bundle-assets.mjs: copy what the published installer needs into installer/assets/.
//   node tools/bundle-assets.mjs [--src <repo root>] [--out <dir>]
// Copies manifest/, docs/items/ and templates/ (when present), plus only the packs/ paths that
// `own` items reference (install.local_skills, install.rule, install.files[].from).
// Never copies private/ or work/. Called from the installer's `prepack`.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { src: { type: 'string' }, out: { type: 'string' } } });
const src = resolve(values.src ?? join(here, '..'));
const out = resolve(values.out ?? join(here, '..', 'installer', 'assets'));
// yaml is an installer dependency; resolve it from there.
const { parse } = createRequire(join(here, '..', 'installer', 'package.json'))('yaml');

const FORBIDDEN = /^(private|work)(\/|$)/;
const rel = (p) => normalize(p).split(sep).join('/');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const items = join(src, 'manifest', 'items.yaml');
if (!existsSync(items)) {
  console.error(`bundle-assets: no ${items}; refusing to bundle without a manifest`);
  process.exit(1);
}

const copy = (p) => {
  const r = rel(p);
  if (r.startsWith('..') || FORBIDDEN.test(r)) throw new Error(`bundle-assets: refusing to bundle ${p}`);
  if (!existsSync(join(src, r))) throw new Error(`bundle-assets: ${r} does not exist`);
  mkdirSync(dirname(join(out, r)), { recursive: true });
  cpSync(join(src, r), join(out, r), { recursive: true });
};

for (const d of ['manifest', 'docs/items', 'templates']) if (existsSync(join(src, d))) copy(d);

const doc = parse(readFileSync(items, 'utf8'));
const list = Array.isArray(doc) ? doc : (doc?.items ?? []);
const paths = new Set();
for (const it of list) {
  if (it?.redistribution !== 'own') continue;
  const i = it.install ?? {};
  for (const p of [...(i.local_skills ?? []), i.rule, ...(i.files ?? []).map((f) => f?.from)]) {
    if (typeof p === 'string' && rel(p).startsWith('packs/')) paths.add(rel(p));
  }
}
for (const p of [...paths].sort()) copy(p);

// Every repo path any item references must now be in assets/, or the bundled manifest is broken.
for (const it of list) {
  const i = it?.install ?? {};
  for (const p of [...(i.local_skills ?? []), i.rule, ...(i.files ?? []).map((f) => f?.from)]) {
    if (typeof p === 'string' && !existsSync(join(out, rel(p)))) {
      throw new Error(`bundle-assets: ${it.id} references ${p}, which is not bundled (only own packs/ paths are)`);
    }
  }
}
// stderr: `npm pack --json` prints its JSON on stdout, and prepack output must not mix into it.
console.error(`bundle-assets: ${out} (${paths.size} pack paths)`);
