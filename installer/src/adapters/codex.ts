/**
 * OpenAI Codex CLI adapter.
 * Sources (confirmed via Context7 /openai/codex):
 * - MCP: https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs
 *   `[mcp_servers.<name>]` with `command`/`args` (stdio) or `url` (streamable HTTP).
 * - Hooks: https://github.com/openai/codex/blob/main/codex-rs/config/src/hooks_tests.rs and
 *   .../hooks/src/engine/discovery.rs : ~/.codex/hooks.json = { hooks: { <Event>: [ { matcher?, hooks: [ {type:'command', command} ] } ] } }.
 * - Global instructions: $CODEX_HOME/AGENTS.md (~/.codex/AGENTS.md), AGENTS.override.md wins; confirmed in
 *   https://github.com/openai/codex/blob/main/codex-rs/codex-home/src/instructions/mod.rs
 * - Hooks need no feature flag: `hooks` is Stable and default_enabled (codex-rs/features/src/lib.rs); docs at
 *   https://learn.chatgpt.com/docs/hooks say "Hooks are enabled by default" (`[features] hooks = false` turns off).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Action } from '../actions.js';
import type { Env } from '../detect.js';
import type { Adapter } from './types.js';
import type { InstallSpec, Item, McpSpec } from '../manifest/types.js';
import { removeBlock } from '../fs/blocks.js';
import { fileCopies, localSkillCopies, ruleBlock } from './shared.js';

const SUPPORTED: (keyof InstallSpec)[] = ['skills', 'local_skills', 'rule', 'hooks', 'mcp', 'files'];

const tomlStr = (s: string): string => JSON.stringify(s);
const tomlKey = (s: string): string => (/^[A-Za-z0-9_-]+$/.test(s) ? s : tomlStr(s));

function mcpToml(m: McpSpec): string {
  const lines = [`[mcp_servers.${tomlKey(m.name)}]`];
  if (m.transport === 'http') lines.push(`url = ${tomlStr(m.url ?? '')}`);
  else {
    lines.push(`command = ${tomlStr(m.command ?? '')}`);
    if (m.args?.length) lines.push(`args = [${m.args.map(tomlStr).join(', ')}]`);
  }
  return lines.join('\n');
}

const configFile = (env: Env): string => join(env.home, '.codex', 'config.toml');

/** True when config.toml defines `[mcp_servers.<name>]` (or a subtable) outside our own block. */
function definedOutsideBlock(item: Item, env: Env): boolean {
  const m = item.install.mcp;
  if (!m) return false;
  let text: string;
  try { text = readFileSync(configFile(env), 'utf8'); } catch { return false; }
  const rest = removeBlock(text, item.id, 'toml');
  const name = m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^[ \\t]*\\[\\s*mcp_servers\\s*\\.\\s*(["']?)${name}\\1\\s*(\\]|\\.)`, 'm').test(rest);
}

export const codex: Adapter = {
  id: 'codex',
  supports: (f) => SUPPORTED.includes(f),
  instructionsFile: (env) => join(env.home, '.codex', 'AGENTS.md'),
  alreadyInstalled(item, env) {
    return definedOutsideBlock(item, env) ? [`mcp server "${item.install.mcp!.name}" already in ~/.codex/config.toml`] : [];
  },
  actions(item, env, repoRoot): Action[] {
    const i = item.install;
    const acts: Action[] = [];
    const hook = i.hooks?.codex;
    if (hook) {
      const group: Record<string, unknown> = { hooks: [{ type: 'command', command: hook.command }] };
      const g = hook.matcher !== undefined ? { matcher: hook.matcher, ...group } : group;
      acts.push({ kind: 'json-merge', file: join(env.home, '.codex', 'hooks.json'), patch: { hooks: { [hook.event]: [g] } } });
    }
    if (i.mcp && !definedOutsideBlock(item, env)) {
      acts.push({ kind: 'block', file: configFile(env), id: item.id, body: mcpToml(i.mcp), style: 'toml' });
    }
    acts.push(...ruleBlock(item, this.instructionsFile(env), repoRoot));
    acts.push(...localSkillCopies(item, repoRoot, join(env.home, '.agents', 'skills')));
    acts.push(...fileCopies(item, env, repoRoot));
    return acts;
  },
};
