/**
 * Gemini CLI adapter.
 * Sources (confirmed via Context7 /google-gemini/gemini-cli):
 * - MCP: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
 *   settings.json `mcpServers.<name>` with `httpUrl` (streamable HTTP), `url` (SSE) or `command`/`args`.
 * - Hooks: https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md
 *   settings.json `hooks.<Event>: [ { matcher, hooks: [ { name, type:'command', command } ] } ]` (BeforeTool, AfterTool, ...).
 * - Global context: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md : ~/.gemini/GEMINI.md.
 */
import { join } from 'node:path';
import type { Action } from '../actions.js';
import type { Adapter } from './types.js';
import type { InstallSpec, McpSpec } from '../manifest/types.js';
import { fileCopies, localSkillCopies, ruleBlock } from './shared.js';

const SUPPORTED: (keyof InstallSpec)[] = ['skills', 'local_skills', 'rule', 'hooks', 'mcp', 'files'];

function mcpEntry(m: McpSpec): Record<string, unknown> {
  if (m.transport === 'http') return { httpUrl: m.url ?? '' };
  const e: Record<string, unknown> = { command: m.command ?? '' };
  if (m.args?.length) e.args = m.args;
  return e;
}

export const geminiCli: Adapter = {
  id: 'gemini-cli',
  supports: (f) => SUPPORTED.includes(f),
  instructionsFile: (env) => join(env.home, '.gemini', 'GEMINI.md'),
  actions(item, env, repoRoot): Action[] {
    const i = item.install;
    const settings = join(env.home, '.gemini', 'settings.json');
    const acts: Action[] = [];
    const hook = i.hooks?.['gemini-cli'];
    if (hook) {
      const group: Record<string, unknown> = {
        hooks: [{ name: item.id, type: 'command', command: hook.command }],
      };
      const g = hook.matcher !== undefined ? { matcher: hook.matcher, ...group } : group;
      acts.push({ kind: 'json-merge', file: settings, patch: { hooks: { [hook.event]: [g] } } });
    }
    if (i.mcp) acts.push({ kind: 'json-merge', file: settings, patch: { mcpServers: { [i.mcp.name]: mcpEntry(i.mcp) } } });
    acts.push(...ruleBlock(item, this.instructionsFile(env), repoRoot));
    acts.push(...localSkillCopies(item, repoRoot, join(env.home, '.gemini', 'skills')));
    acts.push(...fileCopies(item, env, repoRoot));
    return acts;
  },
};
