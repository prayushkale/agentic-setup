import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkSkill, fixFlatSkill } from '../src/skills/format.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'skillfmt-'));
const mk = (name: string, content: string) => {
  const dir = join(tmp(), name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'SKILL.md'), content);
  return dir;
};

describe('checkSkill', () => {
  it('accepts valid skill', () => {
    const dir = mk('foo', '---\nname: foo\ndescription: Does foo.\n---\nBody\n');
    expect(checkSkill(dir)).toEqual({ ok: true, errors: [] });
  });

  it('rejects missing frontmatter', () => {
    const r = checkSkill(mk('foo', '# Just a body\n'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/frontmatter/);
  });

  it('rejects missing SKILL.md', () => {
    const dir = join(tmp(), 'foo');
    mkdirSync(dir);
    expect(checkSkill(dir).ok).toBe(false);
  });

  it('rejects name mismatch', () => {
    const r = checkSkill(mk('foo', '---\nname: bar\ndescription: x\n---\n'));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/name/);
  });

  it('rejects empty description and over-long description', () => {
    const a = checkSkill(mk('foo', '---\nname: foo\ndescription: ""\n---\n'));
    expect(a.ok).toBe(false);
    expect(a.errors.join(' ')).toMatch(/description/);
    const b = checkSkill(mk('foo', `---\nname: foo\ndescription: ${'x'.repeat(1025)}\n---\n`));
    expect(b.ok).toBe(false);
  });
});

describe('fixFlatSkill', () => {
  it('creates name/SKILL.md with derived frontmatter and checkSkill passes on it', () => {
    const src = join(tmp(), 'foo.md');
    writeFileSync(src, '# Foo\n\nFirst paragraph: with colon\nsecond line.\n\nSecond paragraph.\n');
    const out = tmp();
    const dir = fixFlatSkill(src, out);
    expect(dir).toBe(join(out, 'foo'));
    expect(existsSync(join(dir, 'SKILL.md'))).toBe(true);
    expect(checkSkill(dir)).toEqual({ ok: true, errors: [] });
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toContain('Second paragraph.');
  });

  it('keeps existing frontmatter', () => {
    const src = join(tmp(), 'bar.md');
    writeFileSync(src, '---\nname: bar\ndescription: Mine.\n---\nBody\n');
    const dir = fixFlatSkill(src, tmp());
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('---\nname: bar\ndescription: Mine.\n---\nBody\n');
    expect(checkSkill(dir).ok).toBe(true);
  });
});

describe('repo packs', () => {
  it('every packs/**/SKILL.md in the repo passes checkSkill', () => {
    const packs = resolve(import.meta.dirname, '../../packs');
    const found: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e === 'SKILL.md') found.push(d);
      }
    };
    walk(packs);
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) expect({ d, ...checkSkill(d) }).toEqual({ d, ok: true, errors: [] });
  });
});
