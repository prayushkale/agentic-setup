import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadManifest } from '../src/manifest/load.js';
import { validateManifest } from '../src/manifest/validate.js';
import { checkSkill } from '../src/skills/format.js';
import { PACK_IDS } from '../src/manifest/types.js';

const REPO = resolve(import.meta.dirname, '../..');
const MANIFEST = join(REPO, 'manifest');

describe('real manifest', () => {
  it('loads with zero validation errors', () => {
    const m = loadManifest(MANIFEST, REPO);
    expect(validateManifest(m, REPO).errors).toEqual([]);
    expect(m.items.length).toBeGreaterThan(20);
  });

  it('has every pack, core default yes and the rest default no', () => {
    const m = loadManifest(MANIFEST, REPO);
    expect(m.packs.map((p) => p.id).sort()).toEqual([...PACK_IDS].sort());
    for (const p of m.packs) expect(p.default).toBe(p.id === 'core');
    for (const id of PACK_IDS) expect(m.items.some((i) => i.pack === id)).toBe(true);
  });

  it('every own packs/ skill passes checkSkill', () => {
    const m = loadManifest(MANIFEST, REPO);
    const dirs = m.items.filter((i) => i.redistribution === 'own').flatMap((i) => i.install.local_skills ?? []);
    expect(dirs.length).toBeGreaterThan(0);
    for (const d of dirs) expect({ d, ...checkSkill(join(REPO, d)) }).toEqual({ d, ok: true, errors: [] });
  });

  it('carries the fixed values from the brief', () => {
    const m = loadManifest(MANIFEST, REPO);
    const by = (id: string) => m.items.find((i) => i.id === id)!;
    expect(by('accept-gate').risk).toBe('med');
    expect(by('accept-gate').risk_reason).toBe(
      'Open bypass: the agent can rewrite the pin file unless an OS sandbox denies writes to it.',
    );
    // R26 supersedes the brief's `command -v rtk`: the hook must be checked too.
    expect(by('rtk').detect).toBe("command -v rtk >/dev/null && grep -qs 'rtk hook claude' ~/.claude/settings.json");
    expect(by('rtk').install.hooks).toEqual({ 'claude-code': { event: 'PreToolUse', matcher: 'Bash', command: 'rtk hook claude' } });
    expect(by('ccusage-statusline').install.settings).toEqual({
      statusLine: { type: 'command', command: 'ccusage statusline -B emoji', padding: 0 },
    });
    expect(by('serena').install.files).toEqual([{ from: 'packs/core/serena-here', to: '~/.local/bin/serena-here', mode: 0o755 }]);
    expect(by('superpowers').install.plugin).toEqual({ marketplace: 'obra/superpowers-marketplace', name: 'superpowers@superpowers-marketplace' });
    expect(by('grilling-followup').requires).toEqual(['grill-me']);
    expect(by('agents-md').install.rule).toBe('templates/AGENTS.md');
    expect(m.items.some((i) => /graft/i.test(JSON.stringify(i)))).toBe(false);
  });

  it('rtk detect requires the hook', () => {
    const m = loadManifest(MANIFEST, REPO);
    const rtk = m.items.find((i) => i.id === 'rtk')!;
    expect(rtk.detect).toMatch(/command -v rtk/);
    expect(rtk.detect).toMatch(/grep -qs 'rtk hook claude' ~\/\.claude\/settings\.json/);
    expect(rtk.install.commands_unless).toBe('command -v rtk');
  });

  it('skips the install commands of tools the user already has', () => {
    const m = loadManifest(MANIFEST, REPO);
    const unless = Object.fromEntries(m.items.filter((i) => i.install.commands_unless).map((i) => [i.id, i.install.commands_unless]));
    expect(unless).toEqual({
      rtk: 'command -v rtk', 'ccusage-statusline': 'command -v ccusage', serena: 'command -v serena',
      'agent-browser': 'command -v agent-browser',
    });
  });

  it('marks every non-zero token_cost as an estimate', () => {
    const lines = readFileSync(join(MANIFEST, 'items.yaml'), 'utf8').split('\n').filter((l) => /^\s*token_cost:/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) if (!/token_cost:\s*0\s*$/.test(l.replace(/\s*#.*$/, ''))) expect(l).toMatch(/# est\b/);
  });

  it('pins what it fetches and detects every skill of multi-skill items', () => {
    const m = loadManifest(MANIFEST, REPO);
    const by = (id: string) => m.items.find((i) => i.id === id)!;
    expect(by('blender-mcp').install.mcp!.args).toEqual(['mcp-for-blender==2.2.6']);
    expect(by('blender-mcp').manual).toContain('uvx mcp-for-blender==2.2.6 install-addon');
    const curl = by('differential-review').post_install!.find((c) => c.startsWith('curl'))!;
    expect(curl).toMatch(/raw\.githubusercontent\.com\/trailofbits\/skills\/[0-9a-f]{40}\//);
    for (const it of m.items) {
      const names = it.install.skills?.names ?? [];
      if (names.length < 2) continue;
      for (const n of names) expect({ id: it.id, n, hit: new RegExp(`(^|[\\s/])${n}([\\s/;]|$)`).test(it.detect ?? '') }).toEqual({ id: it.id, n, hit: true });
    }
  });

  it('serena-here works when only one of claude / cmd is installed', () => {
    const bin = mkdtempSync(join(tmpdir(), 'as-serena-bin-'));
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\necho "claude $*" >> "$LOG"\n', { mode: 0o755 });
    const log = join(bin, 'log');
    const env = { PATH: bin, LOG: log };
    const script = join(REPO, 'packs/core/serena-here');
    execFileSync('/bin/bash', [script], { env, cwd: bin, stdio: 'pipe' });
    execFileSync('/bin/bash', [script, '--remove'], { env, cwd: bin, stdio: 'pipe' });
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines[0]).toMatch(/^claude mcp add serena -s local/);
    expect(lines[1]).toBe('claude mcp remove serena -s local');
  });

  const hasRules =existsSync(join(REPO, 'private/scrub-rules.json'));
  it.skipIf(!hasRules)('scrub.py accepts paths and makes no changes to manifest, templates or packs (skipped: private/scrub-rules.json absent)', () => {
    const out = execFileSync('python3', ['-I', join(REPO, 'tools/scrub.py'), 'manifest', 'templates', 'packs'], { cwd: REPO, encoding: 'utf8' });
    const m = /^scrubbed (\d+) files \((\d+) rules\)/m.exec(out);
    expect(m, out).not.toBeNull();
    expect(Number(m![2])).toBeGreaterThan(0);
    expect(Number(m![1])).toBe(0);
  });

  it('bundle-assets fails when manifest/items.yaml is missing', () => {
    const src = mkdtempSync(join(tmpdir(), 'as-bundle-empty-'));
    const out = join(mkdtempSync(join(tmpdir(), 'as-bundle-out-')), 'assets');
    expect(() => execFileSync(process.execPath, [join(REPO, 'tools/bundle-assets.mjs'), '--src', src, '--out', out], { stdio: 'pipe' })).toThrow();
  });

  // R19: `perl -pi` on a missing file exits 0, so every patch step checks its target first.
  it('guards every perl patch step against a missing target', () => {
    const m = loadManifest(MANIFEST, REPO);
    const steps = m.items.flatMap((i) => (i.post_install ?? []).filter((c) => /\bperl\b/.test(c)).map((c) => ({ id: i.id, c })));
    expect(steps.length).toBeGreaterThan(0);
    const home = mkdtempSync(join(tmpdir(), 'as-patch-home-'));
    for (const { id, c } of steps) {
      const target = c.trim().split(/\s+/).at(-1)!.replace(/^~\//, '$HOME/');
      const guard = `test -f "${target}" || { echo "missing ${target}" >&2; exit 1; } && perl `;
      expect({ id, guarded: c.startsWith(guard) }).toEqual({ id, guarded: true });
      let err = '';
      try {
        execFileSync('/bin/sh', ['-c', c], { env: { HOME: home, PATH: '/usr/bin:/bin' }, stdio: 'pipe' });
      } catch (e) {
        err = String((e as { stderr?: Buffer }).stderr ?? 'failed');
      }
      expect({ id, err }).toEqual({ id, err: expect.stringContaining('missing') });
    }
  });
});
