import { existsSync, statSync } from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';
import { AGENT_IDS, BENEFITS, KINDS, PACK_IDS, REDISTRIBUTION, RISKS, SOURCE_TYPES } from './types.js';

const FORBIDDEN_ENV = ['DO_NOT_TRACK', 'DISABLE_TELEMETRY', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'];
const SHA256 = /^[0-9a-f]{64}$/i;
const BINARY_REQ = /^[\w.-]+\s*>=\s*\S+$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const oneOf = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);

/** Checks a repo-relative path; pushes errors, returns resolved path when usable. */
function checkRepoPath(
  rel: unknown, repoRoot: string, where: string, errors: string[], opts: { dir?: boolean; ext?: string } = {},
): void {
  if (!isStr(rel)) {
    errors.push(`${where}: must be a non-empty repo-relative path`);
    return;
  }
  const norm = normalize(rel).split(sep).join('/');
  if (isAbsolute(rel) || norm === '..' || norm.startsWith('../')) {
    errors.push(`${where}: path "${rel}" must stay inside the repo`);
    return;
  }
  if (/^(private|work)(\/|$)/.test(norm)) {
    errors.push(`${where}: path "${rel}" is under ${norm.split('/')[0]}/, which is never bundled`);
    return;
  }
  const abs = resolve(repoRoot, norm);
  if (!existsSync(abs)) {
    errors.push(`${where}: path "${rel}" does not exist`);
    return;
  }
  const isDir = statSync(abs).isDirectory();
  if (opts.dir && (!isDir || !existsSync(resolve(abs, 'SKILL.md')))) {
    errors.push(`${where}: "${rel}" must be a directory containing SKILL.md`);
  } else if (!opts.dir && isDir) {
    errors.push(`${where}: "${rel}" must be a file`);
  } else if (opts.ext && !norm.endsWith(opts.ext)) {
    errors.push(`${where}: "${rel}" must be a ${opts.ext} file`);
  }
}

function checkEnum(list: readonly string[], v: unknown, where: string, errors: string[]): void {
  if (!oneOf(list, v)) errors.push(`${where}: "${String(v)}" is not one of ${list.join(', ')}`);
}

function checkEnumArray(list: readonly string[], v: unknown, where: string, errors: string[], nonEmpty = true): void {
  if (!Array.isArray(v) || (nonEmpty && v.length === 0)) {
    errors.push(`${where}: must be a${nonEmpty ? ' non-empty' : ''} array`);
    return;
  }
  for (const x of v) checkEnum(list, x, where, errors);
}

function validateInstall(it: Obj, repoRoot: string, w: string, errors: string[]): void {
  const inst = it.install;
  if (!isObj(inst)) {
    errors.push(`${w}.install: required object`);
    return;
  }
  const linkOnly = it.redistribution === 'link-only';
  const bundled = (field: string) => {
    if (linkOnly) errors.push(`${w}: redistribution link-only item must not reference repo paths (install.${field})`);
  };
  if (inst.local_skills !== undefined) {
    if (!isStrArr(inst.local_skills)) errors.push(`${w}.install.local_skills: must be a string array`);
    else {
      if (inst.local_skills.length) bundled('local_skills');
      inst.local_skills.forEach((p, i) => checkRepoPath(p, repoRoot, `${w}.install.local_skills[${i}]`, errors, { dir: true }));
    }
  }
  if (inst.rule !== undefined) {
    bundled('rule');
    checkRepoPath(inst.rule, repoRoot, `${w}.install.rule`, errors, { ext: '.md' });
  }
  if (inst.files !== undefined) {
    if (!Array.isArray(inst.files)) errors.push(`${w}.install.files: must be an array`);
    else {
      if (inst.files.length) bundled('files');
      inst.files.forEach((f, i) => {
        const fw = `${w}.install.files[${i}]`;
        if (!isObj(f)) return void errors.push(`${fw}: must be an object`);
        checkRepoPath(f.from, repoRoot, `${fw}.from`, errors);
        if (!isStr(f.to) || !f.to.startsWith('~/')) errors.push(`${fw}.to: must start with ~/`);
        if (f.mode !== undefined && !Number.isInteger(f.mode)) errors.push(`${fw}.mode: must be an integer`);
      });
    }
  }
  if (inst.skills !== undefined) {
    const s = inst.skills;
    if (!isObj(s) || !isStr(s.repo) || !isStrArr(s.names)) errors.push(`${w}.install.skills: needs repo and names[]`);
  }
  if (inst.hooks !== undefined) {
    if (!isObj(inst.hooks)) errors.push(`${w}.install.hooks: must be an object keyed by agent`);
    else {
      for (const [agent, h] of Object.entries(inst.hooks)) {
        if (!oneOf(AGENT_IDS, agent)) errors.push(`${w}.install.hooks: unknown agent "${agent}"`);
        if (!isObj(h) || !isStr(h.event) || !isStr(h.command)) errors.push(`${w}.install.hooks.${agent}: needs event and command`);
      }
    }
  }
  if (inst.mcp !== undefined) {
    const mcp = inst.mcp;
    if (!isObj(mcp) || !isStr(mcp.name) || !oneOf(['http', 'stdio'], mcp.transport)) {
      errors.push(`${w}.install.mcp: needs name and transport http|stdio`);
    } else if (mcp.transport === 'http' ? !isStr(mcp.url) : !isStr(mcp.command)) {
      errors.push(`${w}.install.mcp: ${mcp.transport} transport needs ${mcp.transport === 'http' ? 'url' : 'command'}`);
    }
  }
  if (inst.settings !== undefined && !isObj(inst.settings)) errors.push(`${w}.install.settings: must be an object`);
  if (inst.plugin !== undefined) {
    const p = inst.plugin;
    if (!isObj(p) || !isStr(p.marketplace) || !isStr(p.name)) errors.push(`${w}.install.plugin: needs marketplace and name`);
  }
  if (inst.commands !== undefined && !isStrArr(inst.commands)) errors.push(`${w}.install.commands: must be a string array`);
  if (inst.commands_unless !== undefined) {
    if (!isStr(inst.commands_unless)) errors.push(`${w}.install.commands_unless: must be a string`);
    else if (!isStrArr(inst.commands) || !inst.commands.length) errors.push(`${w}.install.commands_unless: needs install.commands`);
  }

  // No telemetry opt-out env names anywhere in install text or lifecycle commands.
  const text = JSON.stringify([inst, it.uninstall, it.update, it.post_install, it.detect, it.verify]);
  for (const k of FORBIDDEN_ENV) {
    if (text.includes(k)) errors.push(`${w}: must not reference ${k}`);
  }
}

