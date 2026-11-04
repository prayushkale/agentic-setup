"""Grade one T6-b run. python3 -I score_t6b.py RUN_DIR FIXTURE  (FIXTURE = a-saas | b-editorial | c-middle | d-clean | e-dashboard)
Expected slop_severity: High for a/b/c (sloppy), None or Low for d/e (clean). Medium+ findings on d/e count as false positives."""
import json, re, sys
run, fx = sys.argv[1:3]
res = [json.loads(l) for l in open(f"{run}/stream.jsonl") if '"type":"result"' in l]
m = re.findall(r"```json\s*(\{.*?\})\s*```", res[-1].get("result", "") if res else "", re.S)
try: j = json.loads(m[-1])
except Exception: j = {}
sev = j.get("slop_severity"); f = j.get("findings", [])
clean = fx[0] in "de"
out = {"fixture": fx, "slop_severity": sev, "findings": len(f),
       "by_severity": {s: sum(1 for x in f if x.get("severity") == s) for s in ("High", "Medium", "Low")}}
out["correct"] = sev in ("None", "Low") if clean else sev == "High"
if clean: out["medium_plus_fp"] = sum(1 for x in f if x.get("severity") in ("High", "Medium"))
print(json.dumps(out))
