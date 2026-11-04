import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse, stringify } from 'yaml';

const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const MAX_DESC = 1024;

export function checkSkill(dir: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) return { ok: false, errors: ['SKILL.md not found'] };
  const m = FM.exec(readFileSync(file, 'utf8'));
  if (!m) return { ok: false, errors: ['missing YAML frontmatter'] };
  let fm: unknown;
  try {
    fm = parse(m[1]!);
  } catch (e) {
    return { ok: false, errors: [`invalid YAML frontmatter: ${(e as Error).message}`] };
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) {
    return { ok: false, errors: ['frontmatter is not a mapping'] };
  }
  const { name, description } = fm as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim()) errors.push('name is missing or empty');
  else if (name !== basename(dir)) errors.push(`name "${name}" does not match directory "${basename(dir)}"`);
  if (typeof description !== 'string' || !description.trim()) errors.push('description is missing or empty');
  else if (description.length > MAX_DESC) errors.push(`description is ${description.length} chars (max ${MAX_DESC})`);
  return { ok: errors.length === 0, errors };
}

function firstParagraph(body: string): string {
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const text = block
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.length > MAX_DESC ? text.slice(0, MAX_DESC - 3).trimEnd() + '...' : text;
  }
  return '';
}

export function fixFlatSkill(mdPath: string, outDir: string): string {
  const name = basename(mdPath, extname(mdPath));
  const raw = readFileSync(mdPath, 'utf8');
  let content = raw;
  if (!FM.test(raw)) {
    const description = firstParagraph(raw) || name;
    content = `---\n${stringify({ name, description }, { lineWidth: 0 })}---\n${raw}`;
  }
  const dir = join(outDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content);
  return dir;
}
