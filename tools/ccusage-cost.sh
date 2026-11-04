#!/usr/bin/env bash
# ccusage-cost.sh SANDBOX SESSION_ID...  -> JSON {cost_usd, tokens{...}, entries} summed over the sessions.
# Uses ccusage inside the sandbox (its own ~/.claude logs) with an offline copy of the real pricing cache.
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"; sb="$1"; shift
c="$R/sandbox/$sb/home/.cache/ccusage"; [[ -d "$c" ]] || { mkdir -p "$(dirname "$c")"; cp -R "${REAL_HOME:-$HOME}/.cache/ccusage" "$c"; }
for sid in "$@"; do "$R/tools/sandbox.sh" run "$sb" -- ccusage session --json --offline -i "$sid" 2>/dev/null || echo '{}'; echo; done | python3 -I -c '
import json, sys
tot = {"cost_usd": 0.0, "input": 0, "output": 0, "cache_create": 0, "cache_read": 0, "entries": 0}
for chunk in sys.stdin.read().split("\n{"):
    chunk = chunk.strip()
    if not chunk: continue
    if not chunk.startswith("{"): chunk = "{" + chunk
    try: d = json.loads(chunk)
    except Exception: continue
    for e in d.get("entries", []):
        tot["cost_usd"] += e.get("costUSD") or 0; tot["input"] += e.get("inputTokens", 0); tot["output"] += e.get("outputTokens", 0)
        tot["cache_create"] += e.get("cacheCreationTokens", 0); tot["cache_read"] += e.get("cacheReadTokens", 0); tot["entries"] += 1
tot["cost_usd"] = round(tot["cost_usd"], 4); tot["total_tokens"] = tot["input"] + tot["output"] + tot["cache_create"] + tot["cache_read"]
print(json.dumps(tot))'
