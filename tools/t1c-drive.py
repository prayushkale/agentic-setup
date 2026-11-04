"""Drive a design interview between a sandboxed agent and a simulated user (Haiku + answer sheet).
python3 -I tools/t1c-drive.py SANDBOX REPO LABEL FIRST_PROMPT_FILE USER_SIM_FILE SETTINGS [--max-user-turns 8]
Stops when a new spec appears under docs/superpowers/specs/ or after max user turns.
Writes private/trials/raw/LABEL/{stream.jsonl,conversation.md,summary.json}.
"""
import json, os, subprocess, sys, time
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sb, repo, label, first, usim, settings = sys.argv[1:7]
max_turns = int(sys.argv[sys.argv.index("--max-user-turns") + 1]) if "--max-user-turns" in sys.argv else 8
out = os.path.join(R, "private", "trials", "raw", label); os.makedirs(out, exist_ok=True)
stream = open(os.path.join(out, "stream.jsonl"), "w"); conv = open(os.path.join(out, "conversation.md"), "w")
specs_dir = os.path.join(repo, "docs", "superpowers", "specs")
before = set(os.listdir(specs_dir)) if os.path.isdir(specs_dir) else set()

def claude(prompt, cwd, extra):
    cmd = [os.path.join(R, "tools", "sandbox.sh"), "run", sb, "-C", cwd, "--", "claude", "-p", prompt,
           "--output-format", "stream-json", "--verbose", "--settings", settings, *extra]
    p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=1800)
    res = None
    for line in p.stdout.splitlines():
        try: ev = json.loads(line)
        except Exception: continue
        if ev.get("type") == "result": res = ev
    return p.stdout, res

agent_cost = user_cost = 0.0; sid = None; user_turns = 0; start = time.time()
prompt = open(first).read()
while True:
    raw, res = claude(prompt, repo, ["--model", "sonnet", "--max-budget-usd", "4"] + (["--resume", sid] if sid else []))
    stream.write(raw); stream.flush()
    if not res: conv.write("\n**agent:** (no result)\n"); break
    sid = res.get("session_id"); agent_cost += res.get("total_cost_usd") or 0
    text = res.get("result") or ""; conv.write(f"\n## agent\n{text}\n"); conv.flush()
    now = set(os.listdir(specs_dir)) if os.path.isdir(specs_dir) else set()
    if now - before or user_turns >= max_turns: break
    tmp = os.path.join(R, "sandbox", sb, "tmp"); os.makedirs(tmp, exist_ok=True)
    _, ures = claude(open(usim).read() + "\n\n---\nThe assistant said:\n\n" + text, tmp, ["--model", "haiku", "--max-turns", "1"])
    answer = (ures or {}).get("result") or "Your recommendation is fine."
    user_cost += (ures or {}).get("total_cost_usd") or 0; user_turns += 1
    conv.write(f"\n## user (simulated)\n{answer}\n"); conv.flush(); prompt = answer
now = set(os.listdir(specs_dir)) if os.path.isdir(specs_dir) else set()
summary = {"label": label, "session": sid, "user_turns": user_turns, "agent_cost_usd": round(agent_cost, 4), "user_sim_cost_usd": round(user_cost, 4),
           "new_specs": sorted(now - before), "wall_seconds": round(time.time() - start)}
json.dump(summary, open(os.path.join(out, "summary.json"), "w"), indent=2); print(json.dumps(summary))
