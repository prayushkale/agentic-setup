# Grilling follow-up rule

After each decision in a grilling session, the agent asks how you would know it came out wrong, and turns your answer into an acceptance check.

| Field | Value |
| --- | --- |
| Pack | core-extras |
| Kinds | rule |
| Agents | claude-code, command-code, codex, gemini-cli, generic |
| Benefit | quality |
| Source | local: packs/core/grilling-followup.md |
| Redistribution | own |
| Risk | low |
| Startup tokens | about 253 |
| Requires | grill-me |
| Conflicts | none |

## What the installer does

- A rule block appended to each agent's instructions file (`packs/core/grilling-followup.md`).

Install it with `npx agentic-setup install grilling-followup`.
