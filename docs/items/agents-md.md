# AGENTS.md working rules

A short set of working rules for every agent. Plan before building, write tests first, prove work before calling it done, keep changes small, and look up current docs.

| Field | Value |
| --- | --- |
| Pack | core |
| Kinds | rule |
| Agents | claude-code, command-code, codex, gemini-cli, generic |
| Benefit | quality |
| Source | local: templates/AGENTS.md |
| Redistribution | own |
| Risk | low |
| Startup tokens | about 197 |
| Requires | none |
| Conflicts | none |

## What the installer does

- A rule block appended to each agent's instructions file (`templates/AGENTS.md`).

Install it with `npx agentic-setup install agents-md`.
