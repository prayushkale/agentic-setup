import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Action } from '../actions.js';
import type { Env } from '../detect.js';
import type { Item } from '../manifest/types.js';

/** Every file under `dir`, relative to it, sorted. Reading the repo dir is allowed (it is not HOME). */
function listFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** One copy action per file of each local skill dir, into `<skillsDir>/<skill name>/`. */
export function localSkillCopies(item: Item, repoRoot: string, skillsDir: string): Action[] {
  const acts: Action[] = [];
  for (const d of item.install.local_skills ?? []) {
    const src = join(repoRoot, d);
    for (const f of listFiles(src)) {
      acts.push({ kind: 'copy', from: join(src, f), to: join(skillsDir, basename(d), f) });
    }
  }
  return acts;
}

/** `files` entries: `to` starts with `~/`; mode only when the manifest gives one. */
export function fileCopies(item: Item, env: Env, repoRoot: string): Action[] {
  return (item.install.files ?? []).map((f) => {
    const a: Action = {
      kind: 'copy', from: join(repoRoot, f.from),
      to: join(env.home, f.to.startsWith('~/') ? f.to.slice(2) : f.to),
    };
    if (f.mode !== undefined) a.mode = f.mode;
    return a;
  });
}

export function ruleBlock(item: Item, file: string, repoRoot: string): Action[] {
  if (!item.install.rule) return [];
  const body = readFileSync(join(repoRoot, item.install.rule), 'utf8').replace(/\s+$/, '');
  return [{ kind: 'block', file, id: item.id, body, style: 'md' }];
}

/** Shell-quotes an argument unless it is made of safe characters only. */
export const q = (s: string): string => (/^[\w@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
