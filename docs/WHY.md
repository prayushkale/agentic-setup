# Why the defaults are what they are

The `core` pack is deliberately small: it is the setup the author already uses every day. This page explains why nothing else was promoted into it.

## What was done

- About 110 agent-tooling items were catalogued: skills, hooks, packs, starter kits and guides.
- 23 of them were studied in depth.
- 8 were trialled head to head against the reference setup, each in a throwaway home directory so the real configuration was never touched.

## What came out

Nothing beat the reference setup. The reference is Superpowers, a shared set of skills, rtk for shorter shell output, Context7 for current library docs, and a model split that plans on a larger model and builds on a smaller one. It reached the ceiling on every quality measure that was built, and every candidate cost more tokens to get there. That is why `core` is just the reference setup.

A candidate would have been promoted only if it beat the baseline on its own metric, added under about 2k tokens at startup, and had no unresolved high-risk finding. None met all three.

## Why the opt-in packs are opt-in

- **Fresh-context plan review.** It found the same defects as the baseline at 2.2 times the cost.
- **Follow-up checks for specs.** A tie with the baseline.
- **Acceptance gate** (a Stop hook plus locked checks). A tie at the ceiling for 1.35 times the cost. A bypass that moved a tag was found and fixed, and all 7 tamper attempts were then blocked. One bypass remains: deleting the pin file. Closing it needs an operating-system write deny, so the item is marked medium risk.
- **Skeptic filter on review findings.** Precision rose 7 points against a bar of 25, at 11 times the cost.
- **Graft and Serena as default code navigation.** Both gave correct answers, but used 29% and 7.7% more tokens and added about 5.5k and 1.9k tokens at startup on a repo of roughly 100 files. Serena stays a per-repo choice (`serena-here`). Graft is not shipped.
- **Slop-severity rubric.** It scored 4 of 5 where the baseline scored 5 of 5, because it downgraded editorial-style slop. It ships only as an opt-in experiment.
- **Pre-install skill scan.** Not trialled, because it needs NVIDIA SkillSpector.

## Cost

The full reference setup costs about 18.2k tokens at startup in Claude Code in an empty directory, about 10k of it skills. The installer shows the sum of the items you pick before it installs anything.

## Caveat

Several trials hit the ceiling, so harder tasks might separate the arms. Treat these results as "no evidence that the extras help on these tasks", not as proof that they never will.
