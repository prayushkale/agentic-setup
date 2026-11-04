# Changelog

## 0.1.0 (2026-11-04)

First release.

- `npx agentic-setup`: a guided, reversible installer for a curated coding-agent setup. Commands: `init`, `list`, `info`, `install`, `uninstall`, `doctor`, `update`. Flags: `--dry-run`, `--yes`, `--agents`, `--profile`.
- Adapters for Claude Code, Command Code, Codex, Gemini CLI and a generic `~/.agents` fallback.
- Packs: `core` (default), `verification`, `design`, `core-extras`, `security`, `cloudflare`, `threejs`, `video`.
- Backups before every change, a state file, and exact uninstall.
- No telemetry: each `npx skills` call runs with `DISABLE_TELEMETRY=1` on that command only.
- Claude Code plugin marketplace for the `verification`, `design`, `core-extras` and `security` packs.
- `tools/check-redistribution.mjs` runs in CI and fails if a shipped file is not our own content.
