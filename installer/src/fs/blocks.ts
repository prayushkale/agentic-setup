import { sha256, type Ctx } from './ctx.js';
import type { UndoResult } from './json-merge.js';

export type BlockStyle = 'md' | 'toml';

function markers(id: string, style: BlockStyle): [string, string] {
  return style === 'md'
    ? [`<!-- agentic-setup:${id} begin -->`, `<!-- agentic-setup:${id} end -->`]
    : [`# agentic-setup:${id} begin`, `# agentic-setup:${id} end`];
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

/** Finds the block with `id`: `start` is the begin marker, `end` is just past the end marker. */
function findBlock(text: string, id: string, style: BlockStyle): { start: number; end: number } | null {
  const [b, e] = markers(id, style);
  let i = text.indexOf(b);
  while (i > 0 && text[i - 1] !== '\n') i = text.indexOf(b, i + 1);
  if (i < 0) return null;
  const j = text.indexOf(e, i + b.length);
  if (j < 0) throw new Error(`agentic-setup block "${id}" has a begin marker but no end marker`);
  return { start: i, end: j + e.length };
}

function render(id: string, body: string, style: BlockStyle, eol: string): string {
  const [b, e] = markers(id, style);
  const inner = body.replace(/(\r?\n)+$/, '');
  return inner === '' ? `${b}${eol}${e}` : `${b}${eol}${inner.replace(/\r?\n/g, eol)}${eol}${e}`;
}

/**
 * The separator `addBlock` puts before a new block so that exactly one blank line precedes it:
 * '' for an empty text, a text already ending in a blank line, or a replaced block; one EOL
 * after a final newline; two EOLs when there is no final newline. Record it for `removeBlock`.
 */
export function blockSeparator(text: string, id: string, style: BlockStyle): string {
  if (findBlock(text, id, style)) return '';
  const eol = eolOf(text);
  if (text === '' || text.endsWith(eol + eol) || text.endsWith('\n\n')) return '';
  if (text.endsWith('\n')) return eol;
  return eol + eol;
}

/**
 * Appends a marked block (begin marker, body, end marker, EOL), or replaces the block with the
 * same id in place, so adding twice yields one block.
 */
export function addBlock(text: string, id: string, body: string, style: BlockStyle): string {
  const eol = eolOf(text);
  const block = render(id, body, style, eol);
  const f = findBlock(text, id, style);
  if (f) return text.slice(0, f.start) + block + text.slice(f.end);
  return text + blockSeparator(text, id, style) + block + eol;
}

/**
 * Removes the block with `id` and the EOL after it, then the `separator` that `addBlock` put
 * before it (pass the recorded `blockSeparator` value) if the text still ends with it there.
 * With nothing else changed this gives back the exact pre-add text. Without a recorded
 * separator it removes one blank line before the block. Text without the block is returned as is.
 */
export function removeBlock(text: string, id: string, style: BlockStyle, separator?: string): string {
  const f = findBlock(text, id, style);
  if (!f) return text;
  let end = f.end;
  if (text.startsWith('\r\n', end)) end += 2;
  else if (text[end] === '\n') end += 1;
  let before = text.slice(0, f.start);
  const eol = eolOf(text);
  const sep = separator ?? (before.endsWith(eol + eol) ? eol : '');
  if (sep && before.endsWith(sep)) before = before.slice(0, -sep.length);
  return before + text.slice(end);
}

// ---------------------------------------------------------------------------------------------
// File level: add a block to a file through Ctx, and undo it.

/**
 * Undo data for a `block` action (stored in state.json).
 * - `separator`: what `addBlock` put before the block (see `blockSeparator`).
 * - `previousBlock`: the raw text of a same-id block this action replaced, else null.
 * - `blockHash`: sha256 of the block (begin marker through end marker) as written, so undo can
 *   tell whether the user edited inside it. Null if nothing was written.
 * - `originalHash`: sha256 of the file before this action, null if it did not exist.
 * - `afterHash`: sha256 of what this action wrote, null if it wrote nothing.
 * - `backupPath`: this run's backup of the file, null if none.
 * - `createdDirs`: parent dirs this action created, outermost first.
 */
export interface BlockUndo {
  separator: string;
  previousBlock: string | null;
  blockHash: string | null;
  originalHash: string | null;
  afterHash: string | null;
  backupPath: string | null;
  createdDirs: string[];
}

export function applyBlock(ctx: Ctx, file: string, id: string, body: string, style: BlockStyle): BlockUndo {
  const existed = ctx.exists(file);
  const text = ctx.readText(file) ?? '';
  const f = findBlock(text, id, style);
  const separator = blockSeparator(text, id, style);
  const next = addBlock(text, id, body, style);
  if (existed && next === text) {
    return {
      separator: '', previousBlock: null, blockHash: null, originalHash: sha256(text), afterHash: null,
      backupPath: null, createdDirs: [],
    };
  }
  const w = ctx.writeText(file, next);
  const nf = findBlock(next, id, style)!;
  return {
    separator, previousBlock: f ? text.slice(f.start, f.end) : null,
    blockHash: sha256(next.slice(nf.start, nf.end)),
    originalHash: w.beforeHash, afterHash: w.afterHash, backupPath: w.backupPath,
    createdDirs: w.createdDirs,
  };
}

/**
 * Undoes `applyBlock`: removes only the block (or puts back the block it replaced), leaving
 * user edits outside it. Deletes the file if the install created it and nothing else is left,
 * then removes empty dirs the install created. If the user edited inside the block, it cannot
 * be removed cleanly: the file is left untouched and the result is `skipped`.
 */
export function undoBlock(ctx: Ctx, file: string, id: string, style: BlockStyle, u: BlockUndo): UndoResult {
  if (u.afterHash === null) return { status: 'noop', userChanged: false };
  const cur = ctx.readText(file);
  const f = cur === null ? null : findBlock(cur, id, style);
  if (cur === null || !f) {
    ctx.removeEmptyDirs(u.createdDirs);
    return { status: 'missing', userChanged: true };
  }
  if (u.blockHash != null && sha256(cur.slice(f.start, f.end)) !== u.blockHash) {
    return { status: 'skipped', userChanged: true };
  }
  const userChanged = sha256(cur) !== u.afterHash;
  const next = u.previousBlock !== null
    ? cur.slice(0, f.start) + u.previousBlock + cur.slice(f.end)
    : removeBlock(cur, id, style, u.separator);
  if (u.originalHash === null && next === '') ctx.remove(file);
  else if (next !== cur) ctx.writeText(file, next);
  ctx.removeEmptyDirs(u.createdDirs);
  return { status: u.previousBlock !== null ? 'restored' : 'removed', userChanged };
}
