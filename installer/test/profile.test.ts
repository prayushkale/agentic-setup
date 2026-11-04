import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../src/manifest/load.js';
import { loadProfile, profilePath, saveProfile } from '../src/profile.js';

const ROOT = resolve(import.meta.dirname, 'fixtures/cli-root');
const m = loadManifest(resolve(ROOT, 'manifest'), ROOT);

describe('profile', () => {
  it('profile round-trip and rejects unknown ids', () => {
    const home = mkdtempSync(join(tmpdir(), 'as-prof-'));
    const p = { agents: ['claude-code', 'generic'] as const, items: ['agents-md', 'demo-skill'] };
    saveProfile(home, { agents: [...p.agents], items: p.items });
    expect(profilePath(home)).toBe(join(home, '.agentic-setup', 'profile.yaml'));
    expect(loadProfile(profilePath(home), m)).toEqual({ agents: ['claude-code', 'generic'], items: ['agents-md', 'demo-skill'] });

    const bad = join(home, 'bad.yaml');
    writeFileSync(bad, 'agents: [claude-code]\nitems: [agents-md, nope]\n');
    expect(() => loadProfile(bad, m)).toThrow(/unknown item "nope"/);
    writeFileSync(bad, 'agents: [hermes]\nitems: [agents-md]\n');
    expect(() => loadProfile(bad, m)).toThrow(/unknown agent "hermes"/);
    writeFileSync(bad, 'items: agents-md\n');
    expect(() => loadProfile(bad, m)).toThrow(/agents/);
  });
});