function validateItem(it: unknown, idx: number, packIds: Set<string>, repoRoot: string, errors: string[]): void {
  const w0 = `items[${idx}]`;
  if (!isObj(it)) return void errors.push(`${w0}: must be an object`);
  const w = isStr(it.id) ? `item ${it.id}` : w0;
  for (const f of ['id', 'name', 'summary', 'verify']) {
    if (!isStr(it[f])) errors.push(`${w}: ${f} is required`);
  }
  if (!isStr(it.pack) || !packIds.has(it.pack)) errors.push(`${w}: unknown pack "${String(it.pack)}"`);
  checkEnumArray(BENEFITS, it.benefit, `${w}: benefit`, errors, false);
  checkEnumArray(KINDS, it.kinds, `${w}: kinds`, errors);
  checkEnumArray(AGENT_IDS, it.agents, `${w}: agents`, errors);
  checkEnum(REDISTRIBUTION, it.redistribution, `${w}: redistribution`, errors);
  checkEnum(RISKS, it.risk, `${w}: risk`, errors);
  if ((it.risk === 'med' || it.risk === 'high') && !isStr(it.risk_reason)) {
    errors.push(`${w}: risk ${it.risk} requires risk_reason`);
  }
  if (typeof it.token_cost !== 'number' || !(it.token_cost >= 0)) errors.push(`${w}: token_cost must be a number >= 0`);

  if (isStr(it.id)) {
    // Generated later from the manifest, so the file is not required to exist yet.
    if (it.details !== `docs/items/${it.id}.md`) errors.push(`${w}: details must be docs/items/${it.id}.md`);
  } else errors.push(`${w}: details cannot be checked without id`);

  const src = it.source;
  if (!isObj(src) || !oneOf(SOURCE_TYPES, src.type) || !isStr(src.ref)) {
    errors.push(`${w}: source needs a valid type and ref`);
  } else if (src.type === 'curl-script' && !(typeof src.sha256 === 'string' && SHA256.test(src.sha256))) {
    errors.push(`${w}: curl-script source requires a 64-hex sha256`);
  }
  for (const f of ['uninstall', 'update', 'post_install', 'requires', 'conflicts']) {
    if (it[f] !== undefined && !isStrArr(it[f])) errors.push(`${w}: ${f} must be a string array`);
  }
  for (const f of ['manual', 'needs_key', 'detect']) {
    if (it[f] !== undefined && typeof it[f] !== 'string') errors.push(`${w}: ${f} must be a string`);
  }
  validateInstall(it, repoRoot, w, errors);
}

export function validateManifest(m: unknown, repoRoot: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(m) || !Array.isArray(m.packs) || !Array.isArray(m.items)) {
    return { ok: false, errors: ['manifest must have packs[] and items[]'] };
  }
  const packIds = new Set<string>();
  m.packs.forEach((p, i) => {
    if (!isObj(p) || !oneOf(PACK_IDS, p.id)) return void errors.push(`packs[${i}]: unknown pack id "${isObj(p) ? String(p.id) : ''}"`);
    if (packIds.has(p.id as string)) errors.push(`packs[${i}]: duplicate pack id ${String(p.id)}`);
    packIds.add(p.id as string);
    if (!isStr(p.title) || !isStr(p.summary) || typeof p.default !== 'boolean') {
      errors.push(`pack ${String(p.id)}: needs title, summary and boolean default`);
    }
  });

  const ids = new Set<string>();
  m.items.forEach((it, i) => {
    if (isObj(it) && isStr(it.id)) {
      if (ids.has(it.id)) errors.push(`item ${it.id}: duplicate id`);
      ids.add(it.id);
    }
    validateItem(it, i, packIds, repoRoot, errors);
  });
  for (const it of m.items) {
    if (!isObj(it)) continue;
    for (const f of ['requires', 'conflicts'] as const) {
      if (!isStrArr(it[f])) continue;
      for (const ref of it[f] as string[]) {
        // `bin>=ver` in requires names a binary (checked on PATH by plan/doctor), not an item.
        if (f === 'requires' && BINARY_REQ.test(ref)) continue;
        if (!ids.has(ref)) errors.push(`item ${String(it.id)}: ${f} references unknown id "${ref}"`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
