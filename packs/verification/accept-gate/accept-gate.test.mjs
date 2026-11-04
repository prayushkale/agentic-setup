// Tests for accept-gate.mjs: run with `node --test packs/verification/accept-gate/`.
// Each test builds a throwaway git repo and pipes a hook payload into the real script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'accept-gate.mjs');
const PLAN = 'docs/superpowers/plans/export.md';
const SPEC = 'docs/superpowers/specs/export-design.md';
const LEDGER = '.superpowers/sdd/export/progress.md';

const spec = (rows) => `# Export design\n\nSome prose.\n\n## Acceptance checks\nCheck files: test/accept/**, package.json\n${rows.join('\n')}\n\n## Out of scope\n- coupons\n`;
const OPEN2 = [
  '- [ ] AC-1 · CHECK: `node --test test/accept/json.test.mjs` · EXPECT: exit 0 · EVIDENCE:',
  '- [ ] AC-2 · CHECK: `node cli.mjs --bad` · EXPECT: exit 2 · EVIDENCE:',
];
const CLOSED2 = [
  '- [x] AC-1 · CHECK: `node --test test/accept/json.test.mjs` · EXPECT: exit 0 · EVIDENCE: ran, 3/3 pass',
  '- [x] AC-2 · CHECK: `node cli.mjs --bad` · EXPECT: exit 2 · EVIDENCE: exit 2',
];

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function put(root, rel, text) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); }

// A repo with spec + plan + a check file, committed and tagged accept-lock.
function makeRepo({ rows = OPEN2, tag = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'accept-gate-'));
  const state = mkdtempSync(join(tmpdir(), 'accept-gate-state-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't');
  put(root, SPEC, spec(rows));
  put(root, PLAN, `# Export plan\n\n**Spec:** \`${SPEC}\`\n\n### Task 1: json\n### Task 2: csv\n### Task 3: docs\n`);
  put(root, 'test/accept/json.test.mjs', '// check\n');
  put(root, 'package.json', '{"scripts":{"test":"node --test"}}\n');
  put(root, '.gitignore', '.superpowers/\n');
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'spec approved');
  if (tag) git(root, 'tag', 'accept-lock');
  return { root, state };
}
function ledger(r, lines) { put(r.root, LEDGER, [`# SDD ledger — plan: ${PLAN}`, ...lines].join('\n') + '\n'); }
function work(r) { put(r.root, 'src.mjs', 'export const x = 1;\n'); git(r.root, 'add', '-A'); git(r.root, 'commit', '-qm', 'work'); }

function run(r, payload, env = {}) {
  const input = typeof payload === 'string' ? payload
    : JSON.stringify({ session_id: 's1', cwd: r.root, hook_event_name: 'Stop', stop_hook_active: false, ...payload });
  const p = spawnSync('node', [HOOK], { input, encoding: 'utf8', env: { ...process.env, ACCEPT_GATE_STATE: r.state, ...env } });
  let out = null; if (p.stdout.trim()) out = JSON.parse(p.stdout);
  return { code: p.status, out, err: p.stderr };
}
const blocked = (res) => res.out?.decision === 'block';
function cleanup(r) { rmSync(r.root, { recursive: true, force: true }); rmSync(r.state, { recursive: true, force: true }); }

test('inert outside a git repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nogit-'));
  const res = run({ root: dir, state: dir }, {});
  assert.equal(res.code, 0); assert.equal(res.out, null);
  rmSync(dir, { recursive: true, force: true });
});

test('inert with no ledger and no accept-lock tag', () => {
  const r = makeRepo({ tag: false }); work(r);
  const res = run(r, {});
  assert.equal(res.code, 0); assert.equal(res.out, null); cleanup(r);
});

test('blocks Stop when a task is complete and a box is still open', () => {
  const r = makeRepo(); work(r); ledger(r, ['Task 1: complete (commits a..b, review clean)']);
  const res = run(r, {});
  assert.ok(blocked(res)); assert.match(res.out.reason, /AC-1/); assert.match(res.out.reason, /AC-2/); cleanup(r);
});

test('allows Stop when every box is closed and nothing was tampered with', () => {
  const r = makeRepo(); work(r); ledger(r, ['Task 1: complete (x)', 'Task 2: complete (x)']);
  put(r.root, SPEC, spec(CLOSED2));
  const res = run(r, {});
  assert.equal(res.out, null, res.out && res.out.reason); cleanup(r);
});

