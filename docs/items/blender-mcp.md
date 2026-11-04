# Blender MCP

Lets the agent drive your running Blender to clean up, rig and export models, and to pull from asset libraries.

| Field | Value |
| --- | --- |
| Pack | threejs |
| Kinds | mcp |
| Agents | claude-code, command-code, codex, gemini-cli |
| Benefit | quality, speed |
| Source | git: https://github.com/ahujasid/blender-mcp |
| Redistribution | upstream-public |
| Risk | low |
| Startup tokens | about 300 |
| Requires | uvx>=0.4 |
| Conflicts | none |

## What the installer does

- MCP server `blender` (stdio).

## Manual step

Needs Blender running with the MCP for Blender add-on. Run `uvx mcp-for-blender==2.2.6 install-addon`, enable "MCP for Blender" in Blender's Add-ons preferences, and start its server from the sidebar tab. Sharing your content with the project is opt-in; leave that consent box unchecked.

Install it with `npx agentic-setup install blender-mcp`.
