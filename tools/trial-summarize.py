"""Summarize a trial-run dir: cost, tokens, turns, prompts, tool calls, subagents, hook blocks.

Cost: result events carry SESSION-CUMULATIVE modelUsage / total_cost_usd, so summing them over
resumed prompts double-counts. We take the last modelUsage per session and price its tokens with
RATES (USD per MTok, cached 2026-10-06; Haiku cache read estimated). total_cost_usd is kept only
as cli_cost_usd (last value per session) for reference.
"""
import json, os, sys, collections
RATES_AS_OF = "2026-10-06"
RATES = {  # input, output, cache write 5m, cache write 1h, cache read
  "sonnet": (2.0, 10.0, 2.50, 4.00, 0.20),
  "opus":   (4.0, 20.0, 5.00, 8.00, 0.20),
  "haiku":  (0.10, 0.50, 0.125, 0.20, 0.01),
}
def price(model, u):
    fam = next((f for f in RATES if f in model), None)
    if fam is None: raise SystemExit(f"no rate for model {model}")
    i, o, w5, w1, r = RATES[fam]
    c5, c1 = u.get("cacheCreationEphemeral5mInputTokens"), u.get("cacheCreationEphemeral1hInputTokens")
    if c5 is None and c1 is None: c5, c1 = u.get("cacheCreationInputTokens", 0), 0  # unknown split: assume 5m
    return (u.get("inputTokens", 0) * i + u.get("outputTokens", 0) * o + (c5 or 0) * w5 + (c1 or 0) * w1
            + u.get("cacheReadInputTokens", 0) * r) / 1e6
d = os.path.normpath(sys.argv[1])
tools = collections.Counter(); results = []; sub = 0; blocks = 0; first_input = None; sids = set()
for line in open(os.path.join(d, "stream.jsonl")):
    try: ev = json.loads(line)
    except Exception: continue
    if ev.get("session_id"): sids.add(ev["session_id"])
    if ev.get("type") == "assistant":
        msg = ev.get("message", {})
        if first_input is None and msg.get("usage"):
            u = msg["usage"]; first_input = u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("cache_read_input_tokens", 0)
        for c in msg.get("content", []):
            if c.get("type") == "tool_use":
                name = c.get("name"); tools[name] += 1
                if name in ("Agent", "Task") and not ev.get("parent_tool_use_id"): sub += 1
    if ev.get("type") == "result": results.append(ev)
    if "accept-gate: not done yet" in line: blocks += 1
last = {}
for r in results: last[r.get("session_id")] = r  # cumulative per session: keep the last
by_model = collections.defaultdict(collections.Counter)
for r in last.values():
    for m, u in (r.get("modelUsage") or {}).items():
        for k, v in u.items():
            if isinstance(v, (int, float)) and k not in ("contextWindow", "maxOutputTokens", "costUSD"): by_model[m][k] += v
cost = sum(price(m, u) for m, u in by_model.items())
cli_cost = sum(r.get("total_cost_usd") or 0 for r in last.values())
tok = collections.Counter()
for u in by_model.values():
    for k in ("inputTokens", "outputTokens", "cacheCreationInputTokens", "cacheReadInputTokens"): tok[k] += u.get(k, 0)
stops = []
p = os.path.join(d, "stops.tsv")
if os.path.exists(p): stops = [l.rstrip("\n").split("\t") for l in open(p) if l.strip()]
done_stops = [x for x in stops if len(x) < 4 or x[3].strip() in ("", "0")]
wall = open(os.path.join(d, "wall_seconds")).read().strip() if os.path.exists(os.path.join(d, "wall_seconds")) else None
print(json.dumps({"label": os.path.basename(d), "sessions": sorted(sids), "prompts": len(results), "cost_usd": round(cost, 4),
  "cost_basis": f"token-priced, rates cached {RATES_AS_OF}", "cli_cost_usd": round(cli_cost, 4),
  "cost_by_model": {m: round(price(m, u), 4) for m, u in by_model.items()}, "tokens": dict(tok), "turns": sum(r.get("num_turns") or 0 for r in results), "errors": [r.get("result", "")[:200] for r in results if r.get("is_error")],
  "first_turn_input_tokens": first_input, "tool_calls": dict(tools), "top_level_subagents": sub, "gate_block_mentions": blocks,
  "stops": len(stops), "done_stops": len(done_stops), "first_done_tree": done_stops[0][2] if done_stops else None, "wall_seconds": wall,
  "final": (results[-1].get("result") or "")[-1500:] if results else None}, indent=2))
