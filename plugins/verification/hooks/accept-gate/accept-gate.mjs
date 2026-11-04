#!/usr/bin/env node
// accept-gate: one Claude Code hook for the default verification loop.
//   Stop        block a done claim while an acceptance check is open, while checks or check
//               files differ from the `accept-lock` tag, or while ledger completions are out of order.
//   PreToolUse  (Write|Edit|MultiEdit) deny a ledger write that records a task out of order.
// Resolution: newest .superpowers/sdd/*/progress.md -> plan -> **Spec:** -> "## Acceptance checks";
// with no ledger, the newest spec under docs/superpowers/specs that has that section.
// It never runs CHECK lines, is inert without a ledger or tag, releases after 3 blocks per
// session, and fails open (exit 0 + stderr note) on any error.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { pendingAgents } from './pending.mjs';

const TAG = 'accept-lock';
const MAX_BLOCKS = Number(process.env.ACCEPT_GATE_MAX_BLOCKS || 3);
const STATE = process.env.ACCEPT_GATE_STATE || join(homedir(), '.local/state/accept-gate');
const LEDGER_RE = /\.superpowers\/sdd\/[^/]+\/progress\.md$/;

const git = (root, ...a) => {
  try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

function section(text) {
  if (!text) return null;
  const m = text.match(/^## Acceptance checks[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  return m ? m[1] : null;
}
// What the user approved: box state, EVIDENCE text, ABANDON lines and blanks may change.
const normalize = (sec) => sec.split('\n')
  .filter((l) => l.trim() && !/^ABANDON:/.test(l.trim()))
  .map((l) => l.replace(/^(\s*)- \[[ xX]\]/, '$1- [ ]').replace(/·\s*EVIDENCE:.*$/, '· EVIDENCE:').trimEnd())
  .join('\n');

function orderProblem(ledgerText) {
  const done = [...(ledgerText || '').matchAll(/^Task (\d+): complete\b/gm)].map((m) => Number(m[1]));
  for (let i = 0; i < done.length; i++) {
    if (done[i] !== i + 1) return `ledger records Task ${done[i]}: complete where Task ${i + 1} was next`;
  }
  return null;
}

function newestLedger(root) {
  const base = join(root, '.superpowers/sdd');
  let best = null;
  for (const d of existsSync(base) ? readdirSync(base) : []) {
    const p = join(base, d, 'progress.md');
    if (existsSync(p) && (!best || statSync(p).mtimeMs > statSync(best).mtimeMs)) best = p;
  }
  return best;
}

function findSpec(root, ledgerPath) {
  if (ledgerPath) {
    const plan = (read(ledgerPath) || '').match(/^# SDD ledger — plan: (.+)$/m)?.[1]?.trim();
    const planText = plan && read(isAbsolute(plan) ? plan : join(root, plan));
    const spec = planText?.match(/\*\*Spec:\*\*\s*\[?`?([^`\s\]]+)/)?.[1];
    if (spec) return isAbsolute(spec) ? spec.slice(root.length + 1) : spec;
  }
  const dir = join(root, 'docs/superpowers/specs');
  const specs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => join(dir, f)) : [];
  specs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const hit = specs.find((p) => section(read(p)) !== null);
  return hit ? hit.slice(root.length + 1) : null;
}

