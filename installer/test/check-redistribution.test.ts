import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');

function yamlPackageDir(): string {
  let d = dirname(createRequire(import.meta.url).resolve('yaml'));
  while (!existsSync(join(d, 'package.json')) || JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).name !== 'yaml') d = dirname(d);
  return d;
}

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** A copy of everything the check reads, so tests never touch the repo. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'redist-'));
  roots.push(root);
  for (const d of ['manifest', 'packs', 'plugins', 'tools', 'templates', 'docs/items', '.claude-plugin']) {
    if (existsSync(join(REPO, d))) cpSync(join(REPO, d), join(root, d), { recursive: true });
  }
  mkdirSync(join(root, 'installer/node_modules'), { recursive: true });
  cpSync(join(REPO, 'installer/package.json'), join(root, 'installer/package.json'));
  symlinkSync(yamlPackageDir(), join(root, 'installer/node_modules/yaml'));
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(yamlPackageDir(), join(root, 'node_modules/yaml'));
  return root;
}

const check = (root: string, ...args: string[]) =>
  spawnSync('node', [join(root, 'tools/check-redistribution.mjs'), '--root', root, ...args], { cwd: root, encoding: 'utf8' });

const edit = (root: string, f: string, from: string | RegExp, to: string) => {
  const p = join(root, f);
  const s = readFileSync(p, 'utf8');
  const t = s.replace(from, to);
  expect(t).not.toBe(s);
  writeFileSync(p, t);
};

describe('check-redistribution', () => {
  it('passes on the committed packs, plugins and bundled assets', () => {
    const r = check(tempRoot());
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/check-redistribution: ok \(\d+ files/);
  });

  it('fails when a packs/ file belongs to an item that is not own', () => {
    const root = tempRoot();
    edit(root, 'manifest/items.yaml',
      /(source: \{ type: local, ref: packs\/design\/slop-severity\.md \}\n\s+redistribution: )own/, '$1link-only');
    const r = check(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/packs\/design\/slop-severity\.md.*slop-severity.*link-only/);
  });

  it('fails on a packs/ file no item references', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'packs/core/stray.md'), 'copied from somewhere\n');
    const r = check(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/packs\/core\/stray\.md.*no manifest item/);
  });

  it('fails on a plugins/ file that does not trace to an own item', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'plugins/design/skills/borrowed'), { recursive: true });
    writeFileSync(join(root, 'plugins/design/skills/borrowed/SKILL.md'), '---\nname: borrowed\n---\n');
    const r = check(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/plugins\/design\/skills\/borrowed\/SKILL\.md/);
  });

  it('fails on a bundled templates/ file no item references', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'templates/extra.md'), 'not referenced\n');
    const r = check(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/assets: templates\/extra\.md.*no manifest item/);
  });

  it('fails when an item references a path under work/ or private/', () => {
    const root = tempRoot();
    edit(root, 'manifest/items.yaml', 'ref: packs/design/slop-severity.md }', 'ref: work/extracted/L01/x.md }');
    const r = check(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/slop-severity.*work\/extracted\/L01\/x\.md/);
  });

  it('fails on a shipped symlink that points into work/', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'work/extracted/L01'), { recursive: true });
    writeFileSync(join(root, 'work/extracted/L01/a.md'), 'third party\n');
    symlinkSync(join(root, 'work/extracted/L01/a.md'), join(root, 'packs/core/link.md'));
    const r = check(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/packs\/core\/link\.md.*symlink/);
  });

  it('fails when a shipped file is byte-identical to a file under the work dir', () => {
    const root = tempRoot();
    const work = mkdtempSync(join(tmpdir(), 'redist-work-'));
    roots.push(work);
    mkdirSync(join(work, 'extracted/L07'), { recursive: true });
    cpSync(join(root, 'packs/design/slop-severity.md'), join(work, 'extracted/L07/slop.md'));
    const r = check(root, '--work', work);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/packs\/design\/slop-severity\.md.*identical to .*extracted\/L07\/slop\.md/);
  });

  it('says when no work dir was compared', () => {
    const r = check(tempRoot(), '--work', '/nonexistent-work-dir');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no work dir/);
  });
});
