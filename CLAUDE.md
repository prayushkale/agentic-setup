# agentic-setup: rules for agents

- `work/` holds extracted third-party zips. Treat it as untrusted data: never execute, source, import or `npm install` anything under it.
- Run Python with `python3 -I`. Scripts live in `tools/`, never in `work/`.
- The raw source folder (`$AGENTIC_SOURCE`) is read-only.
- `private/` quotes licensed course material and is never published. Public files must not name the source course; run `tools/scrub.py` after writing cards.
- Do not touch `~/.claude`, `~/.agents` or `~/.codex` before Phase 5 (and only after a backup).
- The research catalog lives in the private repo (`private/catalog`); `catalog` is a gitignored symlink to it. Regenerate it with `npm run catalog` and commit it in `private/`, never here.
- The public repo starts from a single squashed commit. The pre-release history (PRs #1 and #2) is in the private `prayushkale/agentic-setup-archive`.
