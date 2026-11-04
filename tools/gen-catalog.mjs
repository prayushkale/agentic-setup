#!/usr/bin/env node
// catalog/catalog.yaml -> catalog/CATALOG.md (tables by theme with a "selected" column).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'catalog/catalog.yaml'), 'utf8');
const { items } = parse(src);
const themeLine = src.split('\n').find((l) => l.startsWith('# themes: ')) ?? '';
const themes = Object.fromEntries(
  themeLine.replace('# themes: ', '').split('; ').map((p) => p.split('=')),
);

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const tierOf = (i) => i.tier ?? `${i.tier_guess}?`;
const order = { A: 0, B: 1, C: 2 };

const counts = { A: 0, B: 0, C: 0 };
for (const i of items) counts[(i.tier ?? i.tier_guess)[0]]++;

const out = [
  '# agentic-setup catalog',
  '',
  `Generated from \`catalog/catalog.yaml\` by \`tools/gen-catalog.mjs\`. ${items.length} items. ` +
    `Tiers: A ${counts.A} (deep-research), B ${counts.B} (card-only), C ${counts.C} (skip). ` +
    'A `?` marks a survey guess not yet confirmed by a card.',
  '',
  'To choose items for deep research, set `selected: true` in `catalog.yaml` or list the IDs.',
  '',
];
for (const [t, name] of Object.entries(themes)) {
  const rows = items
    .filter((i) => i.theme_guess === t)
    .sort((a, b) => order[tierOf(a)[0]] - order[tierOf(b)[0]] || a.id.localeCompare(b.id));
  if (!rows.length) continue;
  out.push(`## ${t} · ${name}`, '', '| ✓ | ID | Item | Tier | Risk | Summary | Overlap | Redistribution |', '|---|---|---|---|---|---|---|---|');
  for (const i of rows) {
    const link = i.card ? `[${cell(i.slug)}](${i.card.replace(/^catalog\//, '')})` : cell(i.slug);
    const note = i.dup_of ? ` (dup of ${i.dup_of})` : i.variant_of ? ` (variant of ${i.variant_of})` : '';
    out.push(
      `| ${i.selected ? '✅' : ''} | ${i.id} | ${link}${note} | ${tierOf(i)} | ${cell(i.risk)} | ${cell(i.summary)} | ${cell(i.overlap)} | ${cell(i.redistribution)} |`,
    );
  }
  out.push('');
}
writeFileSync(join(root, 'catalog/CATALOG.md'), out.join('\n'));
console.log(`wrote catalog/CATALOG.md (${items.length} items)`);
