#!/usr/bin/env node
// check-redistribution.mjs: prove every shipped file is our own content.
//   node tools/check-redistribution.mjs [--root <repo>] [--work <dir>]
// Shipped = packs/**, plugins/**, and everything tools/bundle-assets.mjs puts in installer/assets/.
// Fails when a shipped file:
//   - traces to no manifest item (provenance unknown), or to an item whose redistribution is not `own`
//   - is referenced by an item through a path under work/ or private/, or is a symlink
//   - is byte-identical to a file under the work dir (default <root>/work; extracted third-party zips)
// manifest/ and docs/items/ in the assets are generated from the manifest and count as own.
// In plugins/, .claude-plugin/plugin.json and hooks/hooks.json are generated metadata.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readManifest } from './lib/common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { root: { type: 'string' }, work: { type: 'string' } } });
const root = resolve(values.root ?? join(here, '..'));
const workDir = resolve(values.work ?? join(root, 'work'));
const MIN_HASH_BYTES = 64; // tiny files ("{}", blank lines) match by accident
const FORBIDDEN = /^(private|work)(\/|$)/;

const rel = (p) => normalize(p).split(sep).join('/');
const problems = [];
const fail = (msg) => problems.push(msg);

/** Files under dir (relative, '/'-separated), symlinks listed as files, not followed. */
function files(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory()) out.push(...files(p).map((f) => `${name}/${f}`));
    else out.push(name);
  }
  return out;
}

const { items } = readManifest(root);

/** Repo paths each item references. */
function refs(it) {
  const i = it.install ?? {};
  const list = [...(i.local_skills ?? []), i.rule, ...(i.files ?? []).map((f) => f?.from)];
  if (it.source?.type === 'local') list.push(it.source.ref);
  return list.filter((p) => typeof p === 'string').map(rel);
}

for (const it of items) {
  for (const p of refs(it)) if (FORBIDDEN.test(p) || p.startsWith('..')) fail(`${it.id}: references ${p} (work/, private/ and outside paths are never shipped)`);
}

/** Items whose referenced paths cover repo path p (equal, or a parent dir). */
const owners = (p) => items.filter((it) => refs(it).some((r) => p === r || p.startsWith(`${r}/`)));

function needOwn(label, p, its) {
  if (!its.length) return fail(`${label}: no manifest item references it, so its provenance is unknown`);
  for (const it of its) {
    if (it.redistribution !== 'own') fail(`${label}: comes from item ${it.id}, which is ${it.redistribution}, not own`);
  }
}

const shipped = []; // [label, absolute path]

// packs/
for (const f of files(join(root, 'packs'))) {
  const p = `packs/${f}`;
  shipped.push([p, join(root, p)]);
  needOwn(p, p, owners(p));
}

// plugins/<pack>/{skills/<name>|hooks/<item>}/...
for (const f of files(join(root, 'plugins'))) {
  const p = `plugins/${f}`;
  shipped.push([p, join(root, p)]);
  const [pack, kind, name, ...rest] = f.split('/');
  if ((kind === '.claude-plugin' && name === 'plugin.json' && !rest.length) || (kind === 'hooks' && name === 'hooks.json' && !rest.length)) continue;
  const inPack = items.filter((it) => it.pack === pack);
  let its = [];
  if (kind === 'skills' && rest.length) {
    its = inPack.filter((it) => it.id === name || (it.install?.local_skills ?? []).some((d) => basename(d) === name));
  } else if (kind === 'hooks' && rest.length) {
    its = inPack.filter((it) => it.id === name);
  }
  needOwn(p, p, its);
}

// installer/assets as bundle-assets would build it
const out = mkdtempSync(join(tmpdir(), 'redist-assets-'));
try {
  const b = spawnSync('node', [join(here, 'bundle-assets.mjs'), '--src', root, '--out', out], { encoding: 'utf8' });
  if (b.status !== 0) fail(`bundle-assets failed: ${(b.stderr || b.stdout).trim().split('\n').pop()}`);
  for (const f of files(out)) {
    if (FORBIDDEN.test(f)) fail(`assets: ${f} is under work/ or private/`);
    shipped.push([`assets: ${f}`, join(out, f)]);
    if (/^(manifest|docs\/items)\//.test(f)) continue;
    needOwn(`assets: ${f}`, f, owners(f));
  }

  for (const [label, abs] of shipped) {
    if (lstatSync(abs).isSymbolicLink()) fail(`${label}: is a symlink (to ${realpathSafe(abs)}); ship real files only`);
  }

  // byte-identical copies of extracted third-party files
  let compared = false;
  if (existsSync(workDir)) {
    compared = true;
    const bySize = new Map();
    for (const [label, abs] of shipped) {
      if (lstatSync(abs).isSymbolicLink()) continue;
      const size = lstatSync(abs).size;
      if (size < MIN_HASH_BYTES) continue;
      if (!bySize.has(size)) bySize.set(size, []);
      bySize.get(size).push([label, sha(abs)]);
    }
    for (const f of files(workDir)) {
      const abs = join(workDir, f);
      const st = lstatSync(abs);
      if (!st.isFile() || !bySize.has(st.size)) continue;
      const h = sha(abs);
      for (const [label, sh] of bySize.get(st.size)) if (sh === h) fail(`${label}: identical to ${relative(root, abs) || abs} (third-party extracted file)`);
    }
  }

  if (problems.length) {
    console.error(`check-redistribution: ${problems.length} problem(s)\n- ${[...new Set(problems)].join('\n- ')}`);
    process.exit(1);
  }
  console.log(`check-redistribution: ok (${shipped.length} files; ${compared ? `compared against ${workDir}` : 'no work dir to compare against'})`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

function sha(p) { return createHash('sha256').update(readFileSync(p)).digest('hex'); }
function realpathSafe(p) { try { return realpathSync(p); } catch { return 'a missing target'; } }
