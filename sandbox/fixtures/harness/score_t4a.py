"""Grade one T4-a task. python3 -I score_t4a.py TASK REPO RUN_DIR  (run BEFORE resetting the repo)"""
import json, re, subprocess, sys
task, repo, run = sys.argv[1:4]
def g(*a): return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True).stdout
def count(word): return len(re.findall(rf"\b{word}\b", g("grep", "-o", "-w", word)))
def locs():
    res = [json.loads(l) for l in open(f"{run}/stream.jsonl") if '"type":"result"' in l]
    m = re.findall(r"```json\s*(\{.*?\})\s*```", res[-1].get("result", "") if res else "", re.S)
    try: return [str(x) for x in json.loads(m[-1]).get("locations", [])]
    except Exception: return []
def has(ls, path, lines):
    for l in ls:
        mm = re.match(r"(.+?):(\d+)", l.strip().lstrip("./"))
        if mm and mm.group(1).endswith(path) and any(abs(int(mm.group(2)) - x) <= 1 for x in lines): return True
    return False
out = {"task": task}
if task == "k1":
    ls = locs(); out.update(def_=has(ls, "src/lib/dashboard.ts", [269]), call=has(ls, "src/pages/dashboard/index.astro", [27]))
    out["correct"] = out["def_"] and out["call"]
elif task == "k3":
    ls = locs(); out.update(def_=has(ls, "src/lib/crude-nifty-analysis.ts", [620]), page=has(ls, "src/pages/crude-nifty-correlation/index.astro", [6, 9]))
    out["correct"] = out["def_"] and out["page"]
elif task == "k4":
    truth = [("src/data/prs-position/metrics.ts", 34), ("src/lib/crisis-screen.ts", 93), ("src/lib/format.ts", 29),
             ("src/pages/crude-nifty-correlation/index.astro", 13), ("src/pages/gift-nifty-correlation/index.astro", 16),
             ("src/pages/intraday-volume-profile/index.astro", 14), ("src/pages/monthly-movement/index.astro", 12),
             ("src/pages/nifty-per-day-change/index.astro", 12), ("src/pages/nifty-per-day-change/index.astro", 249),
             ("src/pages/nifty-weekly-change/index.astro", 23), ("src/pages/nifty-weekly-change/index.astro", 250),
             ("src/pages/vix-nifty-correlation/index.astro", 12)]
    ls = locs(); found = sum(has(ls, p, [n]) for p, n in truth)
    out.update(found=f"{found}/12", listed=len(ls), correct=found == 12)
else:
    old, new, files, n = ("fmtSigned", "formatSigned", {"src/lib/format.ts", "src/pages/dashboard/index.astro"}, 10) if task == "k2" else \
                         ("latestWeeklyReport", "getLatestWeeklyReport", {"src/lib/dashboard.ts", "src/pages/dashboard/index.astro"}, 3)
    changed = set(g("diff", "--name-only", "HEAD").split())
    out.update(old_left=count(old), new_count=count(new), changed_files=sorted(changed))
    out["correct"] = out["old_left"] == 0 and out["new_count"] == n and changed == files
print(json.dumps(out))
