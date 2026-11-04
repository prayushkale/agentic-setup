import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Action } from '../actions.js';
import type { AgentId } from '../manifest/types.js';
import type { JsonMergeUndo, JsonTrackBefore } from '../fs/json-merge.js';
import type { BlockUndo } from '../fs/blocks.js';

/**
 * Undo data for a `copy` action.
 * - `originalHash`: sha256 of the target before the copy, null if it did not exist.
 * - `afterHash`: sha256 of the copied bytes (uninstall deletes only if still equal).
 * - `backupPath`: this run's backup of a replaced target, null if none.
 * - `createdDirs`: parent dirs the copy created, outermost first.
 */
export interface CopyUndo {
  originalHash: string | null;
  afterHash: string | null;
  backupPath: string | null;
  createdDirs: string[];
}

/**
 * Undo data for a `run` action: relative path → sha256 of every file under the action's
 * `snapshot` paths, taken before and after the command ran.
 */
export interface RunUndo {
  snapshotBefore: Record<string, string>;
  snapshotAfter: Record<string, string>;
  /** Set while the command runs (recorded before executing), so a crash still leaves a trace. */
  pending?: boolean;
  /** With `jsonTrack`: which tracked key paths (and their parents) existed before the command. */
  jsonBefore?: JsonTrackBefore;
}

/**
 * An `Action` as applied, plus what uninstall needs to reverse it:
 * - json-merge: `JsonMergeUndo` (added JsonPaths, original/after hash, backup or original
 *   text for a byte-exact restore, created dirs)
 * - block: `BlockUndo` (separator, replaced block, original/after hash, created dirs)
 * - copy: `CopyUndo` (original/after hash, backup, created dirs)
 * - run: `RunUndo` (snapshot before/after)
 */
export type AppliedAction =
  | (Extract<Action, { kind: 'json-merge' }> & { undoData: JsonMergeUndo })
  | (Extract<Action, { kind: 'block' }> & { undoData: BlockUndo })
  | (Extract<Action, { kind: 'copy' }> & { undoData: CopyUndo })
  | (Extract<Action, { kind: 'run' }> & { undoData: RunUndo });

export interface InstalledItem {
  id: string;
  agents: AgentId[];
  /** ISO timestamp. */
  installedAt: string;
  /** In the order applied; uninstall reverses them in reverse order. */
  actions: AppliedAction[];
  /**
   * True only once every action of the install succeeded (R23). A record without the field
   * (written before it existed) counts as complete unless a `run` action is still pending.
   */
  complete?: boolean;
}

/** Whether `rec` is a fully applied install (see `InstalledItem.complete`). */
export const isComplete = (rec: InstalledItem): boolean =>
  rec.complete ?? !rec.actions.some((a) => a.kind === 'run' && a.undoData.pending);

export interface State {
  version: 1;
  items: Record<string, InstalledItem>;
}

export const statePath = (home: string) => join(home, '.agentic-setup', 'state.json');

export function loadState(home: string): State {
  const p = statePath(home);
  if (!existsSync(p)) return { version: 1, items: {} };
  let s: unknown;
  try {
    s = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`${p} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const st = s as Partial<State> | null;
  if (!st || st.version !== 1 || typeof st.items !== 'object' || st.items === null) {
    throw new Error(`${p} has an unknown format (expected version 1)`);
  }
  return st as State;
}

/** Writes state.json atomically (temp file + rename). No-op in dry-run. */
export function saveState(home: string, s: State, dryRun: boolean): void {
  if (dryRun) return;
  const p = statePath(home);
  mkdirSync(join(home, '.agentic-setup'), { recursive: true });
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
  renameSync(tmp, p);
}
