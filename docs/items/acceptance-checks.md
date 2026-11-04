# Acceptance checks rule

Every spec ends with checks you can run, fixed before building starts. The agent runs each one and reports "N of N pass" before it says done.

| Field | Value |
| --- | --- |
| Pack | verification |
| Kinds | rule |
| Agents | claude-code, command-code, codex, gemini-cli, generic |
| Benefit | quality |
| Source | local: packs/verification/acceptance-checks.md |
| Redistribution | own |
| Risk | low |
| Startup tokens | about 196 |
| Requires | none |
| Conflicts | none |

## What the installer does

- A rule block appended to each agent's instructions file (`packs/verification/acceptance-checks.md`).

Install it with `npx agentic-setup install acceptance-checks`.
