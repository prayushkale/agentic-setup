import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Action } from '../actions.js';
import type { Env } from '../detect.js';
import type { Adapter } from './types.js';
import type { InstallSpec, McpSpec } from '../manifest/types.js';
import { fileCopies, localSkillCopies, q, ruleBlock } from './shared.js';

const SUPPORTED: (keyof InstallSpec)[] = [
  'skills', 'local_skills', 'rule', 'hooks', 'mcp', 'settings', 'plugin', 'files',
];

function mcpAdd(m: McpSpec): string {
  if (m.transport === 'http') {
    return `claude mcp add --scope user --transport http ${q(m.name)} ${q(m.url ?? '')}`;
  }
  const args = (m.args ?? []).map(q).join(' ');
  return `claude mcp add --scope user ${q(m.name)} -- ${q(m.command ?? '')}${args ? ' ' + args : ''}`;
}

/** Marketplace name of a `plugin@marketplace` id, or undefined when there is no `@`. */
export function pluginMarketplace(name: string): string | undefined {
  const at = name.lastIndexOf('@');
  return at > 0 && at < name.length - 1 ? name.slice(at + 1) : undefined;
}

/**
 * Reads (never writes) HOME: ~/.agents/AGENTS.md when ~/.claude/CLAUDE.md imports it on a line of
 * its own (`@~/.agents/AGENTS.md` or `@<home>/.agents/AGENTS.md`), so the rules land once (R28).
 */
export function claudeRulesFile(env: Env): string {
  const own = join(env.home, '.claude', 'CLAUDE.md');
  const shared = join(env.home, '.agents', 'AGENTS.md');
  let text: string;
  try { text = readFileSync(own, 'utf8'); } catch { return own; }
  const imports = new Set(['@~/.agents/AGENTS.md', `@${shared}`]);
  return text.split(/\r?\n/).some((l) => imports.has(l.trim())) ? shared : own;
}

export const claudeCode: Adapter = {
  id: 'claude-code',
  supports: (f) => SUPPORTED.includes(f),
  instructionsFile: (env) => claudeRulesFile(env),
  actions(item, env, repoRoot) {
    const i = item.install;
    const settings = join(env.home, '.claude', 'settings.json');
    const acts: Action[] = [];
    const hook = i.hooks?.['claude-code'];
    if (hook) {
      const entry: Record<string, unknown> = { hooks: [{ type: 'command', command: hook.command }] };
      const e = hook.matcher !== undefined ? { matcher: hook.matcher, ...entry } : entry;
      acts.push({ kind: 'json-merge', file: settings, patch: { hooks: { [hook.event]: [e] } } });
    }
    if (i.settings) acts.push({ kind: 'json-merge', file: settings, patch: i.settings });
    if (i.mcp) {
      acts.push({ kind: 'run', cmd: mcpAdd(i.mcp), undo: `claude mcp remove ${q(i.mcp.name)} -s user` });
    }
    if (i.plugin) {
      // No undo for the marketplace add here: buildPlan adds `marketplace remove` only when a
      // probe shows the marketplace was not configured before (R18). Both track their settings keys.
      const mk = pluginMarketplace(i.plugin.name);
      acts.push({
        kind: 'run', cmd: `claude plugin marketplace add ${q(i.plugin.marketplace)}`,
        ...(mk ? { jsonTrack: { file: settings, paths: [['extraKnownMarketplaces', mk]] } } : {}),
      });
      acts.push({
        kind: 'run', cmd: `claude plugin install ${q(i.plugin.name)}`,
        undo: `claude plugin uninstall ${q(i.plugin.name)}`,
        jsonTrack: { file: settings, paths: [['enabledPlugins', i.plugin.name]] },
      });
    }
    acts.push(...ruleBlock(item, this.instructionsFile(env), repoRoot));
    acts.push(...localSkillCopies(item, repoRoot, join(env.home, '.claude', 'skills')));
    acts.push(...fileCopies(item, env, repoRoot));
    return acts;
  },
};