function problems(root) {
  const ledgerPath = newestLedger(root);
  const ledgerText = ledgerPath ? read(ledgerPath) : null;
  const tagSha = git(root, 'rev-parse', '-q', '--verify', `refs/tags/${TAG}^{commit}`);
  const pinFile = join(STATE, 'pins', createHash('sha1').update(root).digest('hex'));
  const pin = read(pinFile)?.trim() || null;
  if (tagSha && !pin) { mkdirSync(join(STATE, 'pins'), { recursive: true }); writeFileSync(pinFile, tagSha + '\n'); }

  const hasDone = /^Task \d+: complete\b/m.test(ledgerText || '');
  const moved = tagSha && (git(root, 'rev-parse', 'HEAD') !== tagSha || git(root, 'status', '--porcelain') !== '');
  if (!hasDone && !moved && !(pin && pin !== tagSha)) return []; // inert: no work claimed since approval, tag where pinned

  const out = [];
  const order = orderProblem(ledgerText);
  if (order) out.push(order);
  if (pin && !tagSha) out.push(`the ${TAG} tag was deleted; only the user may re-approve the checks`);
  if (pin && tagSha && pin !== tagSha) out.push(`${TAG} moved (pinned ${pin.slice(0, 7)}, now ${tagSha.slice(0, 7)}); only the user may re-approve: they delete ${pinFile} after approving`);

  const specRel = findSpec(root, ledgerPath);
  const now = specRel ? section(read(join(root, specRel))) : null;
  if (now === null) return out;

  const abandoned = new Set([...now.matchAll(/^ABANDON:\s*(AC-\d+)/gm)].map((m) => m[1]));
  const open = now.split('\n').filter((l) => /^\s*- \[ \]/.test(l))
    .map((l) => l.match(/AC-\d+/)?.[0] || l.trim().slice(0, 40)).filter((id) => !abandoned.has(id));
  if (open.length) out.push(`open acceptance checks in ${specRel}: ${open.join(', ')}`);

  if (tagSha) {
    const locked = section(git(root, 'show', `${tagSha}:${specRel}`));
    if (locked !== null && normalize(locked) !== normalize(now)) out.push(`Acceptance checks section changed since ${TAG} (only box ticks, EVIDENCE and ABANDON lines may change)`);
    const globs = (now.match(/^Check files:\s*(.+)$/m)?.[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (globs.length) {
      const changed = git(root, 'diff', '--name-only', tagSha, '--', ...globs.map((g) => `:(glob)${g}`));
      if (changed) out.push(`check files changed since ${TAG}: ${changed.split('\n').join(', ')}`);
    }
  }
  return out;
}

function onStop(input) {
  const root = git(input.cwd || process.cwd(), 'rev-parse', '--show-toplevel');
  if (!root) return;
  if (input.transcript_path && pendingAgents(input.transcript_path) > 0) return; // waiting, not claiming done
  const found = problems(root);
  const countFile = join(STATE, 'blocks', String(input.session_id || 'none').replace(/[^\w.-]/g, '_'));
  if (!found.length) { rmSync(countFile, { force: true }); return; }
  const count = Number(read(countFile) || 0);
  if (input.stop_hook_active && count >= MAX_BLOCKS) {
    rmSync(countFile, { force: true });
    process.stderr.write(`accept-gate: released after ${MAX_BLOCKS} blocks; unresolved: ${found.join('; ')}\n`);
    return;
  }
  mkdirSync(join(STATE, 'blocks'), { recursive: true });
  writeFileSync(countFile, String(count + 1));
  const reason = `accept-gate: not done yet.\n- ${found.join('\n- ')}\n` +
    'Run each open CHECK and tick its box with EVIDENCE, or write `ABANDON: AC-n <reason>` and tell the user. ' +
    'Never edit approved checks, check files or the tag yourself; if a check is wrong, stop and ask the user.';
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

function onPreToolUse(input) {
  const ti = input.tool_input || {};
  const path = ti.file_path || '';
  if (!LEDGER_RE.test(path) || !['Write', 'Edit', 'MultiEdit'].includes(input.tool_name)) return;
  let next;
  if (input.tool_name === 'Write') next = ti.content || '';
  else {
    next = read(path) || '';
    for (const e of input.tool_name === 'Edit' ? [ti] : ti.edits || []) {
      next = e.replace_all ? next.split(e.old_string).join(e.new_string) : next.replace(e.old_string, e.new_string);
    }
  }
  const order = orderProblem(next);
  if (order) process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `accept-gate: ${order}. Finish and review tasks in plan order.` } }));
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (input.hook_event_name === 'Stop') onStop(input);
  else if (input.hook_event_name === 'PreToolUse') onPreToolUse(input);
} catch (e) {
  process.stderr.write(`accept-gate: failed open: ${e.message}\n`);
}
process.exit(0);
