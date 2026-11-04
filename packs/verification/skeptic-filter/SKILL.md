---
name: skeptic-filter
description: Opt-in second pass over code-review findings for high-risk diffs. Three skeptic subagents try to refute each finding; only findings that survive are kept. Use when the user asks to filter, double-check or de-noise review findings.
---

# Skeptic filter

Input: a list of review findings (file, line, summary) and the repo they are about.

1. **Cap the spend.** Take at most 10 findings, highest severity first. Any others pass through unfiltered and are labelled `unfiltered`. That is at most 30 subagents. Never exceed it without the user asking.
2. **Three skeptics per finding**, dispatched in parallel, each on Sonnet (never Haiku), read-only, with no network. Each gets the finding, the repo path and ONE angle, never the reviewer's reasoning:
   - **Reach:** can real inputs reach this line? Trace the callers.
   - **Guard:** is it already handled elsewhere: validation, a caller, a type or a test?
   - **Break it:** write the concrete input that fails. Run it only if it needs no network and writes only to a temp dir.
3. Each skeptic answers `REFUTED`, `CONFIRMED` or `UNSURE`, with file:line evidence or a command and its output.
4. **Verdict:** drop a finding only when 2 or 3 skeptics say REFUTED with evidence. A finding with one or more CONFIRMED and no evidence-backed majority against it stays. UNSURE counts as not refuted.
5. Report the kept findings, the dropped ones with the refutation evidence, and the subagent count. Settle a disputed finding with a command, not an argument.
