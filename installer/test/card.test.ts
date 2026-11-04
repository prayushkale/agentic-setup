import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adapters } from '../src/adapters/index.js';
import { loadManifest } from '../src/manifest/load.js';
import { renderCard, wrap } from '../src/ui/card.js';

const ROOT = resolve(import.meta.dirname, 'fixtures/cli-root');
const m = loadManifest(resolve(ROOT, 'manifest'), ROOT);
const item = (id: string) => m.items.find((i) => i.id === id)!;

describe('renderCard', () => {
  it('renderCard shows token cost, risk_reason for med, and not-available line', () => {
    const card = renderCard(item('accept-gate'), ['claude-code', 'gemini-cli', 'codex'], adapters);
    expect(card).toContain('Accept gate');
    expect(card).toContain('blocks "done"');
    expect(card).toContain('quality');
    expect(card).toContain('≈ +80 tokens at startup');
    expect(card).toMatch(/risk: med/i);
    expect(card.replace(/\s+/g, ' ')).toContain('unless an OS sandbox denies it');
    expect(card).toMatch(/hooks: not available for gemini-cli/);
    expect(card).toMatch(/not available for codex/);
  });

  it('low risk shows no reason; needs_key, manual and curl-script URL + sha256 are shown', () => {
    expect(renderCard(item('agents-md'), ['generic'], adapters)).toMatch(/risk: low\s*$/im);
    const card = renderCard(item('risky-tool'), ['claude-code'], adapters);
    expect(card).toContain('RISKY_API_KEY');
    expect(card).toContain('Sign up at example.com');
    expect(card).toContain('https://example.com/install.sh');
    expect(card).toContain('0000000000000000000000000000000000000000000000000000000000000abc');
    expect(card).toMatch(/risk: high/i);
  });

  it('every card line fits in 76 columns (80 with the note box)', () => {
    for (const i of m.items) {
      for (const line of renderCard(i, ['claude-code', 'gemini-cli', 'codex', 'generic'], adapters).split('\n')) {
        expect([...line].length, line).toBeLessThanOrEqual(76);
      }
    }
  });

  it('wrap keeps leading spaces and indents continuation lines', () => {
    expect(wrap('    claude-code: one two three', 20, 6)).toEqual(['    claude-code: one', '      two three']);
    expect(wrap('x'.repeat(25), 10, 2).every((l) => l.length <= 10)).toBe(true);
  });
});
