import { hashFile, sha256, type Ctx } from './ctx.js';

/**
 * One thing a merge added. `path` is the key path from the root (numbers index arrays).
 * Containers the merge created are recorded with `createdContainer: true` and an empty `value`
 * before their children, so `unmergeJson` can prune them only when they end up empty.
 * Array elements are recorded with their index at add time and the element as `value`.
 */
export type JsonPath = { path: (string | number)[]; value: unknown; createdContainer: boolean };

/** A user value that the patch wanted to change. The user's value is always kept. */
export type JsonConflict = { path: (string | number)[]; existing: unknown; wanted: unknown };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length
      && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Deep-merges `patch` into a copy of `target` (inputs are not mutated). Objects merge
 * recursively; array elements of the patch are appended unless a deep-equal element is already
 * present; a user value that differs from the patch (scalar or type mismatch) is kept and
 * reported in `conflicts`. Merging the same patch twice adds nothing the second time.
 * An `undefined` target (file absent) is treated as an empty object.
 */
export function mergeJson(target: unknown, patch: unknown): {
  result: unknown; added: JsonPath[]; conflicts: JsonConflict[];
} {
  const added: JsonPath[] = [];
  const conflicts: JsonConflict[] = [];
  const root = target === undefined ? {} : structuredClone(target);
  const result = mergeInto(root, structuredClone(patch), [], added, conflicts);
  return { result, added, conflicts };
}

function mergeInto(
  t: unknown, p: unknown, path: (string | number)[], added: JsonPath[], conflicts: JsonConflict[],
): unknown {
  if (isObj(t) && isObj(p)) {
    for (const [k, pv] of Object.entries(p)) {
      t[k] = Object.hasOwn(t, k)
        ? mergeInto(t[k], pv, [...path, k], added, conflicts)
        : build(pv, [...path, k], added);
    }
    return t;
  }
  if (Array.isArray(t) && Array.isArray(p)) {
    for (const el of p) {
      if (t.some((x) => deepEqual(x, el))) continue;
      added.push({ path: [...path, t.length], value: structuredClone(el), createdContainer: false });
      t.push(el);
    }
    return t;
  }
  if (!deepEqual(t, p)) conflicts.push({ path, existing: t, wanted: p });
  return t;
}

/** Builds a value at a path that did not exist, recording every container and leaf. */
function build(v: unknown, path: (string | number)[], added: JsonPath[]): unknown {
  if (isObj(v)) {
    added.push({ path, value: {}, createdContainer: true });
    const o: Obj = {};
    for (const [k, x] of Object.entries(v)) o[k] = build(x, [...path, k], added);
    return o;
  }
  if (Array.isArray(v)) {
    added.push({ path, value: [], createdContainer: true });
    const a: unknown[] = [];
    for (const el of v) {
      if (a.some((x) => deepEqual(x, el))) continue;
      added.push({ path: [...path, a.length], value: structuredClone(el), createdContainer: false });
      a.push(el);
    }
    return a;
  }
  added.push({ path, value: structuredClone(v), createdContainer: false });
  return v;
}

function getAt(root: unknown, path: (string | number)[]): unknown {
  let cur = root;
  for (const k of path) {
    if (Array.isArray(cur) && typeof k === 'number') cur = cur[k];
    else if (isObj(cur) && typeof k === 'string' && Object.hasOwn(cur, k)) cur = cur[k];
    else return undefined;
  }
  return cur;
}

