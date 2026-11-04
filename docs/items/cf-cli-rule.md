# cf CLI rule

Tells the agent to use Cloudflare's cf CLI, or Wrangler when the project already has a Wrangler config.

| Field | Value |
| --- | --- |
| Pack | cloudflare |
| Kinds | rule |
| Agents | claude-code, command-code, codex, gemini-cli, generic |
| Benefit | quality |
| Source | local: packs/cloudflare/cf-cli-rule.md |
| Redistribution | own |
| Risk | low |
| Startup tokens | about 52 |
| Requires | none |
| Conflicts | none |

## What the installer does

- A rule block appended to each agent's instructions file (`packs/cloudflare/cf-cli-rule.md`).

Install it with `npx agentic-setup install cf-cli-rule`.
