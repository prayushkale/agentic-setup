# agentic-setup installer (v1): design

Date: 2026-11-03. Spec source: Phase 6 of the approved project plan, narrowed by the decisions below.

## Intent

`npx agentic-setup` walks a person through a curated coding-agent setup **one item at a time**. For every item they see what it is, why it helps (output quality, speed, or cost), what it costs in startup tokens, its risk, and anything they must do by hand — then they say yes or no. When it finishes, their agent(s) are configured so they get the best output for the least cost, `doctor` passes, and they get a summary.

The audience uses **any** coding agent, not just Claude Code.

## Goals

- A guided, per-item walk-through is the main path (`init`, the default command).
- Works for any agent: skills and the AGENTS.md template reach every agent that `npx skills` supports; hooks, MCP servers and settings are handled by deep adapters for the five v1 agents.
- Exact reversibility: `uninstall` restores the previous state of every file it touched.
- Cost transparency: each item shows its `token_cost`; the summary shows the total against the ~18.2k baseline (measured in an empty dir with the reference setup).
- One manifest (`manifest/items.yaml`) drives the CLI, the plugin marketplace and the item docs.

## Non-goals (v1)

- `export` (snapshot a machine into a profile) — later.
- Adapters for hermes and openclaw — later; their users fall back to `generic` (skills + AGENTS.md).
- iOS domain pack — later, once someone tests it.
- npm publish and repo release — Phase 7, needs the user's explicit approval.

## Anti-goals (a failure even if it works)

- Pushing everything on the user: opt-in packs default to "no"; heavy or niche items never sneak in.
- Clobbering existing config (settings.json, config.toml, AGENTS.md) or leaving it unrestorable.
- Any telemetry, or writing `DO_NOT_TRACK`, `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` into any global config/env (it disables the Claude Code advisor).
- `curl | sh` without showing the URL and sha256 and getting a confirm.
- Bundling third-party content whose `redistribution` is `link-only`, or naming the research source course in any public file.
- Silent failure: if an item can't apply to a chosen agent (e.g. a hook on an agent without hooks), the walk-through says so ("not available for Gemini CLI").

## Decisions made with the user

| Topic | Decision |
|---|---|
| Adapters in v1 | `claude-code`, `command-code`, `codex`, `gemini-cli`, `generic` |
| Package name | `agentic-setup` (unscoped; free on npm as of 2026-11-03) |
| Commands in v1 | `init` (default), `list [--pack]`, `info <id>`, `install <id…>`, `uninstall <id…>`, `doctor`, `update`. No `export`. |
| Flags | `--dry-run`, `--yes`, `--agents a,b`, `--profile <file>` |
| Domain packs in v1 | Cloudflare, Three.js, video (hyperframes / remotion). iOS skipped. |
| Core pack | The reference setup (below). No research "winners" — the trials promoted nothing. |

## Packs and items

**core** (default "yes" in the walk-through): superpowers; rtk + its hook; ccusage status line; context7 MCP; serena helper (`serena-here`); impeccable, frontend-design, ui-ux-pro-max; grill-me, handoff, caveman; find-skills; differential-review, supply-chain-risk-auditor; agent-browser; AGENTS.md template. Paths, install commands and the three local patches (ui-ux-pro-max path, supply-chain-risk-auditor `uv --project`, differential-review adversarial-modeler) come from the reference runbook and become `post_install` steps. Skill sources come from `~/.agents/.skill-lock.json`.

**Opt-in packs** (default "no"), all local `own` content in `packs/`:
- `verification`: accept-gate hook (`risk: med` — open bypass X1: the agent can write the pin file unless an OS sandbox denies writes to it; say this in the confirm), acceptance-checks rule, plan-review skill, skeptic-filter skill.
- `design`: slop-severity rule.
- `core-extras` *(builder may rename)*: grilling-followup.
- `security`: vet-skill (requires NVIDIA SkillSpector; shown as a missing dependency until present).
- `cloudflare`, `threejs`, `video`: upstream skills/MCPs only, nothing bundled. fal and blender MCPs are marked "needs your own key / app".

Every item carries `redistribution`; `link-only` items install from upstream or show as "manual" with a link, never bundled content.

## The walk-through (`init`)

1. Detect agents (binaries on PATH and config dirs). Pre-select the detected ones; user can change the selection or pass `--agents`.
2. Choose packs (core pre-checked; each pack offers "accept all").
3. For each item in each chosen pack: show the card (summary, benefit, `token_cost`, `risk`, needs/manual, which selected agents it applies to) and ask yes/no; `?` opens the full `docs/items/<id>.md`.
4. Review the plan: item list, per-agent actions, total token cost vs baseline.
5. Dry-run diff of every file that would change. Confirm. `risk: high` items need a second confirm with the reason; `med` show the reason.
6. Install, then run `doctor` on what was installed, then print the summary (installed, skipped, total token cost, manual to-dos such as API keys).

`--yes` takes defaults; `--profile` installs a saved selection non-interactively.

## Safety and state

