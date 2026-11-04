# vet-skill

Scans a third-party skill with NVIDIA SkillSpector before you install it, and acts on the verdict. It fails closed when the scan cannot finish.

| Field | Value |
| --- | --- |
| Pack | security |
| Kinds | skill |
| Agents | claude-code, command-code, codex, gemini-cli, generic |
| Benefit | quality |
| Source | local: packs/security/vet-skill |
| Redistribution | own |
| Risk | low |
| Startup tokens | about 58 |
| Requires | skillspector>=2.13.3 |
| Conflicts | none |

## What the installer does

- Bundled skills: `packs/security/vet-skill`.

## Manual step

Install NVIDIA SkillSpector v2.13.3 (https://github.com/NVIDIA/SkillSpector) so `skillspector` is on PATH. Until then every scan reports ERROR and nothing gets installed.

Install it with `npx agentic-setup install vet-skill`.