const isEmpty = (v: unknown) =>
  (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

/**
 * Removes exactly what `mergeJson` added (returns a copy). A leaf is removed only if it still
 * deep-equals what was added (a value the user changed stays). An array element is removed at
 * its recorded index, or at its last deep-equal occurrence if the array moved. A created
 * container is removed only if it is empty; pre-existing containers are never pruned.
 */
export function unmergeJson(current: unknown, added: JsonPath[]): unknown {
  const root = structuredClone(current);
  for (const a of [...added].reverse()) {
    if (a.path.length === 0) continue;
    const parent = getAt(root, a.path.slice(0, -1));
    const key = a.path[a.path.length - 1];
    if (Array.isArray(parent) && typeof key === 'number') {
      let i = deepEqual(parent[key], a.value) ? key : -1;
      for (let j = parent.length - 1; i < 0 && j >= 0; j--) if (deepEqual(parent[j], a.value)) i = j;
      if (i >= 0) parent.splice(i, 1);
    } else if (isObj(parent) && typeof key === 'string' && Object.hasOwn(parent, key)) {
      const cur = parent[key];
      if (a.createdContainer ? isEmpty(cur) : deepEqual(cur, a.value)) delete parent[key];
    }
  }
  return root;
}

// ---------------------------------------------------------------------------------------------
// File level: merge a patch into a JSON file through Ctx, and undo it.

/**
 * Undo data for a `json-merge` action (stored in state.json).
 * - `added`: what the merge added, for `unmergeJson` when the file changed since install.
 * - `conflicts`: user values that were kept (informational).
 * - `originalHash`: sha256 of the file before this action, null if it did not exist.
 * - `afterHash`: sha256 of what this action wrote, null if it wrote nothing (already present).
 * - `backupPath`: backup holding the exact pre-action bytes (verified against `originalHash`).
 * - `originalText`: the pre-action text, kept only when no matching backup exists (e.g. a
 *   second write to the same file in one run, whose backup holds the pre-run bytes).
 * - `createdDirs`: parent dirs this action created, outermost first.
 */
export interface JsonMergeUndo {
  added: JsonPath[];
  conflicts: JsonConflict[];
  originalHash: string | null;
  afterHash: string | null;
  backupPath: string | null;
  originalText?: string;
  createdDirs: string[];
}

export type UndoResult = {
  /** `skipped`: the file was left untouched because our part of it was edited by the user. */
  status: 'restored' | 'unmerged' | 'removed' | 'missing' | 'noop' | 'skipped';
  /** True when the file was not what this action wrote (the user or another action changed it). */
  userChanged: boolean;
};

export class JsonParseError extends Error {
  constructor(readonly file: string, cause: unknown) {
    super(
      `${file} is not plain JSON (comments or trailing commas?); agentic-setup will not edit it. `
      + `Fix or merge it by hand. (${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = 'JsonParseError';
  }
}

function parseJsonFile(file: string, text: string | null): unknown {
  if (text === null || text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new JsonParseError(file, e);
  }
}

interface JsonFormat { indent: string; eol: string; finalNewline: boolean }

/** Keeps the file's indentation (first indented line), line ending and final newline. */
function detectFormat(text: string | null): JsonFormat {
  if (text === null || text.trim() === '') return { indent: '  ', eol: '\n', finalNewline: true };
  const m = /\n([ \t]+)\S/.exec(text);
  return {
    indent: m ? m[1].slice(0, 10) : '  ',
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    finalNewline: text.endsWith('\n'),
  };
}

function serialize(v: unknown, f: JsonFormat): string {
  let s = JSON.stringify(v, null, f.indent);
  if (f.eol !== '\n') s = s.replace(/\n/g, f.eol);
  return f.finalNewline ? s + f.eol : s;
}

/** Merges `patch` into the JSON `file`. Writes nothing when the patch is already present. */
export function applyJsonMerge(ctx: Ctx, file: string, patch: object): JsonMergeUndo {
  const text = ctx.readText(file);
  const { result, added, conflicts } = mergeJson(parseJsonFile(file, text), patch);
  if (added.length === 0) {
    return {
      added, conflicts, originalHash: text === null ? null : sha256(text), afterHash: null,
      backupPath: null, createdDirs: [],
    };
  }
  const w = ctx.writeText(file, serialize(result, detectFormat(text)));
  const backupOk = w.backupPath !== null && hashFile(w.backupPath) === w.beforeHash;
  const u: JsonMergeUndo = {
    added, conflicts, originalHash: w.beforeHash, afterHash: w.afterHash,
    backupPath: backupOk ? w.backupPath : null, createdDirs: w.createdDirs,
  };
  if (text !== null && !backupOk) u.originalText = text;
  return u;
}

/**
 * Undoes `applyJsonMerge`. If the file is still exactly what the install wrote, the original
 * bytes come back (or the file is deleted if it did not exist). Otherwise only the added keys
 * and elements are removed and the rest, including user edits, is re-serialised in the file's
 * format. Empty dirs the install created are removed.
 */
export function undoJsonMerge(ctx: Ctx, file: string, u: JsonMergeUndo): UndoResult {
  if (u.afterHash === null) return { status: 'noop', userChanged: false };
  const cur = ctx.readText(file);
  if (cur === null) {
    ctx.removeEmptyDirs(u.createdDirs);
    return { status: 'missing', userChanged: true };
  }
  if (sha256(cur) === u.afterHash) {
    if (u.originalHash === null) {
      ctx.remove(file);
      ctx.removeEmptyDirs(u.createdDirs);
      return { status: 'restored', userChanged: false };
    }
    if (u.backupPath && hashFile(u.backupPath) === u.originalHash) {
      ctx.copy(u.backupPath, file);
      return { status: 'restored', userChanged: false };
    }
    if (u.originalText !== undefined && sha256(u.originalText) === u.originalHash) {
      ctx.writeText(file, u.originalText);
      return { status: 'restored', userChanged: false };
    }
  }
  const next = unmergeJson(parseJsonFile(file, cur), u.added);
  if (u.originalHash === null && isEmpty(next)) ctx.remove(file);
  else {
    const s = serialize(next, detectFormat(cur));
    if (s !== cur) ctx.writeText(file, s);
  }
  ctx.removeEmptyDirs(u.createdDirs);
  return { status: 'unmerged', userChanged: sha256(cur) !== u.afterHash };
}


// ---------------------------------------------------------------------------------------------
// Tracked keys: paths an external command (e.g. `claude plugin install`) writes into a JSON file.

/**
 * What existed before the command ran: whether the file existed, and for each tracked path
 * `existed[i][j]` is true when its first j+1 keys were present.
 */
export interface JsonTrackBefore { fileExisted: boolean; existed: boolean[][] }

/**
 * Records which tracked paths exist now. A file that exists but does not parse counts as having
 * every tracked path, so uninstall never removes anything from it (R22).
 */
export function trackJsonBefore(ctx: Ctx, track: { file: string; paths: string[][] }): JsonTrackBefore {
  const text = ctx.readText(track.file);
  let root: unknown;
  try {
    root = parseJsonFile(track.file, text);
  } catch {
    return { fileExisted: true, existed: track.paths.map((p) => p.map(() => true)) };
  }
  return {
    fileExisted: text !== null,
    existed: track.paths.map((p) => p.map((_, j) => getAt(root, p.slice(0, j + 1)) !== undefined)),
  };
}

/**
 * After the command's undo ran: removes each tracked path that did not exist before, then prunes
 * the parents that were absent before and are now empty. Deletes the file when it did not exist
 * before and nothing (or `{}`) is left. Keeps the file's format, like `undoJsonMerge`.
 */
export function undoJsonTrack(ctx: Ctx, track: { file: string; paths: string[][] }, before: JsonTrackBefore): void {
  const cur = ctx.readText(track.file);
  if (cur === null) return;
  const root = parseJsonFile(track.file, cur);
  if (root !== undefined && !isObj(root)) return;
  const next = root === undefined ? {} : structuredClone(root);
  track.paths.forEach((p, i) => {
    for (let j = p.length - 1; j >= 0; j--) {
      if (before.existed[i]?.[j]) break;
      const parent = getAt(next, p.slice(0, j));
      if (!isObj(parent) || !Object.hasOwn(parent, p[j])) continue;
      if (j === p.length - 1 || isEmpty(parent[p[j]])) delete parent[p[j]];
      else break;
    }
  });
  if (!before.fileExisted && isEmpty(next)) {
    ctx.remove(track.file);
    return;
  }
  const s = serialize(next, detectFormat(cur));
  if (s !== cur && !deepEqual(next, root)) ctx.writeText(track.file, s);
}
