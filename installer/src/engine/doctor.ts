import { delimiter, join } from 'node:path';
import { hasBinary, type Env } from '../detect.js';
import type { Ctx } from '../fs/ctx.js';
import type { Manifest } from '../manifest/types.js';
import type { Runner } from '../run/runner.js';
import { loadState } from '../state/state.js';
import { requiredBinary } from './plan.js';

/** The Env the runner's commands see: HOME, and `<npmPrefix>/bin` first on PATH when set. */
export function ctxEnv(ctx: Ctx): Env {
  const path = [ctx.npmPrefix !== undefined ? join(ctx.npmPrefix, 'bin') : '', process.env.PATH ?? '']
    .filter(Boolean).join(delimiter);
  return { home: ctx.home, path, platform: process.platform };
}

/**
 * For every installed item: runs its `verify` (a readOnly probe, so also in dry-run) and checks
 * that each non-item `requires` entry (e.g. `node>=20`) names a binary on PATH. With `ids`, only
 * those installed items are checked (the post-install doctor passes the just-installed ids, R31).
 */
export async function doctor(
  ctx: Ctx, runner: Runner, m: Manifest, ids?: string[],
): Promise<{ id: string; ok: boolean; detail: string }[]> {
  const st = loadState(ctx.home);
  const env = ctxEnv(ctx);
  const itemIds = new Set(m.items.map((i) => i.id));
  const out: { id: string; ok: boolean; detail: string }[] = [];
  for (const id of Object.keys(st.items).filter((k) => !ids || ids.includes(k))) {
    const item = m.items.find((i) => i.id === id);
    if (!item) {
      out.push({ id, ok: false, detail: 'installed but no longer in the manifest' });
      continue;
    }
    const problems: string[] = [];
    const r = await runner.run(item.verify, { allowFail: true, readOnly: true });
    if (r.code !== 0) {
      const msg = (r.stderr || r.stdout).trim();
      problems.push(`verify failed (exit ${r.code}): ${item.verify}${msg ? ` — ${msg}` : ''}`);
    }
    for (const req of item.requires ?? []) {
      if (!itemIds.has(req) && !hasBinary(requiredBinary(req), env)) problems.push(`missing required binary: ${req}`);
    }
    out.push({ id, ok: problems.length === 0, detail: problems.length ? problems.join('; ') : 'ok' });
  }
  return out;
}
