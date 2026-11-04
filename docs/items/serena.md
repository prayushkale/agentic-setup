# Serena (per-repo code navigation)

Installs Serena and a serena-here helper. Run serena-here inside a large repo and the agent navigates by symbol there instead of reading whole files. Nothing loads in other repos.

| Field | Value |
| --- | --- |
| Pack | core |
| Kinds | cli-tool |
| Agents | claude-code, command-code |
| Benefit | cost, speed |
| Source | git: https://github.com/oraios/serena |
| Redistribution | own |
| Risk | low |
| Startup tokens | about 0 |
| Requires | uv>=0.4 |
| Conflicts | none |

## What the installer does

- Runs: `uv tool install serena-agent`.
- Copies files to `~/.local/bin/serena-here`.

## Uninstall

- `uv tool uninstall serena-agent`

Install it with `npx agentic-setup install serena`.
