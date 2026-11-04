---
name: plan-review
description: Blind review of a superpowers plan before execution. Fresh reviewers with no conversation context check every plan claim against the code and the spec. Use after writing-plans and before executing, or when the user asks to review a plan.
---

# Plan review (blind reviewers)

You are the coordinator. You do not review the plan yourself, and you never give reviewers your own summary, the conversation, or what you expect them to find.

1. **Dispatch two reviewers in parallel** (fresh subagents on Sonnet, read-only). Give each only: the plan path, the spec path named in its `**Spec:**` line, the repo root, and the brief below.
2. **Reviewer brief:**
   - Check every concrete claim against the code: each file path exists, or the plan says it is created; each function, type and signature the plan calls matches the code (quote file:line); each name and term is defined somewhere.
   - Trace each task to a spec requirement. Flag work no requirement asks for (caches or abstractions "for later", features the spec puts out of scope).
   - Trace each spec requirement, including its failure cases, to a task and a test. Flag the gaps.
   - Flag terms or acronyms that neither the spec nor the code defines.
   - For each finding give: the location in the plan, the claim, the evidence (file:line or a command and its output), and the severity (blocker, major or minor). No evidence means no finding.
3. **Merge.** De-duplicate. Reject a finding only when you can show evidence against it, and keep the rejected ones in a list with the reason. Do not add findings of your own.
4. **Report** the accepted findings, the rejected ones and the reviewer count. Do not edit the plan unless the user asks.
