import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Package dir of `yaml` as resolved from here, found by walking up from its entry file. */
function yamlPackageDir(): string {
  let d = dirname(createRequire(import.meta.url).resolve('yaml'));
  while (!existsSync(join(d, 'package.json')) || JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).name !== 'yaml') d = dirname(d);
  return d;
}

const REPO = resolve(import.meta.dirname, '../..');

/** Copies the generator inputs into a temp root so tests never touch the committed output. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'gen-'));
  for (const d of ['manifest', 'packs', 'tools', 'templates', 'catalog/cards']) {
    mkdirSync(join(root, d), { recursive: true });
    if (existsSync(join(REPO, d))) cpSync(join(REPO, d), join(root, d), { recursive: true });
  }
  mkdirSync(join(root, 'installer'), { recursive: true });
  cpSync(join(REPO, 'installer/package.json'), join(root, 'installer/package.json'));
  // the generators import `yaml`; link the installer's copy so this works before a root npm ci
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(yamlPackageDir(), join(root, 'node_modules/yaml'));
  return root;
}

const run = (root: string, script: string, ...args: string[]) =>
  spawnSync('node', [join(root, 'tools', script), ...args], { cwd: root, encoding: 'utf8' });

describe('gen-marketplace', () => {
  it('has one plugin per own pack and none for cloudflare/threejs/video', () => {
    const root = tempRoot();
    try {
      expect(run(root, 'gen-marketplace.mjs').status).toBe(0);
      const mk = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
      expect(mk.owner.name).toBe('prayushkale');
      expect(mk.plugins.map((p: { name: string }) => p.name).sort())
        .toEqual(['core-extras', 'design', 'security', 'verification']);
      for (const p of mk.plugins) {
        expect(existsSync(join(root, p.source, '.claude-plugin/plugin.json'))).toBe(true);
        expect(p.description.length).toBeGreaterThan(0);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('contains no link-only item paths', () => {
    const root = tempRoot();
    try {
      run(root, 'gen-marketplace.mjs');
      const blob = readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8');
      const { parse } = require_yaml();
      const items = parse(readFileSync(join(root, 'manifest/items.yaml'), 'utf8')).items as
        { id: string; redistribution: string; source: { ref: string } }[];
      for (const it of items.filter((i) => i.redistribution === 'link-only')) {
        expect(blob).not.toContain(it.source.ref);
        expect(existsSync(join(root, 'plugins', it.id))).toBe(false);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('rewrites hook commands to the plugin root', () => {
    const root = tempRoot();
    try {
      run(root, 'gen-marketplace.mjs');
      const h = readFileSync(join(root, 'plugins/verification/hooks/hooks.json'), 'utf8');
      expect(h).toContain('${CLAUDE_PLUGIN_ROOT}/hooks/accept-gate/accept-gate.mjs');
      expect(h).not.toContain('.agentic-setup');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('--check fails on stale file and passes after regenerating', () => {
    const root = tempRoot();
    try {
      run(root, 'gen-marketplace.mjs');
      expect(run(root, 'gen-marketplace.mjs', '--check').status).toBe(0);
      writeFileSync(join(root, '.claude-plugin/marketplace.json'), '{}\n');
      const r = run(root, 'gen-marketplace.mjs', '--check');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('marketplace.json');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('gen-item-docs', () => {
  it('writes one doc per item and --check fails when one is stale', () => {
    const root = tempRoot();
    try {
      expect(run(root, 'gen-item-docs.mjs').status).toBe(0);
      expect(readFileSync(join(root, 'docs/items/accept-gate.md'), 'utf8')).toContain('# Accept gate');
      expect(run(root, 'gen-item-docs.mjs', '--check').status).toBe(0);
      writeFileSync(join(root, 'docs/items/accept-gate.md'), 'old\n');
      expect(run(root, 'gen-item-docs.mjs', '--check').status).toBe(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('adds a matching card body but not its internal sections', () => {
    const root = tempRoot();
    try {
      writeFileSync(join(root, 'catalog/cards/X01-rtk.md'),
        '# X01 · rtk\n**What it is.** A shell output filter.\n\n**Overlap with current setup.** INTERNAL-NOTE\n\n**Suggested tier:** C\n');
      run(root, 'gen-item-docs.mjs');
      const d = readFileSync(join(root, 'docs/items/rtk.md'), 'utf8');
      expect(d).toContain('A shell output filter.');
      expect(d).not.toContain('INTERNAL-NOTE');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('committed docs and marketplace are current', () => {
    expect(run(REPO, 'gen-item-docs.mjs', '--check').status).toBe(0);
    expect(run(REPO, 'gen-marketplace.mjs', '--check').status).toBe(0);
  });
});

function require_yaml() { return createRequire(import.meta.url)('yaml') as { parse: (s: string) => any }; }
