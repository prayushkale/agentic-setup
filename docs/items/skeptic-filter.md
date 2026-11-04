# skeptic-filter

An opt-in second pass for risky diffs. Three skeptics try to refute each review finding, and only findings that survive with evidence are kept. Capped at 30 subagents.

| Field | Value |
| --- | --- |
| Pack | verification |
| Kinds | skill |
| Agents | claude-code, command-code, codex, gemini-cli, generic |
| Benefit | quality |
| Source | local: packs/verification/skeptic-filter |
| Redistribution | own |
| Risk | low |
| Startup tokens | about 71 |
| Requires | none |
| Conflicts | none |

## What the installer does

- Bundled skills: `packs/verification/skeptic-filter`.

Install it with `npx agentic-setup install skeptic-filter`.
