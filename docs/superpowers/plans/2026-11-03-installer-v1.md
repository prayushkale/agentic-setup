# agentic-setup installer v1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx agentic-setup` walks a user through a curated agent setup item by item and installs the chosen items into Claude Code, Command Code, Codex, Gemini CLI and/or any `npx skills`-supported agent, reversibly.

**Architecture:** `manifest/items.yaml` is the single source of truth. Each agent adapter is a **pure** module that turns `(item, env)` into a list of `Action`s (json-merge, marked block, file copy, command run). A single executor applies actions through a `Ctx` that does backups, dry-run and state recording, so uninstall can replay the recorded state in reverse. The TUI (`@clack/prompts`) only builds a selection. Everything else is testable without a terminal.

**Tech Stack:** TypeScript, Node ≥ 20, ESM, `@clack/prompts`, `yaml`, `execa`, `vitest`, `typescript` (all in `dependencies` or installed with `--include=dev`, because the user's npm has `omit=dev`).

**Spec:** `docs/superpowers/specs/2026-11-03-installer-design.md` (read it first; this plan does not repeat its rationale).

## Global Constraints

- Package name `agentic-setup`, bin `agentic-setup`, lives in `installer/`. Node `>=20`.
- Adapters: `claude-code`, `command-code`, `codex`, `gemini-cli`, `generic`. No hermes/openclaw adapters.
- Commands: `init` (default), `list [--pack]`, `info <id>`, `install <id…>`, `uninstall <id…>`, `doctor`, `update`. Flags: `--dry-run`, `--yes`, `--agents a,b`, `--profile <file>`. No `export`.
- Packs: `core` (default yes), `verification`, `design`, `core-extras`, `security`, `cloudflare`, `threejs`, `video` (default no). No iOS.
- State: `~/.agentic-setup/state.json`. Backups: `~/.agentic-setup/backups/<ISO timestamp>/`. Profile: `~/.agentic-setup/profile.yaml`.
- Never write `DO_NOT_TRACK`, `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` into any config or env, and no telemetry. A manifest test enforces this.
- Graft, if referenced, is pinned to `@nanonets/graft@0.18.0` and never `graft upgrade`.
- Never run `curl … | sh`. `source.type: curl-script` items show URL plus sha256 and need a confirm.
- `risk: high` needs a second confirm with `risk_reason`; `risk: med` shows `risk_reason`.
- `redistribution: link-only` items never point at bundled files.
- Public files (README, docs/, manifest/, .claude-plugin/, installer package) must not name the source course: run `python3 -I tools/scrub.py <paths>` before every commit that touches them. `private/` and `work/` are never read by the installer or bundled. Execute nothing under `work/`.
- Tests and e2e run only in temp HOMEs or `tools/sandbox.sh` sandboxes, never against the real `~/.claude`, `~/.agents`, `~/.codex`, `~/.gemini`, `~/.commandcode` or `~/.graft`. Before the first test run, `tools/realhome-guard.sh snapshot` runs, and `check` runs at the end.
- Python runs with `python3 -I`.

## Review Focus

1. **A user's existing config with comments, odd formatting or keys the installer also sets:** e.g. a settings.json that already has a `PreToolUse` hook array, or a CLAUDE.md with no trailing newline. Merge must append rather than replace, and uninstall must give back the original bytes. Test in Task 2: `uninstall restores original bytes when target had no trailing newline and pre-existing hooks`.
2. **The user edits a file after install:** uninstall must not destroy their edit. It reports "changed since install" and leaves the file alone unless its own block or keys can be removed cleanly. Test in Task 2: `uninstall removes only own block when user edited outside it`.
3. **The installer crashes or a command fails mid-install:** already-applied actions must be recorded so uninstall still works. Test in Task 7: `state records applied actions before a failing run action`.
4. **A HOME where the agent config dir doesn't exist:** e.g. `~/.gemini` is missing but the user picked gemini-cli. The dirs get created and uninstall removes only the dirs it created. Test in Task 2: `uninstall removes dirs it created and nothing else`.
5. **Running the same install twice, or installing over items already set up by hand:** nothing is duplicated, and second-run items are not recorded as owned. Test in Task 7: `second install records nothing and reports already installed`.

---

### Task 1: Scaffold, manifest types and schema validation

**Files:**
- Create: `installer/package.json`, `installer/tsconfig.json`, `installer/vitest.config.ts`
- Create: `installer/src/manifest/types.ts`, `installer/src/manifest/validate.ts`, `installer/src/manifest/load.ts`
- Test: `installer/test/manifest.test.ts`, fixtures in `installer/test/fixtures/manifest/`

**Interfaces:**
- Produces (`types.ts`):
  - `AgentId = 'claude-code'|'command-code'|'codex'|'gemini-cli'|'generic'`
  - `PackId` (string union of the eight packs)
  - `Kind = 'skill'|'hook'|'command'|'agent'|'mcp'|'plugin'|'cli-tool'|'rule'|'settings'`
  - `HookSpec { event: string; matcher?: string; command: string }`
  - `McpSpec { name: string; transport: 'http'|'stdio'; url?: string; command?: string; args?: string[]; env_keys?: string[] }`
  - `InstallSpec`:
    - `skills?: { repo: string; names: string[] }`
    - `local_skills?: string[]`: repo-relative dirs containing SKILL.md
    - `rule?: string`: repo-relative .md file
    - `hooks?: Partial<Record<AgentId, HookSpec>>`
    - `mcp?: McpSpec`
    - `settings?: Record<string, unknown>`: claude-code settings.json only
    - `plugin?: { marketplace: string; name: string }`
    - `commands?: string[]`: cli-tool installs
    - `files?: { from: string; to: string; mode?: number }[]`: `to` starts with `~/`
  - `Item`:
    - basics: `id, name, pack, summary`
    - `benefit: ('quality'|'speed'|'cost')[]`
    - `details: string` (path `docs/items/<id>.md`), `kinds: Kind[]`, `agents: AgentId[]`
    - `source: { type: 'npx-skills'|'git'|'npm'|'brew'|'plugin-marketplace'|'local'|'curl-script'; ref: string; sha256?: string }`
    - `redistribution: 'own'|'upstream-public'|'link-only'`
    - `requires?: string[]`, `conflicts?: string[]`
    - `risk: 'low'|'med'|'high'`, `risk_reason?: string`
    - `token_cost: number`, `manual?: string`, `needs_key?: string`
    - `install: InstallSpec`, `uninstall?: string[]`, `update?: string[]`, `post_install?: string[]`
    - `detect?: string`, `verify: string`
  - `Pack { id: PackId; title: string; default: boolean; summary: string }`
  - `Manifest { packs: Pack[]; items: Item[] }`
- Produces (`validate.ts`): `validateManifest(m: unknown, repoRoot: string): { ok: boolean; errors: string[] }`
- Produces (`load.ts`): `loadManifest(dir: string): Manifest`. It reads `items.yaml` and `packs.yaml` from `dir` and throws with all errors when validation fails.

- [ ] **Step 1: Create the worktree and scaffold.** Use superpowers:using-git-worktrees (branch `feat/installer-v1`). In `installer/` run `npm init`, then `npm i --include=dev @clack/prompts yaml execa vitest typescript @types/node`. Set `"type":"module"`, `"bin":{"agentic-setup":"dist/cli.js"}`, `"engines":{"node":">=20"}`, and scripts `build: tsc`, `test: vitest run`. Look up the current APIs of @clack/prompts, yaml, execa and vitest with Context7 and note them at the top of the PR description.
- [ ] **Step 2: Write failing tests** in `manifest.test.ts`:
  - `accepts a minimal valid item`
  - `rejects missing redistribution` (the error mentions `redistribution`)
  - `rejects unknown pack, agent, kind or risk`
  - `rejects risk high/med without risk_reason`
  - `rejects duplicate ids and conflicts pointing at unknown ids`
  - `rejects link-only item whose install references a repo path` (local_skills/rule/files)
  - `rejects curl-script source without sha256`
  - `rejects any install text containing DO_NOT_TRACK, DISABLE_TELEMETRY or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
  - `rejects referenced repo paths that do not exist`
  - `rejects paths under private/ or work/`
- [ ] **Step 3: Run** `cd installer && npx vitest run test/manifest.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `types.ts`, `validate.ts` (hand-written checks, no schema library) and `load.ts`.
- [ ] **Step 5: Run the tests.** Expected: PASS. Commit `feat(installer): manifest types and validation`.

### Task 2: File layer: Ctx, JSON deep-merge, marked blocks, backups, state

**Files:**
- Create: `installer/src/fs/ctx.ts`, `installer/src/fs/json-merge.ts`, `installer/src/fs/blocks.ts`, `installer/src/state/state.ts`
- Test: `installer/test/json-merge.test.ts`, `installer/test/blocks.test.ts`, `installer/test/ctx.test.ts` (temp HOME via `fs.mkdtemp`)

**Interfaces:**
- Produces:
  - `mergeJson(target: unknown, patch: unknown): { result: unknown; added: JsonPath[] }`. Objects merge recursively. Arrays get the patch elements appended when not already deep-equal-present. Scalars that are already set by the user are **not** overwritten and are reported as a conflict.
  - `unmergeJson(current: unknown, added: JsonPath[]): unknown` removes exactly the added paths and array elements, then prunes objects or arrays that became empty **only if** they were created by the add.
  - `JsonPath = { path: (string|number)[]; value: unknown; createdContainer: boolean }`
  - `addBlock(text: string, id: string, body: string, style: 'md'|'toml'): string`. Markers: `<!-- agentic-setup:<id> begin -->` / `<!-- agentic-setup:<id> end -->` for md, `# agentic-setup:<id> begin` / `# agentic-setup:<id> end` for toml. It replaces an existing block with the same id (idempotent) and separates from the previous text with exactly one blank line.
  - `removeBlock(text: string, id: string, style): string`. It restores the exact pre-add bytes when nothing else changed, recording the separator it added.
  - `Ctx`:
    - fields: `home: string; dryRun: boolean; repoRoot: string; planned: PlannedChange[]`
    - `readText(p)`, `writeText(p, s)` (backs up the original once per run, creates parent dirs and records the ones created, no-op in dry-run except for appending to `planned`), `exists(p)`, `copy(from, to, mode?)`, `remove(p)`
  - `PlannedChange = { file: string; before: string|null; after: string|null }`
  - `State`:
    - shape: `{ version: 1; items: Record<string, InstalledItem> }`
    - `InstalledItem = { id; agents: AgentId[]; installedAt; actions: AppliedAction[] }`
    - `AppliedAction`: the `Action` from Task 5 plus `undoData` (added JsonPaths, original file hash, created dirs, snapshot before/after)
  - `loadState(home): State` and `saveState(home, s, dryRun)`. Writes are atomic (temp file + rename).

- [ ] **Step 1: Write failing tests:**
  - `mergeJson is idempotent: merge(merge(a,p),p) deep-equals merge(a,p)` (for settings.json with existing `hooks.PreToolUse`)
  - `mergeJson keeps user scalar and reports conflict`
  - `unmergeJson(mergeJson(a,p)) deep-equals a`
  - `addBlock twice yields one block`
  - `removeBlock(addBlock(t)) === t` for: an empty file, a file with no trailing newline, and a file with an existing block of another id
  - `uninstall removes only own block when user edited outside it`
  - `uninstall restores original bytes when target had no trailing newline and pre-existing hooks` (round trip through Ctx writing a real temp file)
  - `uninstall removes dirs it created and nothing else`
  - `dry-run writes nothing`: snapshot every file under a temp HOME (path + sha256) before and after a series of ctx writes with `dryRun: true`, assert they're equal and `planned` is non-empty
  - `state save is atomic and round-trips`
- [ ] **Step 2: Run** `npx vitest run test/json-merge.test.ts test/blocks.test.ts test/ctx.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four modules.
- [ ] **Step 4: Run the tests.** Expected: PASS. Commit `feat(installer): reversible file layer`.

### Task 3: Skill format check and flat-.md fix

**Files:**
- Create: `installer/src/skills/format.ts`
- Test: `installer/test/skill-format.test.ts`

**Interfaces:**
- Produces:
  - `checkSkill(dir: string): { ok: boolean; errors: string[] }`. Needs `SKILL.md` with YAML frontmatter containing a non-empty `name` that equals the dir name and a non-empty `description` (≤ 1024 chars).
  - `fixFlatSkill(mdPath: string, outDir: string): string` turns `foo.md` into `outDir/foo/SKILL.md`. It adds frontmatter (`name: foo`, `description:` from the first paragraph) when it's missing and returns the new dir.

- [ ] **Step 1: Write failing tests:**
  - `accepts valid skill`
  - `rejects missing frontmatter / name mismatch / empty description`
  - `fixFlatSkill creates name/SKILL.md with derived frontmatter and checkSkill passes on it`
  - `every packs/**/SKILL.md in the repo passes checkSkill` (walks `../packs`)
- [ ] **Step 2: Run the tests.** Expected: FAIL. **Step 3: Implement** using `yaml` for frontmatter. **Step 4: Run them again.** Expected: PASS. Commit.

### Task 4: Command runner and agent detection

**Files:**
- Create: `installer/src/run/runner.ts`, `installer/src/detect.ts`
- Test: `installer/test/runner.test.ts`, `installer/test/detect.test.ts`

**Interfaces:**
- Produces:
  - `Runner`:
    - `run(cmd: string, opts?: { allowFail?: boolean }): Promise<{ code: number; stdout: string; stderr: string }>`
    - Runs through execa with `shell: true` and `env: { ...process.env, HOME: ctx.home, NPM_CONFIG_PREFIX: ctx.npmPrefix }`. In dry-run it records the command and returns `{code: 0}`.
  - `makeRunner(ctx: Ctx): Runner`
  - `FakeRunner` (test helper, exported from `test/helpers.ts`) records commands and returns scripted results.
  - `Env = { home: string; path: string; platform: NodeJS.Platform }`
  - `detectAgents(env: Env): Promise<AgentId[]>`:
    - `claude-code`: `claude` binary or `~/.claude`
    - `command-code`: `cmd` binary or `~/.commandcode`
    - `codex`: `codex` binary or `~/.codex`
    - `gemini-cli`: `gemini` binary or `~/.gemini`
    - `generic`: always detected
  - `hasBinary(name, env): boolean`
- Note: `ctx.npmPrefix` defaults to npm's own prefix. The e2e sets it inside the sandbox so `npm i -g` never writes to the real machine. Add `npmPrefix?: string` to `Ctx`.

- [ ] **Step 1: Write failing tests:**
  - `dry-run runner executes nothing` (command `touch <tmp>/x`, file absent afterwards)
  - `runner passes HOME and NPM_CONFIG_PREFIX`
  - `detects agents from config dirs in temp HOME with empty PATH`
  - `generic always detected`
- [ ] **Step 2: Run the tests** (expected FAIL), **implement** them, **run** again (expected PASS), then commit.

### Task 5: Adapter interface, claude-code and generic adapters

**Files:**
- Create: `installer/src/adapters/types.ts`, `installer/src/adapters/claude-code.ts`, `installer/src/adapters/generic.ts`, `installer/src/adapters/index.ts`
- Test: `installer/test/adapters/claude-code.test.ts`, `installer/test/adapters/generic.test.ts`

**Interfaces:**
- Produces:
  - `Action`:
    - `{ kind: 'json-merge'; file: string; patch: object }`
    - `{ kind: 'block'; file: string; id: string; body: string; style: 'md'|'toml' }`
    - `{ kind: 'copy'; from: string; to: string; mode?: number }`
    - `{ kind: 'run'; cmd: string; undo?: string; snapshot?: string[] }`
    - Paths are absolute and resolved against `env.home` and the repo root.
  - `Adapter`:
    - `id: AgentId`
    - `supports(field: keyof InstallSpec): boolean`
    - `instructionsFile(env: Env): string`
    - `actions(item: Item, env: Env, repoRoot: string): Action[]`, which is **pure**
  - `adapters: Record<AgentId, Adapter>`
  - `skillActions(item: Item, agents: AgentId[]): Action[]`, shared and engine-called once per item (not per adapter):
    - install: `npx -y skills add <repo> -g -y -s <names…> -a <agent flags…>`
    - undo: `npx -y skills remove -g -y <names…>`
    - snapshot: `~/.agents/skills/<name>` plus each agent's skills dir
    - **Confirm the agent flag names** (`claude-code`, `codex`, `gemini-cli`, and whatever Command Code is called, if anything) with `npx -y skills add --help` and Context7 before writing the mapping. If Command Code isn't a target, it is served by `~/.agents/skills` (which it reads directly), so pass no flag for it.
- claude-code mapping:
  - `hooks['claude-code']` → `json-merge` of `~/.claude/settings.json`: `{hooks:{[event]:[{matcher, hooks:[{type:'command', command}]}]}}`
  - `settings` → `json-merge` of `~/.claude/settings.json`
  - `mcp` → `run`: `claude mcp add --scope user --transport http <name> <url>` (for stdio, `claude mcp add --scope user <name> -- <command> <args…>`); undo: `claude mcp remove <name> -s user`
  - `plugin` → `run`: `claude plugin marketplace add <marketplace>` then `claude plugin install <name>`; undo: `claude plugin uninstall <name>`
  - `rule` → `block` in `~/.claude/CLAUDE.md`
  - `local_skills` → `copy` into `~/.claude/skills/<name>/`
  - `files` → `copy`
- generic mapping: `rule` → `block` in `~/.agents/AGENTS.md`; `local_skills` → `copy` into `~/.agents/skills/<name>/`; `files` → `copy`. It has no hooks, MCP or plugin, so `supports` returns false for those.

- [ ] **Step 1: Write failing tests** (pure: assert on returned `Action[]`, temp HOME paths):
  - `claude-code maps rtk hook to settings.json merge`
  - `claude-code maps context7 http mcp to claude mcp add with undo`
  - `claude-code maps statusLine settings`
  - `claude-code maps rule to CLAUDE.md block`
  - `generic does not support hooks/mcp`
  - `skillActions builds one npx skills command with agent flags and undo`
  - `applying claude-code actions twice through Ctx leaves settings.json identical` (integration with Task 2 Ctx and a FakeRunner)
- [ ] **Step 2: Run the tests** (expected FAIL), **implement** them, **run** again (expected PASS), then commit.

### Task 6: command-code, codex and gemini-cli adapters

**Files:**
- Create: `installer/src/adapters/command-code.ts`, `installer/src/adapters/codex.ts`, `installer/src/adapters/gemini-cli.ts`
- Test: `installer/test/adapters/{command-code,codex,gemini-cli}.test.ts`

**Interfaces:**
- Consumes: `Adapter`, `Action` (Task 5).
- Mappings. Confirm every path and format from upstream docs (Context7, then web) **before** writing code, and cite the URLs in a comment at the top of each file:
  - command-code:
    - `mcp` → `run`: `cmd mcp add --transport http --scope user <name> <url>`; undo: `cmd mcp remove <name> -s user`
    - `rule` → `block` in `~/.agents/AGENTS.md` (Command Code reads it via `~/.commandcode/AGENTS.md`). If that link doesn't exist in the target HOME, write the block to `~/.commandcode/AGENTS.md`.
    - `hooks`: Command Code uses TS mods (`~/.commandcode/mods/*.ts`), so v1 returns no hook support and the walk-through says "not available".
  - codex:
    - `mcp` → `block` (style `toml`) in `~/.codex/config.toml` with a `[mcp_servers.<name>]` table (use `url =` for http, `command`/`args` for stdio, whichever upstream documents)
    - `rule` → `block` in `~/.codex/AGENTS.md`
    - `hooks['codex']` → `json-merge` into `~/.codex/hooks.json` in the format upstream documents
    - **Before adding a toml block, if `config.toml` already defines `[mcp_servers.<name>]` outside our block, emit no action and report "already installed".**
  - gemini-cli:
    - `mcp` → `json-merge` into `~/.gemini/settings.json` `mcpServers.<name>` (field names per upstream, e.g. `httpUrl` vs `url`)
    - `rule` → `block` in `~/.gemini/GEMINI.md`
    - `hooks['gemini-cli']` → `json-merge` only if upstream documents settings.json hooks; otherwise no support

- [ ] **Step 1: Research.** Record the confirmed formats (with source URLs) in `installer/src/adapters/FORMATS.md`.
- [ ] **Step 2: Write failing tests**, one per mapping above, plus:
  - `codex skips mcp already defined outside our block`
  - `codex config.toml round-trip: apply then undo restores bytes`
  - `gemini settings.json round-trip restores bytes`
  - `command-code falls back to ~/.commandcode/AGENTS.md when ~/.agents link absent`
- [ ] **Step 3: Run the tests** (expected FAIL), **implement** them, **run** again (expected PASS), then commit.

### Task 7: Engine: plan, apply, uninstall, doctor, update

**Files:**
- Create: `installer/src/engine/plan.ts`, `installer/src/engine/apply.ts`, `installer/src/engine/uninstall.ts`, `installer/src/engine/doctor.ts`, `installer/src/engine/update.ts`, `installer/src/engine/snapshot.ts`
- Test: `installer/test/engine.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - `PlanEntry`:
    - item and status: `item: Item; status: 'install'|'already'|'skip-conflict'|'unsupported'`
    - `perAgent: { agent: AgentId; actions: Action[]; unsupported: (keyof InstallSpec)[] }[]`
    - shared actions: `shared: Action[]` (skills, `commands`, `post_install`)
    - `reason?: string`
  - `buildPlan(m: Manifest, ids: string[], agents: AgentId[], env: Env, runner: Runner, state: State): Promise<PlanEntry[]>`:
    - expands `requires` that are item ids
    - marks `conflicts` against selected or installed items as `skip-conflict`
    - runs `detect` (exit 0 → `already`)
    - `unsupported` lists the fields that a chosen agent can't take, used for the "not available for X" text
  - `snapshotPaths(paths: string[]): Record<string, string>` hashes the relative path → sha256 of every file under each path
  - `applyPlan(plan, ctx, runner): Promise<{ installed: string[]; failed: { id: string; error: string }[] }>`:
    - runs shared actions first, then per-agent actions
    - saves state after **each** action
    - on a failed action, stops that item, keeps the recorded actions and continues with the next item
  - `uninstall(ids: string[], ctx, runner): Promise<{ removed: string[]; userChanged: string[] }>` reverses the actions in reverse order:
    - json-merge → `unmergeJson`
    - block → `removeBlock`
    - copy → delete if the hash is unchanged, otherwise report as user-changed
    - run → `undo`, then compare the snapshot
    - finally removes created dirs that are empty
  - `doctor(ctx, runner, m): Promise<{ id: string; ok: boolean; detail: string }[]>` runs `verify` for every installed item, plus `requires` binaries via `hasBinary`
  - `update(ids|undefined, ctx, runner, m)` runs `item.update` (default for `skills`: `npx -y skills update -g -y <names>`), re-runs `post_install`, then re-records hashes and snapshots

- [ ] **Step 1: Write failing tests** (temp HOME, FakeRunner):
  - `conflict detection marks second of two conflicting items skip-conflict`
  - `already-installed item via detect is not applied or recorded`
  - `second install records nothing and reports already installed`
  - `uninstall restores the exact previous state`: hash the whole temp HOME before install, run install of a fixture manifest with json-merge, block, copy and run items, uninstall all, then hash again and assert equal (with run actions, the FakeRunner simulates creating and removing files)
  - `state records applied actions before a failing run action`
  - `dry-run apply writes nothing and runs nothing` (HOME hash equal, FakeRunner saw zero real executions, `ctx.planned` non-empty)
  - `uninstall reports user-changed copy and leaves it`
  - `doctor reports failing verify and missing required binary`
  - `update reapplies post_install`
- [ ] **Step 2: Run the tests** (expected FAIL), **implement** them, **run** again (expected PASS), then commit.

### Task 8: CLI, walk-through, profile, list and info

**Files:**
- Create: `installer/src/cli.ts`, `installer/src/ui/walkthrough.ts`, `installer/src/ui/card.ts`, `installer/src/profile.ts`
- Test: `installer/test/cli.test.ts`, `installer/test/card.test.ts`, `installer/test/profile.test.ts`

**Interfaces:**
- Produces:
  - `parseArgs(argv: string[]): { cmd: 'init'|'list'|'info'|'install'|'uninstall'|'doctor'|'update'; ids: string[]; dryRun; yes; agents?: AgentId[]; profile?: string; pack?: PackId }` (use `node:util` `parseArgs`)
  - `renderCard(item: Item, agents: AgentId[], adapters): string`. It shows:
    - name and summary
    - the benefit tags
    - `≈ +<token_cost> tokens at startup`
    - risk, plus `risk_reason` when the risk isn't low
    - `needs_key` and `manual`
    - "not available for <agent>" for each unsupported field
    - for `source.type: curl-script`, the script URL and sha256. Installing it needs an explicit confirm even with `--yes` (test: `curl-script item needs confirm under --yes`).
  - `Profile = { agents: AgentId[]; items: string[] }`, with `saveProfile(home, p)` and `loadProfile(path): Profile` (validated against the manifest ids)
  - `runWalkthrough(m, env, ctx, runner): Promise<Profile | null>`. It follows the spec's six init steps with @clack/prompts:
    - agents multiselect, pre-selected from `detectAgents`
    - packs multiselect, pre-checked from `pack.default`
    - each pack offers "accept all"
    - per item a confirm with initial value `pack.default`; the `?` choice prints `details`
    - plan review with the total `≈ +N tokens`
    - the dry-run diff (from `ctx.planned` plus the run commands)
    - confirm, with a second confirm for high risk
    - install, then doctor, then a summary with manual to-dos
    - Ctrl-C at any point → `null` and nothing written
  - `main(argv)`:
    - `install`, `uninstall`, `update` and `doctor` use `--agents` or the detected agents
    - `--yes` takes defaults (core only, unless `--profile` is given)
    - `--profile` skips the prompts
- The package must bundle `manifest/`, `docs/items/`, own `packs/` and `templates/`, never `private/` or `work/`. Add `tools/bundle-assets.mjs` (called from `prepack`) that copies them into `installer/assets/`, and resolve `repoRoot` to `assets/` at runtime.

- [ ] **Step 1: Write failing tests:**
  - `parseArgs defaults to init`
  - `parseArgs reads --agents list`
  - `renderCard shows token cost, risk_reason for med, and not-available line`
  - `profile round-trip and rejects unknown ids`
  - `main install --dry-run --yes --agents claude-code writes nothing` (temp HOME hash)
  - `npm pack --dry-run lists no private/ or work/ paths`
- [ ] **Step 2: Run the tests** (expected FAIL), **implement** them, **run** again (expected PASS).
- [ ] **Step 3: Manual check.** Run `node dist/cli.js --dry-run` in a temp HOME and walk two items. The cards must be readable at 80 columns. Commit.

### Task 9: Manifest content and pack files

**Files:**
- Create: `manifest/items.yaml`, `manifest/packs.yaml`, `templates/AGENTS.md`, `packs/cloudflare/cf-cli-rule.md`, `packs/threejs/tooling-rule.md`, `packs/core/serena-here` (copied from the user's `~/.local/bin/serena-here`, read only)
- Modify: `tools/scrub.py` (accept file and dir args; when given none, keep scrubbing `catalog/cards`)
- Test: `installer/test/manifest-real.test.ts` runs `loadManifest('../manifest')`, checks there are zero errors, and checks that every own `packs/` skill passes `checkSkill`

**Content.** One item per row. Sources come from `~/.agents/.skill-lock.json` and `~/.agents/SETUP.md`. Every item carries `redistribution`.
- **core:**

  | id | install | notes |
  |---|---|---|
  | superpowers | plugin `obra/superpowers-marketplace` / `superpowers@superpowers-marketplace` | the other agents get `skills: obra/superpowers` |
  | rtk | `commands: [brew install rtk]` | `detect: command -v rtk`; hook `PreToolUse/Bash: rtk hook claude` for claude-code; no hook for the others, so "not available" |
  | ccusage-statusline | `commands: [npm i -g ccusage]` | claude-code `settings.statusLine = {type: command, command: "ccusage statusline -B emoji", padding: 0}` |
  | context7 | mcp http `https://mcp.context7.com/mcp` | |
  | serena | `commands: [uv tool install serena-agent]` | files: `packs/core/serena-here` → `~/.local/bin/serena-here` (mode 0o755) |
  | impeccable | skills `pbakaus/impeccable` | |
  | frontend-design | skills `anthropics/skills` | |
  | ui-ux-pro-max | skills `nextlevelbuilder/ui-ux-pro-max-skill` | post_install: the SETUP.md path sed |
  | grill-me, handoff | skills `mattpocock/skills` | |
  | caveman | skills `JuliusBrussee/caveman` | |
  | find-skills | skills `vercel-labs/skills` | |
  | differential-review | skills `trailofbits/skills` | post_install: the adversarial-modeler copy + text change from SETUP.md |
  | supply-chain-risk-auditor | skills `trailofbits/skills` | post_install: the `uv --project` rewrite |
  | agent-browser | skills `vercel-labs/agent-browser` | plus `commands` per its upstream README |
  | agents-md | rule `templates/AGENTS.md` | the content the spec fixed |

- **verification:**
  - accept-gate: hook, local, `risk: med`, `risk_reason`: "Open bypass: the agent can rewrite the pin file unless an OS sandbox denies writes to it."
  - acceptance-checks: rule
  - plan-review, skeptic-filter: local_skills
- **design:** slop-severity (rule).
- **core-extras:** grilling-followup (rule; requires `grill-me`).
- **security:** vet-skill (local_skills, `requires: [skillspector]`, `manual`: install NVIDIA SkillSpector).
- **cloudflare:** skills from the upstream repo the user's skills came from (find it with `npx skills` / `find-skills`), cf-cli-rule.
- **threejs:** `CloudAI-X/threejs-skills`, `majidmanzarpour/threejs-game-skills`, tooling-rule. fal and blender MCP items have `needs_key` / `manual` set.
- **video:** `heygen-com/hyperframes`, `remotion-dev/skills`.
- `token_cost` per skill = `ceil((len(name)+len(description))/4)+10` from the upstream SKILL.md frontmatter. For MCPs, use the measured value if one is known, otherwise 300. Flag every estimate with `# est` in the YAML.
- No item writes telemetry env vars. If Graft appears at all, it is `npm i -g @nanonets/graft@0.18.0` and `graft telemetry disable` in post_install.

- [ ] **Step 1: Write the failing test** `manifest-real.test.ts`. **Step 2: Write** the YAML, the template and the rule files. **Step 3: Run** `npx vitest run test/manifest-real.test.ts`. Expected: PASS.
- [ ] **Step 4: Run** `python3 -I tools/scrub.py manifest templates packs` with 0 hits. Commit.

### Task 10: Docs, marketplace generator and CI

**Files:**
- Create: `tools/gen-item-docs.mjs` → `docs/items/<id>.md` (manifest fields + the public card from `catalog/cards/` when one matches), `tools/gen-marketplace.mjs` → `.claude-plugin/marketplace.json`, `.github/workflows/ci.yml`, `README.md`, `docs/WHY.md`
- Test: `installer/test/generators.test.ts`

**Interfaces:**
- `gen-marketplace.mjs [--check]`:
  - one plugin per pack that has `own` items with Claude Code-compatible kinds (skill/rule/hook)
  - plugin source `./packs/<pack>`, with the plugin manifest shape per the current Claude Code plugin docs (check with Context7)
  - `--check` exits 1 when the file on disk differs
- `gen-item-docs.mjs [--check]`: same contract.
- CI: Node 20, `cd installer && npm ci --include=dev && npx tsc --noEmit && npx vitest run`, then `node tools/gen-marketplace.mjs --check && node tools/gen-item-docs.mjs --check`.

- [ ] **Step 1: Write failing tests:**
  - `marketplace has one plugin per own pack and none for cloudflare/threejs/video`
  - `marketplace contains no link-only item paths`
  - `--check fails on stale file`
- [ ] **Step 2: Run the tests** (expected FAIL), **implement** them, **run** again (expected PASS).
- [ ] **Step 3: Write README.md and WHY.md.**
  - README: what it is, `npx agentic-setup`, a pack table generated from packs.yaml, safety notes (backups, state, uninstall, no telemetry, dry-run).
  - WHY.md: public conclusions only. The reference baseline matched every trialled candidate on quality, and each candidate cost more tokens. No quotes from or names of the research source.
- [ ] **Step 4: Run** `python3 -I tools/scrub.py README.md docs .claude-plugin manifest` with 0 hits. Commit.

### Task 11: End-to-end smoke in a sandbox HOME

**Files:**
- Modify: `tools/sandbox.sh` (add `new <name> --empty`: a home with only the Keychains link, no baseline copy)
- Create: `tools/e2e-core.sh`

- [ ] **Step 1:** `tools/realhome-guard.sh snapshot sandbox/guard-before.tsv`.
- [ ] **Step 2:** `tools/e2e-core.sh`:
  - creates `sandbox.sh new e2e --empty` and sets `NPM_CONFIG_PREFIX=<sandbox>/home/.npm-global` (added to PATH)
  - builds the installer
  - runs `node installer/dist/cli.js install --yes --agents claude-code,generic --profile <core-profile>` via `sandbox.sh run e2e`
  - then runs `doctor`, then `tools/startup-tokens.sh e2e`
  - prints the sum of core `token_cost`, the measured startup tokens and the 18.2k reference
  - Expected: `doctor` all ok (items with `manual` show as manual, not failed).
- [ ] **Step 3:** run `uninstall` for all items in the sandbox, then check that `~/.agentic-setup/state.json` has no items and the sandbox's `.claude/settings.json` equals its pre-install bytes (or is absent).
- [ ] **Step 4:** `tools/realhome-guard.sh check sandbox/guard-before.tsv` exits 0. Record the numbers in the PR description. Commit.

### Task 12: Review, PR and handoff

- [ ] **Step 1:** Run `/code-review` on the branch and fix the findings (TDD for any bug fix).
- [ ] **Step 2:** Full test run plus generators `--check`, then scrub over all public paths.
- [ ] **Step 3:** Push `feat/installer-v1` to `prayushkale/agentic-setup` and open a PR with `gh pr create`. The body has the API notes, e2e numbers and known gaps (X1 bypass, vet-skill needs SkillSpector, hermes/openclaw/iOS/export deferred).
- [ ] **Step 4:** Update the "Phase 6 state" block in `~/.claude/plans/agentic-setup-handoff.md`, then stop and show the user. **No npm publish** (Phase 7 needs explicit approval).
