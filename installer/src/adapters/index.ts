import { join } from 'node:path';
import type { Action } from '../actions.js';
import type { Env } from '../detect.js';
import type { AgentId, Item } from '../manifest/types.js';
import type { Adapter } from './types.js';
import { q } from './shared.js';
import { claudeCode } from './claude-code.js';
import { generic } from './generic.js';
import { commandCode } from './command-code.js';
import { codex } from './codex.js';
import { geminiCli } from './gemini-cli.js';

export type { Adapter } from './types.js';

export const adapters: Record<AgentId, Adapter> = {
  'claude-code': claudeCode,
  'command-code': commandCode,
  codex,
  'gemini-cli': geminiCli,
  generic,
};

/** `skills` CLI agent id and the dir (under HOME) its global skills land in. `generic` has none:
 *  the canonical ~/.agents/skills copy is always written (codex reads it directly too). */
const SKILLS_AGENTS: Partial<Record<AgentId, { flag: string; dir: string }>> = {
  'claude-code': { flag: 'claude-code', dir: '.claude/skills' },
  codex: { flag: 'codex', dir: '.agents/skills' },
  'gemini-cli': { flag: 'gemini-cli', dir: '.gemini/skills' },
  'command-code': { flag: 'command-code', dir: '.commandcode/skills' },
};

/** Ruling R8: scoped to each skills command only; never in the Runner env or any config. */
const NO_TELEMETRY = 'DISABLE_TELEMETRY=1 ';

/**
 * One `npx skills` install per item, called once by the engine (not per adapter). Its undo
 * removes the skills for the same `-a` agents only (R29), so another agent's copy stays.
 * `addAgents` (R23): the item is already installed and `agents` are new ones; only their dirs
 * are targeted, without the canonical copy (already present), and none when that leaves nothing.
 */
export function skillActions(item: Item, agents: AgentId[], env: Env, addAgents = false): Action[] {
  const s = item.install.skills;
  if (!s) return [];
  const canonical = SKILLS_AGENTS.codex!;
  const targets = agents.flatMap((a) => SKILLS_AGENTS[a] ?? []);
  const names = s.names.map(q).join(' ');
  // Always name the skills CLI's `codex` agent: its global dir is ~/.agents/skills. Without any -a
  // the CLI links every agent it detects, and with one non-universal -a (claude-code) it copies
  // into that agent's dir only and never writes ~/.agents/skills (found by the Task 11 e2e).
  const flagList = addAgents
    ? [...new Set(targets.map((t) => t.flag))].filter((f) => f !== canonical.flag)
    : [...new Set([...targets.map((t) => t.flag), canonical.flag])];
  if (!flagList.length) return [];
  const dirs = addAgents
    ? [...new Set(targets.filter((t) => flagList.includes(t.flag)).map((t) => t.dir))]
    : [...new Set(['.agents/skills', ...targets.map((t) => t.dir)])];
  // The skills CLI's -a takes every following non-flag word, so names go before the -a flags.
  const flags = flagList.map((f) => ` -a ${f}`).join('');
  const snapshot = dirs.flatMap((d) => s.names.map((n) => join(env.home, d, n)));
  return [{
    kind: 'run',
    cmd: `${NO_TELEMETRY}npx -y skills add ${q(s.repo)} -g -y -s ${names}${flags}`,
    undo: `${NO_TELEMETRY}npx -y skills remove -g -y ${names}${flags}`,
    snapshot,
  }];
}
