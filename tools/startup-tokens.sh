#!/usr/bin/env bash
# startup-tokens.sh <sandbox> [-C dir] [extra claude args...]
# One trivial headless turn; prints input-side tokens of that turn (= startup context) and cost.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
name="$1"; shift; cdarg=(); if [[ "${1:-}" == "-C" ]]; then cdarg=(-C "$2"); shift 2; fi
"$REPO/tools/sandbox.sh" run "$name" ${cdarg[@]+"${cdarg[@]}"} -- claude -p "Reply with just: ok" --output-format json --max-turns 1 "$@" < /dev/null \
 | python3 -I -c 'import json,sys
d=json.load(sys.stdin); u=d["usage"]
t=u["input_tokens"]+u["cache_creation_input_tokens"]+u["cache_read_input_tokens"]
print(json.dumps({"ok":not d["is_error"],"result":d["result"][:60],"startup_tokens":t,"cost_usd":round(d["total_cost_usd"],4),"models":list(d.get("modelUsage",{}))}))'
