#!/usr/bin/env node
// manifest + catalog/cards -> docs/items/<id>.md, plus the pack table inside README.md
// (between the agentic-setup:packs markers). Usage: node tools/gen-item-docs.mjs [--check]
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readManifest, sync } from './lib/common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Only sections that explain the item. Internal notes (overlap, risk, tier, source) stay out.
const CARD_SECTIONS = ['What it is.', "What's inside.", 'Core idea worth knowing.'];

/** A card matches an item when its slug (file name minus the ID prefix) equals the item id. */
function cardFor(root, id) {
  const dir = join(root, 'catalog/cards');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((n) => n.replace(/^[A-Z]\d+-/, '').replace(/\.md$/, '') === id);
  return f ? readFileSync(join(dir, f), 'utf8') : null;
}

function cardBody(text) {
  const out = [];
  for (const label of CARD_SECTIONS) {
    const m = text.match(new RegExp(`^\\*\\*${label.replace(/[.']/g, '\\$&')}\\*\\*[ \\t]*([\\s\\S]*?)(?=^\\*\\*|(?![\\s\\S]))`, 'm'));
    if (m && m[1].trim()) out.push(`**${label.replace(/\.$/, '')}**\n\n${m[1].trim()}`);
  }
  return out.join('\n\n');
}

const list = (a) => (a?.length ? a.join(', ') : 'none');

function installLines(it) {
  const s = it.install;
  const out = [];
  if (s.skills) out.push(`Skills from \`${s.skills.repo}\`: ${s.skills.names.join(', ')}.`);
  if (s.local_skills) out.push(`Bundled skills: ${s.local_skills.map((d) => `\`${d}\``).join(', ')}.`);
  if (s.rule) out.push(`A rule block appended to each agent's instructions file (\`${s.rule}\`).`);
  if (s.hooks) out.push(`Hooks: ${Object.entries(s.hooks).map(([a, h]) => `${a} ${h.event}`).join(', ')}.`);
  if (s.mcp) out.push(`MCP server \`${s.mcp.name}\` (${s.mcp.transport}).`);
  if (s.settings) out.push('Keys merged into the agent settings file.');
  if (s.plugin) out.push(`Claude Code plugin \`${s.plugin.name}\` from \`${s.plugin.marketplace}\`.`);
  if (s.commands) out.push(`Runs: ${s.commands.map((c) => `\`${c}\``).join('; ')}.`);
  if (s.files) out.push(`Copies files to ${s.files.map((f) => `\`${f.to}\``).join(', ')}.`);
  return out;
}

function itemDoc(root, it) {
  const rows = [
    ['Pack', it.pack], ['Kinds', list(it.kinds)], ['Agents', list(it.agents)], ['Benefit', list(it.benefit)],
    ['Source', `${it.source.type}: ${it.source.ref}`], ['Redistribution', it.redistribution],
    ['Risk', it.risk + (it.risk_reason ? `: ${it.risk_reason}` : '')],
    ['Startup tokens', `about ${it.token_cost}`], ['Requires', list(it.requires)], ['Conflicts', list(it.conflicts)],
  ];
  if (it.needs_key) rows.push(['Needs key', it.needs_key]);
  const parts = [
    `# ${it.name}`, '', it.summary, '',
    '| Field | Value |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '\\|')} |`), '',
    '## What the installer does', '', ...installLines(it).map((l) => `- ${l}`),
  ];
  if (it.manual) parts.push('', '## Manual step', '', it.manual.trim());
  if (it.uninstall?.length) parts.push('', '## Uninstall', '', ...it.uninstall.map((c) => `- \`${c}\``));
  const card = cardFor(root, it.id);
  const body = card && cardBody(card);
  if (body) parts.push('', '## Background', '', body);
  parts.push('', `Install it with \`npx agentic-setup install ${it.id}\`.`);
  return parts.join('\n') + '\n';
}

export function packTable(m) {
  const lines = ['| Pack | Default | Items | What it is |', '| --- | --- | --- | --- |'];
  for (const p of m.packs) {
    const n = m.items.filter((i) => i.pack === p.id).length;
    lines.push(`| \`${p.id}\` | ${p.default ? 'yes' : 'no'} | ${n} | ${p.summary} |`);
  }
  return lines.join('\n');
}

export function generate(root = ROOT) {
  const m = readManifest(root);
  const files = new Map();
  for (const it of m.items) files.set(`docs/items/${it.id}.md`, itemDoc(root, it));
  const readme = join(root, 'README.md');
  if (existsSync(readme)) {
    const re = /(<!-- agentic-setup:packs begin -->\n)[\s\S]*?(<!-- agentic-setup:packs end -->)/;
    const cur = readFileSync(readme, 'utf8');
    if (re.test(cur)) files.set('README.md', cur.replace(re, (_, a, b) => `${a}${packTable(m)}\n${b}`));
  }
  return files;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const check = process.argv.includes('--check');
  const root = process.env.AGENTIC_SETUP_ROOT || ROOT;
  const stale = sync(root, generate(root), { check, owned: ['docs/items'] });
  if (check && stale.length) {
    console.error(`gen-item-docs: stale (run node tools/gen-item-docs.mjs):\n- ${stale.join('\n- ')}`);
    process.exit(1);
  }
  console.log(check ? 'gen-item-docs: up to date' : `gen-item-docs: wrote ${stale.length} changed file(s)`);
}
