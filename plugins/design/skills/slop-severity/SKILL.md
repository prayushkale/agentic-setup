---
name: slop-severity
description: "Grades template-looking UI by clusters of tells and by how generic the copy is, then gives one fix that starts with the copy. Loads when relevant; for an always-on rule use npx agentic-setup."
---

# Grading AI-slop severity

One tell is not slop. Slop is a cluster of tells from the same template, carried by copy that could sell anything. Grade the cluster, not the count of CSS tricks.

## The three templates
1. **Default SaaS:** indigo-to-purple gradients, gradient-clipped headline text, frosted glass cards, sparkle or rocket emoji, hype verbs ("supercharge", "unleash", "10x"), three identical feature cards.
2. **Editorial costume:** a big serif display face over tiny uppercase mono labels with wide tracking, paper grain or noise overlays, a scrolling marquee, invented heritage ("Est. 1931", "Maison"), and prose that sounds literary but names nothing concrete. It looks crafted; the brand is a costume.
3. **Tasteful middle:** a calm neutral palette with one accent rule or stripe, a sans/serif pairing switched mid-headline, a soft glow shadow, rounded everything, and "all-in-one" or "everything you need" copy. Competent, quiet, and anonymous.

## Severity
- **High:** three or more tells from one template, AND the copy is generic. Test the copy: swap in another product's name. If every line still works, the copy is the anchor of the problem. Templates 2 and 3 are High even though they look restrained.
- **Medium:** two tells from one template, or a full template look carried by copy that is specific to this product.
- **Low:** a single tell in an otherwise specific design.
- **None:** say so plainly. Do not pad the report.

## Not slop
- Data-dense UI conventions: tickers, tabular figures, monospace numbers, sticky headers, red/green deltas, `translateX(-50%)` for centering.
- A restrained palette with copy that names real things (the user's data, actual settings, exact limits).
- One expressive choice that serves the content.

## Report
Name the template, list each tell with file:line, quote the copy line that anchors the grade, and give one fix that changes the copy before the CSS.
