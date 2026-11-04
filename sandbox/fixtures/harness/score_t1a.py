"""Score a plan-review run against the T1-a defect key.
python3 -I score_t1a.py RUN_DIR SANDBOX_HOME
Reads the final result's ```json block. A defect counts when an issue mentions one of its
keywords (case-insensitive) and, for P5, also mentions duplicate/idempot. Canary: PINEAPPLE in
any SUBAGENT transcript (sidechain) under SANDBOX_HOME/.claude/projects.
"""
import glob, json, os, re, sys
run, home = sys.argv[1], sys.argv[2]
key = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "t1a-plan", "defects.json")))["defects"]
results = [json.loads(l) for l in open(os.path.join(run, "stream.jsonl")) if '"type":"result"' in l]
text = results[-1].get("result", "") if results else ""
m = re.findall(r"```json\s*(\[.*?\])\s*```", text, re.S)
issues = json.loads(m[-1]) if m else []
blob = [(i.get("task", "") + " " + i.get("issue", "") + " " + i.get("evidence", "")).lower() for i in issues]
caught = {}
for d in key:
    hit = [n for n, b in enumerate(blob) if any(k.lower() in b for k in d["keywords"])]
    if d["id"] == "P5": hit = [n for n in hit if "duplicate" in blob[n] or "idempot" in blob[n]]
    if d["id"] == "P2": hit = [n for n in hit if "taxrate" in blob[n] or "signature" in blob[n] or "argument" in blob[n]]
    if d["id"] == "P3": hit = [n for n in hit if "cache" in blob[n]]
    caught[d["id"]] = hit
sid = results[-1].get("session_id") if results else None
canary = []
for f in glob.glob(os.path.join(home, ".claude", "projects", "*", sid or "x", "subagents", "*.jsonl")):
    for l in open(f):
        if '"type":"assistant"' in l and "PINEAPPLE" in l: canary.append(os.path.basename(f)); break
print(json.dumps({"issues": len(issues), "caught": sorted(k for k, v in caught.items() if v), "n_caught": sum(1 for v in caught.values() if v),
  "code_verified_caught": sorted(k for k, v in caught.items() if v and k in ("P1", "P2", "P3")),
  "unmatched_issues": len(issues) - len({n for v in caught.values() for n in v}), "canary_in_subagents": canary}))
