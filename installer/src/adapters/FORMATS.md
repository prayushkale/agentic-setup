# Adapter formats (verified 2026-11-03)

## `npx -y skills add` agent flags
Source: `npx -y skills add --help` and the package's docs/agents.md. `-a, --agent <agents>` (repeat the flag,
as in the user's convention); `-s, --skill`; `-g` global; `-y` no prompts. `skills remove -g -y <names>`.

| AgentId | skills `-a` flag | Global skills dir |
|---|---|---|
| claude-code | `claude-code` | `~/.claude/skills/` |
| codex | `codex` | `~/.agents/skills/` |
| gemini-cli | `gemini-cli` | `~/.gemini/skills/` |
| command-code | `command-code` | `~/.commandcode/skills/` |
| generic | none | `~/.agents/skills/` (canonical copy, always written) |

## claude-code
- Hooks and settings: JSON merge into `~/.claude/settings.json`.
- MCP: `claude mcp add --scope user [--transport http] <name> <url>` / `-- <cmd> <args>`; undo `claude mcp remove <name> -s user`.
- Plugin: `claude plugin marketplace add <source>` (no undo: the marketplace may predate us), `claude plugin install <name>`,
  undo `claude plugin uninstall <name>` (checked against `claude plugin --help`).
- Rules: block in `~/.claude/CLAUDE.md`. Local skills: `~/.claude/skills/<name>/`.

## generic
- Rules: block in `~/.agents/AGENTS.md`. Local skills: `~/.agents/skills/<name>/`.

## Telemetry (ruling R8)
The `skills` CLI sends anonymous telemetry unless `DISABLE_TELEMETRY=1` (or `DO_NOT_TRACK=1`) is set. Every generated
`npx -y skills ...` command (add and the remove undo) is prefixed with `DISABLE_TELEMETRY=1 `, scoped to that command only.
Never put it in the Runner env or any config. `repo` and skill names are shell-quoted with `q()` (shared.ts).

## command-code
Sources: https://commandcode.ai/docs/mcp, https://commandcode.ai/docs/memory, `cmd mcp add/remove/add-json --help` (cmd 1.88).
- MCP: `cmd mcp add --transport http --scope user <name> <url>`; undo `cmd mcp remove <name> -s user`. stdio: `cmd mcp add-json <name> -s user '{"type":"stdio","command":...,"args":[...]}'`
  (sources: the user's serena-here script and `cmd mcp add-json --help`); same undo.
- Rules: `~/.commandcode/AGENTS.md`. If that is a symlink resolving to `~/.agents/AGENTS.md`, or is absent while
  `~/.agents/AGENTS.md` exists, the block goes to `~/.agents/AGENTS.md` (same id as generic: idempotent, one block).
- Hooks: TS mods (`~/.commandcode/mods/*.ts`); no public docs page for mods was found (UNCONFIRMED upstream), not declarative: `supports('hooks')` is false.
- Skills dir: `~/.commandcode/skills/`.

## codex
Sources (Context7 /openai/codex): github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs,
codex-rs/config/src/hooks_tests.rs, codex-rs/hooks/src/engine/discovery.rs.
- MCP: `~/.codex/config.toml`, table `[mcp_servers.<name>]`; stdio `command`, `args`; streamable HTTP `url`. Written as a toml block.
  If the table (or a subtable) exists outside our block, no action is emitted and `alreadyInstalled()` reports it.
- Hooks: `~/.codex/hooks.json` = `{ "hooks": { "<Event>": [ { "matcher"?, "hooks": [ { "type": "command", "command" } ] } ] } }`.
  Events: PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SessionStart, SessionEnd, UserPromptSubmit,
  SubagentStart, SubagentStop, Stop, Interrupt (matcher is a regex).
- Feature flag: none needed. `hooks` (legacy alias `codex_hooks`) is Stable and default-enabled; docs say
  "Hooks are enabled by default" (https://learn.chatgpt.com/docs/hooks; codex-rs/features/src/lib.rs). Older Codex builds
  may have required `[features] codex_hooks = true`; we do not write it.
- Rules: block in `~/.codex/AGENTS.md` (confirmed: codex-rs/codex-home/src/instructions/mod.rs loads
  `$CODEX_HOME/AGENTS.override.md` then `AGENTS.md`). Local skills: `~/.agents/skills/`.

## gemini-cli
Sources (Context7 /google-gemini/gemini-cli): github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md,
docs/hooks/index.md, docs/cli/gemini-md.md.
- MCP: `~/.gemini/settings.json` `mcpServers.<name>`: `httpUrl` (streamable HTTP; `url` is SSE), or `command`/`args`.
- Hooks: settings.json `hooks.<Event>: [ { matcher, hooks: [ { name, type: "command", command } ] } ]`
  (BeforeTool, AfterTool, BeforeAgent, AfterAgent, SessionStart, SessionEnd, ...). Manifest supplies the event name.
- Rules: block in `~/.gemini/GEMINI.md`. Local skills: `~/.gemini/skills/`.
