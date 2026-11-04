import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { AGENT_IDS, type AgentId, type Manifest } from './manifest/types.js';

/** A saved selection: which agents, which item ids. */
export interface Profile { agents: AgentId[]; items: string[] }

export const profilePath = (home: string) => join(home, '.agentic-setup', 'profile.yaml');

/** Writes `~/.agentic-setup/profile.yaml`. The caller skips this in dry-run. */
export function saveProfile(home: string, p: Profile): void {
  mkdirSync(join(home, '.agentic-setup'), { recursive: true });
  writeFileSync(profilePath(home), stringify({ agents: p.agents, items: p.items }));
}

/** Reads a profile file and checks every agent and item id against the manifest. */
export function loadProfile(path: string, m: Manifest): Profile {
  let doc: unknown;
  try {
    doc = parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read profile ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const d = (doc ?? {}) as Record<string, unknown>;
  const strs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (!strs(d.agents)) throw new Error(`profile ${path}: agents must be a list of agent ids`);
  if (!strs(d.items)) throw new Error(`profile ${path}: items must be a list of item ids`);
  const ids = new Set(m.items.map((i) => i.id));
  for (const a of d.agents as string[]) {
    if (!(AGENT_IDS as readonly string[]).includes(a)) throw new Error(`profile ${path}: unknown agent "${a}"`);
  }
  for (const i of d.items as string[]) {
    if (!ids.has(i)) throw new Error(`profile ${path}: unknown item "${i}"`);
  }
  return { agents: d.agents as AgentId[], items: d.items as string[] };
}
