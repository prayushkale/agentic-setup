## Acceptance checks
- Every superpowers spec ends with `## Acceptance checks`: a `Check files:` line (globs for the tests and runner config the checks use), then one box per outcome: `- [ ] AC-n · CHECK: <command or observation> · EXPECT: <binary result> · EVIDENCE:`.
- When the user approves the spec, commit it and run `git tag accept-lock`. Never move, delete or re-create that tag, and never edit a CHECK, an EXPECT or a check file after it; if one is wrong, stop and ask.
- Before claiming done, run every CHECK yourself, tick its box and fill EVIDENCE with what you saw. Report "N of N checks pass". An outcome you will not meet gets `ABANDON: AC-n <reason>` and a line to the user, never silence.
- The final review gets the diff and this section only, not your summary.
