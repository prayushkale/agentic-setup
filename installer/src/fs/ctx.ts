import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** One file the run writes (or would write, in dry-run). `null` means absent. */
export type PlannedChange = { file: string; before: string | null; after: string | null };

/** What a write did, so the caller can record undo data. */
export interface WriteResult {
  /** Dirs that did not exist and were created for this write, outermost first. */
  createdDirs: string[];
  /** Where this Ctx backed up the file's pre-run bytes, or null if it did not exist. */
  backupPath: string | null;
  /** sha256 of the file just before this write, or null if it did not exist. */
  beforeHash: string | null;
  /** sha256 of what was written, or null after a remove. */
  afterHash: string | null;
}

export interface CtxOptions {
  home: string;
  repoRoot: string;
  dryRun?: boolean;
  /** npm global prefix for `npm i -g`; unset means inherit the environment. */
  npmPrefix?: string;
}

export const sha256 = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

/** sha256 of a file's bytes, or null if it does not exist. */
export function hashFile(p: string): string | null {
  return existsSync(p) ? sha256(readFileSync(p)) : null;
}

/**
 * Where a write to `p` must land: `p` itself, or the file a symlink at `p` points to (followed to
 * the end; a dangling link resolves to its target path), so an atomic rename keeps the link (R25).
 */
export function writeTarget(p: string, depth = 0): string {
  let isLink = false;
  try { isLink = lstatSync(p).isSymbolicLink(); } catch { return p; }
  if (!isLink) return p;
  try { return realpathSync(p); } catch { /* dangling, or a loop */ }
  if (depth >= 32) throw new Error(`${p}: too many levels of symbolic links`);
  return writeTarget(resolve(dirname(p), readlinkSync(p)), depth + 1);
}

/**
 * The only way the installer touches the filesystem. It backs each file up once per instance
 * under `<home>/.agentic-setup/backups/<timestamp>/<path relative to home>`, records the dirs it
 * creates, and in dry-run only appends to `planned` (later reads see the planned content).
 */
export class Ctx {
  readonly home: string;
  readonly repoRoot: string;
  readonly dryRun: boolean;
  readonly planned: PlannedChange[] = [];
  /** Commands the runner would have executed in dry-run. */
  readonly plannedCommands: string[] = [];
  readonly npmPrefix?: string;
  private backupRoot: string | null = null;
  private readonly backups = new Map<string, string | null>();
  /** Dry-run view of files written so far: path → content, or null when removed. */
  private readonly overlay = new Map<string, string | null>();
  /** Dry-run view of dirs that would have been created. */
  private readonly overlayDirs = new Set<string>();

  constructor(o: CtxOptions) {
    this.home = resolve(o.home);
    this.repoRoot = resolve(o.repoRoot);
    this.dryRun = o.dryRun ?? false;
    this.npmPrefix = o.npmPrefix;
  }

  exists(p: string): boolean {
    p = resolve(p);
    if (this.overlay.has(p)) return this.overlay.get(p) !== null;
    return this.overlayDirs.has(p) || existsSync(p);
  }

  /** UTF-8 content, or null when the file does not exist. */
  readText(p: string): string | null {
    p = resolve(p);
    if (this.overlay.has(p)) return this.overlay.get(p)!;
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  }

  writeText(p: string, s: string): WriteResult {
    return this.put(resolve(p), Buffer.from(s, 'utf8'), s);
  }

  copy(from: string, to: string, mode?: number): WriteResult {
    const data = readFileSync(resolve(from));
    // Keep the source's permission bits (exec) unless the caller gives a mode.
    return this.put(resolve(to), data, data.toString('utf8'), mode ?? statSync(resolve(from)).mode & 0o777);
  }

  remove(p: string): WriteResult {
    p = resolve(p);
    const before = this.readText(p);
    const beforeHash = this.currentHash(p);
    this.planned.push({ file: p, before, after: null });
    if (this.dryRun) {
      this.overlay.set(p, null);
      return { createdDirs: [], backupPath: null, beforeHash, afterHash: null };
    }
    const backupPath = this.backup(p);
    if (existsSync(p)) unlinkSync(p);
    return { createdDirs: [], backupPath, beforeHash, afterHash: null };
  }

  /**
   * Removes the given dirs that are empty, deepest first. Dirs that hold anything (for example
   * a file the user added) stay. Returns the removed dirs. No-op in dry-run.
   */
  removeEmptyDirs(dirs: string[]): string[] {
    if (this.dryRun) return [];
    const removed: string[] = [];
    const sorted = [...new Set(dirs.map((d) => resolve(d)))].sort((a, b) => b.length - a.length);
    for (const d of sorted) {
      if (existsSync(d) && statSync(d).isDirectory() && readdirSync(d).length === 0) {
        rmdirSync(d);
        removed.push(d);
      }
    }
    return removed;
  }

  private currentHash(p: string): string | null {
    if (this.overlay.has(p)) {
      const v = this.overlay.get(p);
      return v === null || v === undefined ? null : sha256(v);
    }
    return hashFile(p);
  }

  private put(p: string, data: Buffer, text: string, mode?: number): WriteResult {
    const before = this.readText(p);
    const beforeHash = this.currentHash(p);
    const afterHash = sha256(data);
    this.planned.push({ file: p, before, after: text });
    const createdDirs = this.missingDirs(dirname(p));
    if (this.dryRun) {
      this.overlay.set(p, text);
      for (const d of createdDirs) this.overlayDirs.add(d);
      return { createdDirs, backupPath: null, beforeHash, afterHash };
    }
    // The backup copies through a link, so it holds the real target's bytes.
    const backupPath = this.backup(p);
    if (createdDirs.length) mkdirSync(dirname(p), { recursive: true });
    // Atomic replace: write a temp file next to the real target, keep its mode, then rename onto
    // it. Through a symlink the rename lands on the target, so the link stays a link (R25).
    const real = writeTarget(p);
    if (real !== p) mkdirSync(dirname(real), { recursive: true });
    const tmp = `${real}.agentic-setup-${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, data);
    const keepMode = existsSync(real) ? statSync(real).mode & 0o7777 : undefined;
    if (mode !== undefined) chmodSync(tmp, mode);
    else if (keepMode !== undefined) chmodSync(tmp, keepMode);
    renameSync(tmp, real);
    return { createdDirs, backupPath, beforeHash, afterHash };
  }

  /** Dirs from `dir` upward that do not exist yet, outermost first. */
  private missingDirs(dir: string): string[] {
    const out: string[] = [];
    let d = dir;
    while (!this.exists(d)) {
      out.unshift(d);
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
    return out;
  }

  /** Copies the file's current bytes to the run's backup dir the first time it is touched. */
  private backup(p: string): string | null {
    if (this.backups.has(p)) return this.backups.get(p)!;
    if (!existsSync(p)) {
      // Nothing to back up; a later write in this run must not back up our own output.
      this.backups.set(p, null);
      return null;
    }
    const rel = relative(this.home, p);
    const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    const dest = join(this.ensureBackupRoot(), inside ? rel : join('_abs', p));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(p, dest);
    this.backups.set(p, dest);
    return dest;
  }

  private ensureBackupRoot(): string {
    if (this.backupRoot) return this.backupRoot;
    const base = join(this.home, '.agentic-setup', 'backups');
    const stamp = new Date().toISOString().replace(/:/g, '-');
    let root = join(base, stamp);
    for (let i = 1; existsSync(root); i++) root = join(base, `${stamp}-${i}`);
    mkdirSync(root, { recursive: true });
    return (this.backupRoot = root);
  }
}