test('an ABANDON line closes its box', () => {
  const r = makeRepo(); work(r); ledger(r, ['Task 1: complete (x)']);
  put(r.root, SPEC, spec([CLOSED2[0], OPEN2[1], 'ABANDON: AC-2 needs a product decision on exit codes']));
  const res = run(r, {});
  assert.equal(res.out, null, res.out && res.out.reason); cleanup(r);
});

test('does not block before any work: no complete lines, HEAD at the tag, clean tree', () => {
  const r = makeRepo(); ledger(r, []);
  const res = run(r, {});
  assert.equal(res.out, null); cleanup(r);
});

test('tamper: a check file edited after accept-lock blocks', () => {
  const r = makeRepo(); work(r); put(r.root, SPEC, spec(CLOSED2));
  put(r.root, 'test/accept/json.test.mjs', '// check (weakened)\n');
  const res = run(r, {});
  assert.ok(blocked(res)); assert.match(res.out.reason, /test\/accept\/json\.test\.mjs/); cleanup(r);
});

test('tamper: a check file deleted after accept-lock blocks', () => {
  const r = makeRepo(); work(r); put(r.root, SPEC, spec(CLOSED2));
  rmSync(join(r.root, 'test/accept/json.test.mjs'));
  assert.ok(blocked(run(r, {}))); cleanup(r);
});

test('tamper: the test runner config (a listed check file) edited blocks', () => {
  const r = makeRepo(); work(r); put(r.root, SPEC, spec(CLOSED2));
  put(r.root, 'package.json', '{"scripts":{"test":"node --test src"}}\n');
  assert.ok(blocked(run(r, {}))); cleanup(r);
});

test('tamper: changing an EXPECT in the spec blocks; ticking boxes and adding evidence does not', () => {
  const r = makeRepo(); work(r);
  put(r.root, SPEC, spec([CLOSED2[0], CLOSED2[1].replace('EXPECT: exit 2', 'EXPECT: any exit code')]));
  const res = run(r, {});
  assert.ok(blocked(res)); assert.match(res.out.reason, /Acceptance checks section changed/); cleanup(r);
});

test('tamper: accept-lock moved to a new commit blocks', () => {
  const r = makeRepo(); work(r); ledger(r, ['Task 1: complete (x)']);
  run(r, {}); // first sight pins the tag
  put(r.root, SPEC, spec(CLOSED2)); git(r.root, 'commit', '-qam', 'tick');
  git(r.root, 'tag', '-f', 'accept-lock');
  const res = run(r, { session_id: 's2' });
  assert.ok(blocked(res)); assert.match(res.out.reason, /accept-lock moved/); cleanup(r);
});

test('tamper: with no ledger, accept-lock moved onto HEAD (clean tree) still blocks', () => {
  const r = makeRepo({ rows: CLOSED2 }); work(r);
  run(r, {}); // pins the tag
  put(r.root, 'test/accept/json.test.mjs', '// weaker\n'); git(r.root, 'commit', '-qam', 'tweak');
  git(r.root, 'tag', '-f', 'accept-lock');
  const res = run(r, { session_id: 's2' });
  assert.ok(blocked(res)); assert.match(res.out.reason, /accept-lock moved/); cleanup(r);
});

test('tamper: accept-lock deleted after it was pinned blocks', () => {
  const r = makeRepo(); work(r); ledger(r, ['Task 1: complete (x)']);
  run(r, {});
  git(r.root, 'tag', '-d', 'accept-lock');
  const res = run(r, { session_id: 's2' });
  assert.ok(blocked(res)); assert.match(res.out.reason, /accept-lock/); cleanup(r);
});

test('out-of-order ledger completions block at Stop', () => {
  const r = makeRepo(); work(r); put(r.root, SPEC, spec(CLOSED2));
  ledger(r, ['Task 1: complete (x)', 'Task 3: complete (x)']);
  const res = run(r, {});
  assert.ok(blocked(res)); assert.match(res.out.reason, /Task 3/); cleanup(r);
});

test('falls back to the tag when SDD already deleted its workspace', () => {
  const r = makeRepo(); work(r); // no ledger at all, HEAD past the tag
  const res = run(r, {});
  assert.ok(blocked(res)); assert.match(res.out.reason, /AC-1/); cleanup(r);
});

