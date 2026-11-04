import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adapters } from '../../src/adapters/index.js';
import type { Item } from '../../src/manifest/types.js';

const home = mkdtempSync(join(tmpdir(), 'as-g-home-'));
const repo = mkdtempSync(join(tmpdir(), 'as-g-repo-'));
const env = { home, path: '', platform: 'darwin' as const };
const g = adapters.generic!;
const mk = (install: Item['install']): Item => ({
  id: 'g1', name: 'g', pack: 'core', summary: '', benefit: ['quality'], details: '', kinds: ['rule'],
  agents: ['generic'], source: { type: 'local', ref: '' }, redistribution: 'own', risk: 'low',
  token_cost: 0, install, verify: 'true',
});

describe('generic adapter', () => {
  it('generic does not support hooks/mcp', () => {
    expect(g.supports('hooks')).toBe(false);
    expect(g.supports('mcp')).toBe(false);
    expect(g.supports('plugin')).toBe(false);
    expect(g.supports('rule')).toBe(true);
    expect(g.instructionsFile(env)).toBe(join(home, '.agents', 'AGENTS.md'));
  });

  it('generic maps rule, local_skills and files', () => {
    writeFileSync(join(repo, 'r.md'), 'hello\n');
    mkdirSync(join(repo, 'sk', 'one'), { recursive: true });
    writeFileSync(join(repo, 'sk', 'one', 'SKILL.md'), 's');
    const a = g.actions(mk({ rule: 'r.md', local_skills: ['sk/one'], files: [{ from: 'f', to: '~/.x/f', mode: 0o700 }] }), env, repo);
    expect(a).toEqual([
      { kind: 'block', file: join(home, '.agents/AGENTS.md'), id: 'g1', body: 'hello', style: 'md' },
      { kind: 'copy', from: join(repo, 'sk/one/SKILL.md'), to: join(home, '.agents/skills/one/SKILL.md') },
      { kind: 'copy', from: join(repo, 'f'), to: join(home, '.x/f'), mode: 0o700 },
    ]);
  });
});
