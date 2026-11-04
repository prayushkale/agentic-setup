# Working rules

## Workflow
- For anything beyond a small fix: settle the requirements first by asking questions, then write a short plan, get the user's approval, and only then build.
- Write the test first for logic changes (red, then green). Before saying something is done, prove it: run the tests or the build, or open the page.
- When several features are in progress at once, give each its own git worktree.
- Build only what was asked for (YAGNI). No abstractions or options "for later".

## Tools
- For questions about a library, framework or API, look up the current docs with Context7 instead of answering from memory.
- For UI work, check the result visually (take a screenshot, fix, repeat). If the project has a DESIGN.md, follow it.
- Use the `gh` CLI for GitHub tasks.