test('releases after 3 blocks in one session', () => {
  const r = makeRepo(); work(r); ledger(r, ['Task 1: complete (x)']);
  assert.ok(blocked(run(r, {})));
  assert.ok(blocked(run(r, { stop_hook_active: true })));
  assert.ok(blocked(run(r, { stop_hook_active: true })));
  const res = run(r, { stop_hook_active: true });
  assert.equal(res.out, null); assert.match(res.err, /released after 3 blocks/); cleanup(r);
});

test('fails open with a stderr note on malformed input', () => {
  const r = makeRepo();
  const res = run(r, 'not json');
  assert.equal(res.code, 0); assert.equal(res.out, null); assert.match(res.err, /accept-gate: failed open/); cleanup(r);
});

test('never executes CHECK lines', () => {
  const r = makeRepo({ rows: ['- [ ] AC-1 · CHECK: `touch PWNED` · EXPECT: exit 0 · EVIDENCE:'] });
  work(r); ledger(r, ['Task 1: complete (x)']);
  run(r, {});
  assert.equal(existsSync(join(r.root, 'PWNED')), false); cleanup(r);
});

test('PreToolUse: Write that adds an out-of-order completion is denied', () => {
  const r = makeRepo(); ledger(r, ['Task 1: complete (x)']);
  const content = readFileSync(join(r.root, LEDGER), 'utf8') + 'Task 3: complete (x)\n';
  const res = run(r, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(r.root, LEDGER), content } });
  assert.equal(res.out?.hookSpecificOutput?.permissionDecision, 'deny'); assert.match(res.out.hookSpecificOutput.permissionDecisionReason, /Task 3/); cleanup(r);
});

test('PreToolUse: Edit that adds the next completion in order is allowed', () => {
  const r = makeRepo(); ledger(r, ['Task 1: complete (x)']);
  const res = run(r, { hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: join(r.root, LEDGER), old_string: 'Task 1: complete (x)', new_string: 'Task 1: complete (x)\nTask 2: complete (y)' } });
  assert.equal(res.out, null); cleanup(r);
});

test('PreToolUse on a file that is not a ledger is ignored', () => {
  const r = makeRepo();
  const res = run(r, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(r.root, 'notes.md'), content: 'Task 9: complete' } });
  assert.equal(res.out, null); cleanup(r);
});

// --- background subagents: Stop fires while the main session waits on them ---
function transcript(r, events) {
  const p = join(r.state, 'transcript.jsonl');
  const lines = [];
  for (const e of events) {
    if (e.launch) {
      lines.push({ type: 'assistant', isSidechain: false, message: { content: [{ type: 'tool_use', id: `tu_${e.launch}`, name: 'Agent', input: { description: 'x' } }] } });
      lines.push({ type: 'user', isSidechain: false, toolUseResult: { isAsync: true, status: 'async_launched', agentId: e.launch },
        message: { content: [{ type: 'tool_result', tool_use_id: `tu_${e.launch}`, content: [{ type: 'text', text: 'Async agent launched successfully.' }] }] } });
    }
    if (e.done) lines.push({ type: 'queue-operation', operation: 'enqueue',
      content: `<task-notification>\n<task-id>${e.done}</task-id>\n<tool-use-id>tu_${e.done}</tool-use-id>\n<status>${e.status || 'completed'}</status>\n</task-notification>` });
    if (e.resume) lines.push({ type: 'assistant', isSidechain: false, message: { content: [{ type: 'tool_use', id: `tu_m_${e.resume}`, name: 'SendMessage', input: { to: e.resume, message: 'fix it' } }] } });
  }
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

test('stays inert while a background agent is still running', () => {
  const r = makeRepo(); work(r); ledger(r, ['Task 1: complete (x)']);
  const res = run(r, { transcript_path: transcript(r, [{ launch: 'agA' }]) });
  assert.equal(res.out, null); cleanup(r);
});

test('blocks once every background agent has reported', () => {
  const r = makeRepo(); work(r); ledger(r, ['Task 1: complete (x)']);
  const res = run(r, { transcript_path: transcript(r, [{ launch: 'agA' }, { done: 'agA' }, { launch: 'agB' }, { done: 'agB', status: 'failed' }]) });
  assert.ok(blocked(res)); cleanup(r);
});

test('a SendMessage continuation counts as running again until it reports', () => {
  const r = makeRepo(); work(r); ledger(r, ['Task 1: complete (x)']);
  const res = run(r, { transcript_path: transcript(r, [{ launch: 'agA' }, { done: 'agA' }, { resume: 'agA' }]) });
  assert.equal(res.out, null); cleanup(r);
});