- Back up every touched file before writing (under `~/.agentic-setup/backups/<timestamp>/`).
- `~/.agentic-setup/state.json` records each install: item, agent, files created (with hashes), keys merged into structured config, commands run. `uninstall` reverses exactly that; files changed by the user after install are reported, not overwritten.
- settings.json / JSON configs: deep-merge that is idempotent (installing twice equals installing once) and never removes user keys. TOML (codex) edited with the same guarantee.
- Dry-run writes nothing anywhere, including state and backups.
- Conflicts declared in the manifest (`conflicts:`) block selection with a message.
- Graft, if referenced, is pinned to `@nanonets/graft@0.18.0` with telemetry off; the installer never runs `graft upgrade`.

## Validation

- Manifest schema validation (required fields, enums, known packs, `link-only` never pointing at bundled files).
- Skill format: check `SKILL.md` frontmatter (`name`, `description`); convert flat `.md` "skills" into `<name>/SKILL.md`.

## Marketplace and docs

- `tools/gen-marketplace.mjs` → `.claude-plugin/marketplace.json`, one plugin per pack (Claude Code-compatible items). CI fails if it's stale.
- Generated `docs/items/<id>.md` (what `info` and `?` show). `README.md` (what it is, 1-line install, pack table, safety notes). `docs/WHY.md`: public summary of the research conclusions (baseline matched every candidate; candidates cost more) with no quotes from or names of the source material. Run `tools/scrub.py` over public files before commit.

## Testing

vitest, TDD. Temp-HOME fixture per adapter (codex and gemini-cli are tested only this way; their config formats are confirmed from upstream docs first). Required tests: idempotent merge, uninstall restores exact previous state, dry-run writes nothing, conflict detection, schema validation, SKILL.md check and the flat-.md fix. E2E: install core into a sandbox HOME (`tools/sandbox.sh`), `doctor` passes, report total `token_cost` vs 18.2k. Confirm the real config is untouched with `tools/realhome-guard.sh`. No run touches the real `~/.claude`, `~/.agents`, `~/.codex` or `~/.graft`.

## Constraints

TypeScript, Node ≥ 20, in `installer/`. Libraries: `@clack/prompts`, `yaml`, `execa`, `vitest` (check current APIs with Context7). The user's npm has `omit=dev`: put test tooling in regular deps or use `--include=dev`. `work/` is untrusted; `private/` is never published or bundled.

## AGENTS.md template content (user decision)

The public template keeps the general rules from the reference AGENTS.md:
- clarify requirements, then plan, get approval, then build
- TDD for logic, and verify before claiming done
- a worktree per parallel feature
- YAGNI
- Context7 for library and API questions
- UI work verified visually, and follow DESIGN.md if present
- use the `gh` CLI

The Three.js tooling rule moves into a rule item in the `threejs` pack (installed only with that pack). The same goes for the Cloudflare `cf` CLI rule and the `cloudflare` pack. The `npx skills` install line, the Serena hint and other machine-specific paths stay out.

## Calls made after the builder check (author's calls, not the user's)

1. **Reversibility scope.** Files the installer writes itself (merged config keys, AGENTS.md blocks, local pack files) are restored byte-exact on uninstall. Items installed by another tool (`claude plugin install`, `npm i -g`, `npx skills add`, `uv tool install`, `cmd skills add`) carry an `uninstall:` command in the manifest, which uninstall runs. state.json records what was created and a hash/listing of the paths that tool wrote, taken before and after. The "restores exact previous state" test is strict for installer-written files. For tool-installed items it checks that the before and after snapshots of the affected dirs match in a temp HOME.
2. **Already installed.** Before planning, each item runs a `detect` check per agent. Items that are already there show "already installed — skip", are never adopted into state.json, and are never removed by uninstall.
3. **Skills install through `npx skills add -g -a <agent…>`**: the user's convention, and it reaches any agent that tool supports. Dry-run for these lists the exact commands and target dirs instead of a byte diff, and runs nothing. A real byte diff is shown only for files the installer writes itself.
4. **Rules and the AGENTS.md template** go in as marked blocks (`<!-- agentic-setup:<id> begin/end -->`), appended to each selected agent's global instructions file: `~/.agents/AGENTS.md` for generic and Command Code (via its existing link), `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`. The installer never replaces an existing file; uninstall removes only its own block. `grilling-followup` is a rule block that adds to the grilling skill. It is not a patch to the upstream SKILL.md.
5. **`update`** updates installed upstream items (`npx skills update`, plugin update, `npm i -g <pinned>`, then reapplies `post_install` patches) and re-records hashes in state.json. Pinned items stay pinned. The CLI itself updates through `npx agentic-setup@latest`.
6. **Marketplace.** One plugin per pack that has bundled `own` content (verification, design, security, core-extras). Packs that are entirely upstream get no plugin. The README points to `npx agentic-setup` for those. Nothing `link-only` goes into a plugin.
7. **Profiles.** At the end, `init` saves the selection to `~/.agentic-setup/profile.yaml` (agents plus item ids). `--profile` reads that format, validated like the manifest.
8. **Token cost.** The summary shows "≈ +N tokens at startup" as the sum of the selected items' `token_cost`. The 18.2k figure is a reference point for the full reference setup in Claude Code. The E2E measures real startup tokens in the sandbox (`tools/startup-tokens.sh`) and reports them next to the sum. It is report-only, never pass/fail.

## Left to the builder

Module layout; the TypeScript build setup; exact card layout in the terminal; how `token_cost` is estimated for items not measured (e.g. SKILL.md description length ÷ 4); the state.json schema; how `update` treats local patches (it must reapply `post_install` after updating).
