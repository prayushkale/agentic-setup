import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from '../fs/ctx.js';

/**
 * Listing of everything under each path, keyed by absolute path: a file maps to its sha256,
 * a dir to `dir`, a symlink to `link:<target>` (links are not followed). A missing path adds
 * nothing. Used for the before/after snapshots of `run` actions: two equal snapshots mean the
 * tool left those paths exactly as they were.
 */
export function snapshotPaths(paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (p: string): void => {
    let st;
    try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) out[p] = `link:${readlinkSync(p)}`;
    else if (st.isFile()) out[p] = sha256(readFileSync(p));
    else if (st.isDirectory()) {
      out[p] = 'dir';
      for (const e of readdirSync(p).sort()) walk(join(p, e));
    }
  };
  for (const p of paths) walk(resolve(p));
  return out;
}

export const sameSnapshot = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
};
