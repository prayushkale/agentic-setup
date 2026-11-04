"""Score review findings against a planted-bug key.

python3 -I score_review.py KEY FINDINGS.json [--adjudicate ADJ.json]
FINDINGS: JSON list of {"file", "line", "summary"} (extra keys ignored).
A finding hits a key item when the file matches (path suffix) and the line is within 3,
or within 15 lines and a keyword appears in the summary. Each finding counts for at most
one item (closest line). Unmatched findings are "other": FP unless ADJ marks them real
({"<index>": "real"|"fp"}). Prints JSON.
"""
import json, sys

def same_file(a, b):
    a, b = a.strip("./"), b.strip("./")
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)

def main():
    key = json.load(open(sys.argv[1])); findings = json.load(open(sys.argv[2]))
    adj = {}
    if "--adjudicate" in sys.argv: adj = json.load(open(sys.argv[sys.argv.index("--adjudicate") + 1]))
    items = [("bug", b) for b in key["bugs"]] + [("decoy", d) for d in key["decoys"]] + [("trap", t) for t in key["traps"]]
    hits = {}; other = []
    for i, f in enumerate(findings):
        try: line = int(f.get("line") or 0)
        except (TypeError, ValueError): line = 0
        text = (f.get("summary", "") + " " + f.get("detail", "")).lower()
        best = None
        for kind, it in items:
            if not same_file(str(f.get("file", "")), it["file"]): continue
            dist = abs(line - it["line"])
            kw = any(k.lower() in text for k in it.get("keywords", []))
            if dist <= 3 or (dist <= 15 and kw):
                if best is None or dist < best[0]: best = (dist, kind, it["id"])
        if best: hits.setdefault(best[2], []).append(i)
        else: other.append(i)
    bug_ids = [b["id"] for b in key["bugs"]]
    tp_items = [b for b in bug_ids if b in hits]
    decoy_hits = [d["id"] for d in key["decoys"] if d["id"] in hits]
    trap_hits = [t["id"] for t in key["traps"] if t["id"] in hits]
    tp_findings = sum(len(hits[b]) for b in tp_items)
    real_other = [i for i in other if adj.get(str(i)) == "real"]
    fp = sum(len(hits[x]) for x in decoy_hits + trap_hits) + len(other) - len(real_other)
    n = len(findings)
    print(json.dumps({
        "findings": n, "bugs_found": tp_items, "recall": f"{len(tp_items)}/{len(bug_ids)}",
        "missed": [b for b in bug_ids if b not in hits], "decoy_hits": decoy_hits, "trap_hits": trap_hits,
        "other_unmatched": other, "other_judged_real": real_other,
        "precision": round((tp_findings + len(real_other)) / n, 3) if n else None, "false_positives": fp,
    }, indent=2))

main()
