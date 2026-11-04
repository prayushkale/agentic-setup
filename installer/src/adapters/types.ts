import type { Action } from '../actions.js';
import type { Env } from '../detect.js';
import type { AgentId, InstallSpec, Item } from '../manifest/types.js';

/** Adapters are pure: (item, env) in, Action[] out. The engine executes the actions through Ctx. */
export interface Adapter {
  id: AgentId;
  supports(field: keyof InstallSpec): boolean;
  instructionsFile(env: Env): string;
  /** Optional: human-readable notes for parts of `item` already set up outside our blocks (no action is emitted for them). */
  alreadyInstalled?(item: Item, env: Env): string[];
  actions(item: Item, env: Env, repoRoot: string): Action[];
}
