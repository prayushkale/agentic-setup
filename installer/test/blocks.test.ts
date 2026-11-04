import { describe, it, expect } from 'vitest';
import { addBlock, removeBlock, blockSeparator } from '../src/fs/blocks.js';

const BEGIN = '<!-- agentic-setup:rule begin -->';
const END = '<!-- agentic-setup:rule end -->';

const roundTrip = (t: string, style: 'md' | 'toml' = 'md') => {
  const sep = blockSeparator(t, 'rule', style);
  return removeBlock(addBlock(t, 'rule', 'Be careful.\n', style), 'rule', style, sep);
};

describe('addBlock', () => {
  it('writes md markers separated by exactly one blank line', () => {
    expect(addBlock('# Notes', 'rule', 'Be careful.', 'md')).toBe(
      `# Notes\n\n${BEGIN}\nBe careful.\n${END}\n`,
    );
    expect(addBlock('# Notes\n', 'rule', 'Be careful.', 'md')).toBe(
      `# Notes\n\n${BEGIN}\nBe careful.\n${END}\n`,
    );
    expect(addBlock('', 'rule', 'Be careful.', 'md')).toBe(`${BEGIN}\nBe careful.\n${END}\n`);
  });

  it('writes toml markers', () => {
    expect(addBlock('a = 1\n', 'mcp', '[mcp_servers.x]\nurl = "u"', 'toml')).toBe(
      'a = 1\n\n# agentic-setup:mcp begin\n[mcp_servers.x]\nurl = "u"\n# agentic-setup:mcp end\n',
    );
  });

  it('addBlock twice yields one block', () => {
    const once = addBlock('# Notes\n', 'rule', 'Be careful.', 'md');
    const twice = addBlock(once, 'rule', 'Be careful.', 'md');
    expect(twice).toBe(once);
    expect(twice.split(BEGIN)).toHaveLength(2);
  });

  it('replaces the body of an existing block with the same id in place', () => {
    const t = addBlock('# Notes\n', 'rule', 'old', 'md') + 'user tail\n';
    expect(addBlock(t, 'rule', 'new', 'md')).toBe(`# Notes\n\n${BEGIN}\nnew\n${END}\nuser tail\n`);
  });

  it('throws on a begin marker without an end marker', () => {
    expect(() => addBlock(`${BEGIN}\nx\n`, 'rule', 'y', 'md')).toThrow(/end marker/);
  });
});

describe('removeBlock', () => {
  it('removeBlock(addBlock(t)) === t for an empty file', () => {
    expect(roundTrip('')).toBe('');
  });

  it('removeBlock(addBlock(t)) === t for a file with no trailing newline', () => {
    expect(roundTrip('# Notes')).toBe('# Notes');
  });

  it('removeBlock(addBlock(t)) === t for a file with an existing block of another id', () => {
    const t = addBlock('# Notes\n', 'other', 'Other rule.', 'md');
    expect(roundTrip(t)).toBe(t);
  });

  it('removeBlock(addBlock(t)) === t for other tails and toml', () => {
    for (const t of ['# Notes\n', '# Notes\n\n', '# Notes\n\n\n', '\n']) {
      expect(roundTrip(t)).toBe(t);
      expect(roundTrip(t, 'toml')).toBe(t);
    }
  });

  it('removes only its own block when the user edited around it', () => {
    const t = addBlock('# Notes\n', 'rule', 'Be careful.', 'md');
    const edited = 'top\n' + t + 'user tail\n';
    expect(removeBlock(edited, 'rule', 'md', '\n')).toBe('top\n# Notes\nuser tail\n');
  });

  it('returns the text unchanged when the block is absent', () => {
    expect(removeBlock('# Notes\n', 'rule', 'md', '\n')).toBe('# Notes\n');
  });
});
