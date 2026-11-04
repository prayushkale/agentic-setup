#!/usr/bin/env node
// manifest + packs/ -> .claude-plugin/marketplace.json and plugins/<pack>/ (Claude Code plugins).
// One plugin per pack that bundles own skills/hooks (or a pack made only of own rules).
// A plugin cannot add text to CLAUDE.md, so each own rule ships as a skill that loads on demand.
// Link-only and upstream items never go in. Usage: node tools/gen-marketplace.mjs [--check]
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readManifest, sync, walk } from './lib/common.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'prayushkale';
const REPO = 'agentic-setup';

const json = (v) => JSON.stringify(v, null, 2) + '\n';
const skip = (f) => /\.test\.[^/]+$/.test(f);

function pluginFiles(root, pack, items) {
  const own = items.filter((i) => i.pack === pack.id && i.redistribution === 'own' && i.agents.includes('claude-code'));
  const allOwn = items.filter((i) => i.pack === pack.id).every((i) => i.redistribution === 'own');
  const files = new Map();
  const base = `plugins/${pack.id}`;
  const hooks = {};
  let parts = 0;

  for (const it of own) {
    const { install: ins } = it;
    for (const dir of ins.local_skills ?? []) {
      for (const f of walk(join(root, dir)).filter((f) => !skip(f))) {
        files.set(`${base}/skills/${basename(dir)}/${f}`, readFileSync(join(root, dir, f)));
      }
      parts++;
    }
    if (ins.rule && (allOwn || own.some((o) => o.install.local_skills || o.install.hooks))) {
      const desc = `${it.summary} Loads when relevant; for an always-on rule use npx agentic-setup.`.replace(/\s+/g, ' ');
      const body = readFileSync(join(root, ins.rule), 'utf8');
      files.set(`${base}/skills/${it.id}/SKILL.md`,
        `---\nname: ${it.id}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body}`);
      parts++;
    }
    if (ins.hooks?.['claude-code'] || ins.settings?.hooks) {
      const toPlugin = new Map();
      for (const f of ins.files ?? []) {
        const dest = `${base}/hooks/${it.id}/${basename(f.from)}`;
        files.set(dest, readFileSync(join(root, f.from)));
        toPlugin.set(f.to, `\${CLAUDE_PLUGIN_ROOT}/hooks/${it.id}/${basename(f.from)}`);
      }
      const fix = (cmd) => {
        for (const [to, p] of toPlugin) cmd = cmd.replaceAll(`$HOME/${to.slice(2)}`, p).replaceAll(to, p);
        return cmd;
      };
      const add = (event, matcher, cmd) =>
        (hooks[event] ??= []).push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: fix(cmd) }] });
      const h = ins.hooks?.['claude-code'];
      if (h) add(h.event, h.matcher, h.command);
      for (const [event, entries] of Object.entries(ins.settings?.hooks ?? {})) {
        for (const e of entries) for (const c of e.hooks) add(event, e.matcher, c.command);
      }
      parts++;
    }
  }
  if (!parts) return null;
  if (Object.keys(hooks).length) files.set(`${base}/hooks/hooks.json`, json({ hooks }));
  files.set(`${base}/.claude-plugin/plugin.json`, json({
    name: pack.id,
    version: JSON.parse(readFileSync(join(root, 'installer/package.json'), 'utf8')).version,
    description: pack.summary,
    author: { name: OWNER },
    homepage: `https://github.com/${OWNER}/${REPO}`,
    repository: `https://github.com/${OWNER}/${REPO}`,
    license: 'MIT',
  }));
  return files;
}

export function generate(root = ROOT) {
  const { packs, items } = readManifest(root);
  const files = new Map();
  const plugins = [];
  for (const pack of packs) {
    const pf = pluginFiles(root, pack, items);
    if (!pf) continue;
    for (const [k, v] of pf) files.set(k, v);
    plugins.push({ name: pack.id, source: `./plugins/${pack.id}`, description: pack.summary });
  }
  files.set('.claude-plugin/marketplace.json', json({
    name: REPO,
    owner: { name: OWNER },
    metadata: { description: 'Own skills, hooks and rules from the agentic-setup packs. Upstream items install through npx agentic-setup.' },
    plugins,
  }));
  return files;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const check = process.argv.includes('--check');
  const root = process.env.AGENTIC_SETUP_ROOT || ROOT;
  const stale = sync(root, generate(root), { check, owned: ['plugins'] });
  if (check && stale.length) {
    console.error(`gen-marketplace: stale (run node tools/gen-marketplace.mjs):\n- ${stale.join('\n- ')}`);
    process.exit(1);
  }
  console.log(check ? 'gen-marketplace: up to date' : `gen-marketplace: wrote ${stale.length} changed file(s)`);
}
