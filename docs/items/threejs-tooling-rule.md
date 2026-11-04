# Three.js tooling rule

Tells the agent how the Three.js tools fit together. Start with the game director, check APIs against current docs, inspect the live scene, and make assets with fal and Blender.

| Field | Value |
| --- | --- |
| Pack | threejs |
| Kinds | rule |
| Agents | claude-code, command-code, codex, gemini-cli, generic |
| Benefit | quality |
| Source | local: packs/threejs/tooling-rule.md |
| Redistribution | own |
| Risk | low |
| Startup tokens | about 140 |
| Requires | none |
| Conflicts | none |

## What the installer does

- A rule block appended to each agent's instructions file (`packs/threejs/tooling-rule.md`).

Install it with `npx agentic-setup install threejs-tooling-rule`.
