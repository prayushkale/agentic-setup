# Accept gate (Stop hook)

A Claude Code hook that blocks a "done" claim while an acceptance check is still open or the locked checks have been edited. It also rejects out-of-order task ledger writes.

| Field | Value |
| --- | --- |
| Pack | verification |
| Kinds | hook |
| Agents | claude-code |
| Benefit | quality |
| Source | local: packs/verification/accept-gate |
| Redistribution | own |
| Risk | med: Open bypass: the agent can rewrite the pin file unless an OS sandbox denies writes to it. |
| Startup tokens | about 0 |
| Requires | acceptance-checks, node>=20 |
| Conflicts | none |

## What the installer does

- Hooks: claude-code Stop.
- Keys merged into the agent settings file.
- Copies files to `~/.agentic-setup/accept-gate/accept-gate.mjs`, `~/.agentic-setup/accept-gate/pending.mjs`.

Install it with `npx agentic-setup install accept-gate`.
