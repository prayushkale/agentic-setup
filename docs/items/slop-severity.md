# Slop severity rule

Grades template-looking UI by clusters of tells and by how generic the copy is, then gives one fix that starts with the copy.

| Field | Value |
| --- | --- |
| Pack | design |
| Kinds | rule |
| Agents | claude-code, command-code, codex, gemini-cli, generic |
| Benefit | quality |
| Source | local: packs/design/slop-severity.md |
| Redistribution | own |
| Risk | low |
| Startup tokens | about 481 |
| Requires | none |
| Conflicts | none |

## What the installer does

- A rule block appended to each agent's instructions file (`packs/design/slop-severity.md`).

Install it with `npx agentic-setup install slop-severity`.
