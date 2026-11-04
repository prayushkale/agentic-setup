#!/usr/bin/env bash
# trial-run.sh SANDBOX REPO LABEL PROMPT_FILE SETTINGS [claude args...]
# One headless session in SANDBOX with cwd REPO. Writes private/trials/raw/LABEL/{stream.jsonl,summary.json,stops.tsv}.
# Follow-up turns: put extra prompts in PROMPT_FILE.2, PROMPT_FILE.3 ... (sent with --resume).
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
sb="$1" repo="$2" label="$3" pf="$4" settings="$5"; shift 5
out="$R/private/trials/raw/$label"; mkdir -p "$out"; : > "$out/stream.jsonl"; rm -f "$out/stops.tsv"
export SANDBOX_EXTRA_ENV="TRIAL_LOG_DIR=$out ACCEPT_GATE_STATE=$R/sandbox/$sb/home/.local/state/accept-gate ${TRIAL_ENV:-}"
start=$(date +%s)
"$R/tools/sandbox.sh" run "$sb" -C "$repo" -- claude -p "$(cat "$pf")" --output-format stream-json --verbose \
  --settings "$settings" "$@" < /dev/null >> "$out/stream.jsonl" 2> "$out/stderr.log" || true
sid="$(python3 -I -c 'import json,sys
for l in open(sys.argv[1]):
  try: d=json.loads(l)
  except Exception: continue
  if d.get("session_id"): print(d["session_id"]); break' "$out/stream.jsonl")"
n=2
while [[ -f "$pf.$n" && -n "$sid" ]]; do
  "$R/tools/sandbox.sh" run "$sb" -C "$repo" -- claude -p "$(cat "$pf.$n")" --resume "$sid" --output-format stream-json --verbose \
    --settings "$settings" "$@" < /dev/null >> "$out/stream.jsonl" 2>> "$out/stderr.log" || true
  n=$((n+1))
done
echo "$(( $(date +%s) - start ))" > "$out/wall_seconds"
python3 -I "$R/tools/trial-summarize.py" "$out" > "$out/summary.json"
cat "$out/summary.json"
