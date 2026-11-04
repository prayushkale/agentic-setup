# fal MCP

Generates images, 3D models, audio and video through fal's hosted models. The game skills use it for assets.

| Field | Value |
| --- | --- |
| Pack | threejs |
| Kinds | mcp |
| Agents | claude-code, command-code, codex, gemini-cli |
| Benefit | speed |
| Source | git: https://fal.ai/docs/documentation/setting-up/mcp |
| Redistribution | upstream-public |
| Risk | low |
| Startup tokens | about 300 |
| Requires | none |
| Conflicts | none |

## What the installer does

- MCP server `fal` (http).

## Manual step

Needs your own fal.ai account (OAuth sign-in; the hosted server takes no API key). Sign in once after install. In Claude Code run /mcp and pick fal; in Codex run `codex mcp login fal`. Generations are billed to your fal account.

Install it with `npx agentic-setup install fal-mcp`.
