import { accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId } from './manifest/types.js';

export type Env = { home: string; path: string; platform: NodeJS.Platform };

/** True when an executable file called `name` sits in a directory of env.path. No shelling out. */
export function hasBinary(name: string, env: Env): boolean {
  for (const dir of env.path.split(':')) {
    if (!dir) continue;
    const p = join(dir, name);
    try {
      if (!statSync(p).isFile()) continue;
      accessSync(p, constants.X_OK);
      return true;
    } catch { /* not here */ }
  }
  return false;
}

const isDir = (p: string): boolean => {
  try { return statSync(p).isDirectory(); } catch { return false; }
};

const PROBES: { id: AgentId; bin: string; dir: string }[] = [
  { id: 'claude-code', bin: 'claude', dir: '.claude' },
  { id: 'command-code', bin: 'cmd', dir: '.commandcode' },
  { id: 'codex', bin: 'codex', dir: '.codex' },
  { id: 'gemini-cli', bin: 'gemini', dir: '.gemini' },
];

/** Agents found by binary or config dir. `generic` is always included. */
export async function detectAgents(env: Env): Promise<AgentId[]> {
  const found = PROBES
    .filter((p) => hasBinary(p.bin, env) || isDir(join(env.home, p.dir)))
    .map((p) => p.id);
  return [...found, 'generic'];
}
