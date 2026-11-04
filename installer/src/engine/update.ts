import { q } from '../adapters/shared.js';
import type { Ctx } from '../fs/ctx.js';
import type { Item, Manifest } from '../manifest/types.js';
import type { Runner } from '../run/runner.js';
import { loadState, saveState } from '../state/state.js';
import { snapshotPaths } from './snapshot.js';

/** `item.update`, or for `skills` items the skills CLI update (telemetry off per command, ruling R8). */
export function updateCommands(item: Item): string[] {
  if (item.update?.length) return item.update;
  const s = item.install.skills;
  return s ? [`DISABLE_TELEMETRY=1 npx -y skills update -g -y ${s.names.map(q).join(' ')}`] : [];
}

/**
 * Updates installed items (`ids`, default all): runs the update commands, then re-runs
 * `post_install` so local patches are back, then re-records the after-snapshots of the item's
 * `run` actions so uninstall compares against the updated files. Pinned items have no update
 * commands and only get `post_install` re-run. A failure stops that item only.
 */
export async function update(ids: string[] | undefined, ctx: Ctx, runner: Runner, m: Manifest): Promise<{
  updated: string[]; failed: { id: string; error: string }[];
}> {
  const st = loadState(ctx.home);
  const updated: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids ?? Object.keys(st.items)) {
    const rec = st.items[id];
    const item = m.items.find((i) => i.id === id);
    if (!rec || !item) {
      failed.push({ id, error: rec ? 'not in the manifest' : 'not installed by agentic-setup' });
      continue;
    }
    try {
      for (const cmd of [...updateCommands(item), ...(item.post_install ?? [])]) await runner.run(cmd);
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    for (const a of rec.actions) {
      if (a.kind === 'run' && a.snapshot?.length && !a.undoData.pending) a.undoData.snapshotAfter = snapshotPaths(a.snapshot);
    }
    saveState(ctx.home, st, ctx.dryRun);
    updated.push(id);
  }
  return { updated, failed };
}
