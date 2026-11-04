# rtk (compact shell output)

Rewrites the agent's shell commands so their output comes back shorter, which cuts the tokens spent reading git, test and build logs.

| Field | Value |
| --- | --- |
| Pack | core |
| Kinds | cli-tool, hook |
| Agents | claude-code |
| Benefit | cost, speed |
| Source | brew: rtk |
| Redistribution | upstream-public |
| Risk | low |
| Startup tokens | about 0 |
| Requires | brew>=4 |
| Conflicts | none |

## What the installer does

- Hooks: claude-code PreToolUse.
- Runs: `brew install rtk`.

## Uninstall

- `brew uninstall rtk`

Install it with `npx agentic-setup install rtk`.
