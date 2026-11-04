import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateManifest } from '../src/manifest/validate.js';
import { loadManifest } from '../src/manifest/load.js';

const FIX = resolve(import.meta.dirname, 'fixtures/manifest');

const packs = () => [
  { id: 'core', title: 'Core', default: true, summary: 's' },
  { id: 'video', title: 'Video', default: false, summary: 's' },
];
const item = (o: Record<string, unknown> = {}) => ({
  id: 'demo', name: 'Demo', pack: 'core', summary: 's', benefit: ['quality'],
  details: 'docs/items/demo.md', kinds: ['skill'], agents: ['claude-code'],
  source: { type: 'local', ref: 'skills/demo' }, redistribution: 'own',
  risk: 'low', token_cost: 10, install: { local_skills: ['skills/demo'] },
  verify: 'true', ...o,
});
const m = (items: unknown[]) => ({ packs: packs(), items });
const errs = (items: unknown[]) => validateManifest(m(items), FIX).errors.join('\n');

describe('validateManifest', () => {
  it('accepts a minimal valid item', () => {
    const r = validateManifest(m([item()]), FIX);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('validates commands_unless as a command string next to commands', () => {
    expect(errs([item({ install: { commands: ['x'], commands_unless: 'command -v x' } })])).toBe('');
    expect(errs([item({ install: { commands: ['x'], commands_unless: 3 } })])).toContain('commands_unless: must be a string');
    expect(errs([item({ install: { local_skills: ['skills/demo'], commands_unless: 'command -v x' } })])).toContain('commands_unless: needs install.commands');
    expect(errs([item({ install: { commands: ['x'], commands_unless: 'DO_NOT_TRACK=1 x' } })])).toContain('DO_NOT_TRACK');
  });

  it('rejects missing redistribution', () => {
    const { redistribution: _r, ...rest } = item();
    const r = validateManifest(m([rest]), FIX);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('redistribution');
  });

  it('rejects unknown pack, agent, kind or risk', () => {
    expect(errs([item({ pack: 'nope' })])).toContain('pack');
    expect(errs([item({ agents: ['hermes'] })])).toContain('agents');
    expect(errs([item({ kinds: ['widget'] })])).toContain('kinds');
    expect(errs([item({ risk: 'extreme' })])).toContain('risk');
  });

  it('rejects risk high/med without risk_reason', () => {
    expect(errs([item({ risk: 'high' })])).toContain('risk_reason');
    expect(errs([item({ risk: 'med' })])).toContain('risk_reason');
    expect(errs([item({ risk: 'high', risk_reason: 'why' })])).toBe('');
  });

  it('rejects duplicate ids and conflicts pointing at unknown ids', () => {
    expect(errs([item(), item()])).toContain('duplicate');
    expect(errs([item({ conflicts: ['ghost'] })])).toContain('ghost');
    expect(errs([item({ requires: ['ghost'] })])).toContain('ghost');
  });

  it('accepts a requires entry that names a binary with a version (bin>=ver)', () => {
    expect(errs([item({ requires: ['skillspector>=2.13.3'] })])).toBe('');
    expect(errs([item({ conflicts: ['skillspector>=2.13.3'] })])).toContain('skillspector');
  });

  it('rejects link-only item whose install references a repo path', () => {
    const base = { redistribution: 'link-only' };
    expect(errs([item(base)])).toContain('link-only');
    expect(errs([item({ ...base, install: { rule: 'rule.md' } })])).toContain('link-only');
    expect(
      errs([item({ ...base, install: { files: [{ from: 'rule.md', to: '~/x.md' }] } })]),
    ).toContain('link-only');
    expect(
      errs([item({ ...base, install: { commands: ['npm i -g x'] } })]),
    ).toBe('');
  });

  it('rejects curl-script source without sha256', () => {
    const bad = item({ source: { type: 'curl-script', ref: 'https://x.test/i.sh' }, install: { commands: ['x'] } });
    expect(errs([bad])).toContain('sha256');
    const ok = item({ source: { type: 'curl-script', ref: 'https://x.test/i.sh', sha256: 'a'.repeat(64) }, install: { commands: ['x'] } });
    expect(errs([ok])).toBe('');
  });

  it('rejects any install text containing telemetry-disabling env names', () => {
    for (const k of ['DO_NOT_TRACK', 'DISABLE_TELEMETRY', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']) {
      expect(errs([item({ install: { local_skills: ['skills/demo'], settings: { env: { [k]: '1' } } } })])).toContain(k);
      expect(errs([item({ install: { commands: [`${k}=1 run`] } })])).toContain(k);
    }
  });

  it('rejects referenced repo paths that do not exist', () => {
    expect(errs([item({ install: { local_skills: ['skills/missing'] } })])).toContain('skills/missing');
    expect(errs([item({ install: { rule: 'nope.md' } })])).toContain('nope.md');
    expect(errs([item({ details: 'docs/items/other.md' })])).toContain('details');
    // details files are generated later, so a missing one is fine
    expect(errs([item({ id: 'later', details: 'docs/items/later.md' })])).toBe('');
  });

  it('rejects paths under private/ or work/', () => {
    const root = mkdtempSync(join(tmpdir(), 'mf-'));
    cpSync(FIX, root, { recursive: true });
    mkdirSync(join(root, 'private/s'), { recursive: true });
    writeFileSync(join(root, 'private/s/SKILL.md'), 'x');
    mkdirSync(join(root, 'work'), { recursive: true });
    writeFileSync(join(root, 'work/r.md'), 'x');
    const a = validateManifest(m([item({ install: { local_skills: ['private/s'] } })]), root);
    expect(a.errors.join('\n')).toContain('private/');
    const b = validateManifest(m([item({ install: { rule: 'work/r.md' } })]), root);
    expect(b.errors.join('\n')).toContain('work/');
    const c = validateManifest(m([item({ install: { rule: '../escape.md' } })]), root);
    expect(c.ok).toBe(false);
  });
});

describe('loadManifest', () => {
  it('loads the fixture manifest', () => {
    const mf = loadManifest(FIX);
    expect(mf.items[0].id).toBe('demo');
    expect(mf.packs.map((p) => p.id)).toEqual(['core', 'video']);
  });

  it('throws with all errors when invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'mf-'));
    writeFileSync(join(root, 'packs.yaml'), 'packs: []\n');
    writeFileSync(join(root, 'items.yaml'), 'items:\n  - id: a\n');
    expect(() => loadManifest(root)).toThrow(/redistribution/);
  });
});
