# agentic-setup

A guided installer for a curated coding-agent setup. It walks you through the setup one item at a time, explains each item in plain words (what it does, what it costs in startup tokens, how risky it is), and installs only what you choose. Everything it does can be undone.

It works with Claude Code, Command Code, Codex, Gemini CLI and any agent that reads `~/.agents`.

## Install

Needs Node 20.12 or newer.

```sh
npx agentic-setup --dry-run   # see what it would do; writes nothing
npx agentic-setup             # guided install
```

Package: [npmjs.com/package/agentic-setup](https://www.npmjs.com/package/agentic-setup). To run the latest code from a clone instead: `git clone https://github.com/prayushkale/agentic-setup && cd agentic-setup/installer && npm i --include=dev && npm run build && node dist/cli.js`.

Other commands: `list [--pack]`, `info <id>`, `install <id...>`, `uninstall <id...>`, `doctor`, `update`. Flags: `--dry-run`, `--yes`, `--agents a,b`, `--profile <file>`.

## Packs

Only `core` is selected by default. The rest are opt-in.

<!-- agentic-setup:packs begin -->
| Pack | Default | Items | What it is |
| --- | --- | --- | --- |
| `core` | yes | 17 | The everyday setup. A planning-first workflow, cheaper shell output, current library docs, design and security skills, and a short set of working rules. |
| `verification` | no | 4 | Makes "done" mean the agreed checks pass. Adds an acceptance-checks rule, a Stop-hook gate, a blind plan review and a skeptic pass over review findings. |
| `design` | no | 1 | A rule for grading generic, template-looking UI by severity instead of by counting tricks. |
| `core-extras` | no | 1 | Small additions to core skills. Grilling sessions turn each settled decision into a check you can test. |
| `security` | no | 1 | Scans a third-party skill before you install it. Needs NVIDIA SkillSpector. |
| `cloudflare` | no | 2 | Cloudflare's own skills for Workers, Durable Objects, the Agents SDK and the cf CLI, plus a rule for choosing between cf and Wrangler. |
| `threejs` | no | 6 | Three.js API and game-building skills, a live scene inspector, and fal and Blender MCPs for generating assets. fal needs an account and Blender must be running. |
| `video` | no | 2 | Skills for making videos in code with HyperFrames (HTML to video) and Remotion (React to video). |
<!-- agentic-setup:packs end -->

**Startup cost.** The `≈+N tok` value shown for each item is an estimate. We measured the whole `core` pack in Claude Code, starting from an empty HOME: one trivial turn used about 16.4k startup tokens before install and about 22.5k after, so core costs about +6.1k. The per-item estimates for core add up to about 4.0k, so the real cost is higher than the estimates.

Every item has a page under [docs/items](docs/items). The reasoning behind the defaults is in [docs/WHY.md](docs/WHY.md).

## Safety

- **Dry-run first.** `--dry-run` shows what would change and writes nothing. For skills installed through `npx skills`, it lists the exact commands and target folders.
- **Backups.** Before the installer changes a file, it copies the original to `~/.agentic-setup/backups/<timestamp>/`.
- **State.** What was installed, and what each item created, is recorded in `~/.agentic-setup/state.json`.
- **Exact uninstall.** `npx agentic-setup uninstall <id>` removes only what that item added. Files the installer wrote itself go back byte for byte. Rules are marked blocks, so only the installer's own block is removed and your edits around it stay. Items installed by another tool are removed with that tool's own uninstall command, which the manifest lists. If you changed a file after install, uninstall tells you and leaves it alone.
- **One shared skills folder.** Skills always land in `~/.agents/skills`, which Codex also reads. Claude Code, Gemini CLI and Command Code get links to that copy in their own skills folders.
- **Existing setup respected.** An item already present on your machine is shown as "already installed", is not adopted into the state file, and is never removed by uninstall.
- **No telemetry.** The installer sends nothing anywhere. Each `npx skills` call runs with `DISABLE_TELEMETRY=1` on that one command only; nothing is written to your config or environment.
- **No `curl | sh`.** Items that need a downloaded script show the URL and its sha256 and ask you to confirm. Higher-risk items ask a second time and say why.

## What uninstall leaves behind

Uninstall gives your agent config back as it was. That covers `settings.json`, `CLAUDE.md`, `AGENTS.md`, skills, MCP servers and plugins. Some tools also keep caches and data outside agent config, and uninstall leaves these in place:

- **agent-browser:** the browser it downloads (`agent-browser install`), under `~/.agent-browser/`.
- **npx skills:** its lock file, `~/.agents/.skill-lock.json`.
- **Claude Code plugins:** the downloaded marketplace copy and plugin cache under `~/.claude/plugins/`.
- **uv tools (Serena):** uv's tool data and cache, under `~/.local/share/uv/` and `~/.cache/uv/`.
- **npm and npx:** their package caches (`~/.npm/`).

You can delete these by hand if you want the space back.

## Claude Code plugins

Items that are our own skills, hooks and rules are also published as Claude Code plugins, one per pack that bundles such content: `verification`, `design`, `core-extras` and `security`.

```sh
claude plugin marketplace add prayushkale/agentic-setup
claude plugin install verification@agentic-setup
```

A plugin cannot add text to your `CLAUDE.md`, so inside a plugin each rule becomes a skill that loads when it is relevant, not an always-on rule. For always-on rules, use `npx agentic-setup`. The `core`, `cloudflare`, `threejs` and `video` packs are made of upstream projects (plus a rule or two of ours), so they have no plugin and install only through `npx agentic-setup`.

## Development

```sh
cd installer && npm ci --include=dev && npx tsc --noEmit && npx vitest run
node tools/gen-marketplace.mjs   # .claude-plugin/ and plugins/
node tools/gen-item-docs.mjs     # docs/items/ and the pack table above
```

CI regenerates both with `--check` and fails if the committed files are stale. `manifest/items.yaml` and `manifest/packs.yaml` are the single source of truth.

`node tools/check-redistribution.mjs` (also in CI) fails if any file under `packs/` or `plugins/`, or any file bundled into the npm package, is not our own content. Run it with `--work <dir>` to also compare shipped files byte for byte against a folder of third-party files.

## License

MIT. Items installed from upstream keep their own licenses.
