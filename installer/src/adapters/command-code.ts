/**
 * Command Code adapter.
 * Sources: https://commandcode.ai/docs/mcp (MCP, `cmd mcp add`, scopes) and
 * https://commandcode.ai/docs/memory (~/.commandcode/AGENTS.md); plus `cmd mcp add --help`,
 * `cmd mcp remove --help`, `cmd mcp add-json --help` (cmd 1.88) and the user's serena-here script.
 * "Mods" (~/.commandcode/mods/*.ts) have no public docs page found: that claim rests on the user's own
 * knowledge/setup only, so hooks stay unsupported in v1. On this setup ~/.commandcode/AGENTS.md is a
 * symlink to ~/.agents/AGENTS.md.
 */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Action } from '../actions.js';
import type { Env } from '../detect.js';
import type { Adapter } from './types.js';
import type { InstallSpec, McpSpec } from '../manifest/types.js';
import { fileCopies, localSkillCopies, q, ruleBlock } from './shared.js';

const SUPPORTED: (keyof InstallSpec)[] = ['skills', 'local_skills', 'rule', 'mcp', 'files'];

function mcpAdd(m: McpSpec): string {
  if (m.transport === 'http') {
    return `cmd mcp add --transport http --scope user ${q(m.name)} ${q(m.url ?? '')}`;
  }
  const json = JSON.stringify({ type: 'stdio', command: m.command ?? '', args: m.args ?? [] });
  return `cmd mcp add-json ${q(m.name)} -s user ${q(json)}`;
}

/** Reads (never writes) HOME: ~/.agents/AGENTS.md when ~/.commandcode/AGENTS.md links to it or is absent. */
export function commandCodeRulesFile(env: Env): string {
  const own = join(env.home, '.commandcode', 'AGENTS.md');
  const shared = join(env.home, '.agents', 'AGENTS.md');
  let isLink = false;
  try { isLink = lstatSync(own).isSymbolicLink(); } catch { /* absent */ }
  if (isLink) {
    try { if (realpathSync(own) === realpathSync(shared)) return shared; } catch { /* dangling or shared missing */ }
    return own;
  }
  if (!existsSync(own) && existsSync(shared)) return shared;
  return own;
}

export const commandCode: Adapter = {
  id: 'command-code',
  supports: (f) => SUPPORTED.includes(f),
  instructionsFile: (env) => commandCodeRulesFile(env),
  actions(item, env, repoRoot): Action[] {
    const i = item.install;
    const acts: Action[] = [];
    if (i.mcp) {
      acts.push({ kind: 'run', cmd: mcpAdd(i.mcp), undo: `cmd mcp remove ${q(i.mcp.name)} -s user` });
    }
    acts.push(...ruleBlock(item, this.instructionsFile(env), repoRoot));
    acts.push(...localSkillCopies(item, repoRoot, join(env.home, '.commandcode', 'skills')));
    acts.push(...fileCopies(item, env, repoRoot));
    return acts;
  },
};
