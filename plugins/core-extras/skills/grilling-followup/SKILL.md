---
name: grilling-followup
description: "After each decision in a grilling session, the agent asks how you would know it came out wrong, and turns your answer into an acceptance check. Loads when relevant; for an always-on rule use npx agentic-setup."
---

## After each answer: how would we know it came out wrong?

When the user settles a decision, ask one follow-up in the same round: "How would we know this came out wrong?" Turn the answer into one acceptance check:

- **Testable:** `- [ ] AC-n · CHECK: <command, test or observation> · EXPECT: <a result that is plainly yes or no> · EVIDENCE:`
- **Taste** (only the user can judge it): `- [ ] AC-n · CHECK: user looks at <thing> · EXPECT: user says it matches <the stated criterion> · EVIDENCE:`
- **Not decided yet:** `- [ ] AC-n · UNDECIDED: <the open question> · EXPECT: a reviewer reports CANNOT JUDGE until the user decides · EVIDENCE:`

Propose the check yourself; "yes" accepts it. Do not invent an answer the user did not give. A vague answer ("it should feel fast") becomes a question back, not a check.

When the frontier is empty, put the checks into the spec's `## Acceptance checks` section (in `docs/superpowers/specs/`), with a `Check files:` line. Never write them to a separate file.
