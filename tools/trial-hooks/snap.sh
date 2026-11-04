#!/usr/bin/env bash
# Trial-only Stop hook: snapshot the working tree (tracked + untracked) as a git tree object at
# every Stop, logging "n<TAB>epoch<TAB>tree<TAB>pending_background_agents" to $TRIAL_LOG_DIR/stops.tsv. Never blocks.
input="$(cat)"; dir="${TRIAL_LOG_DIR:-}"; [[ -n "$dir" ]] || exit 0
read -r cwd tp < <(printf '%s' "$input" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d.get("cwd","") or ".", d.get("transcript_path","") or "-")' 2>/dev/null)
R="$(cd "$(dirname "$0")/../.." && pwd)"
pending="$( [[ "$tp" != "-" ]] && node "$R/packs/verification/accept-gate/pending.mjs" "$tp" 2>/dev/null || echo 0)"
root="$(git -C "${cwd:-.}" rev-parse --show-toplevel 2>/dev/null)" || exit 0
idx="$(mktemp)"; cp "$root/.git/index" "$idx" 2>/dev/null
tree="$(cd "$root" && GIT_INDEX_FILE="$idx" git add -A . 2>/dev/null && GIT_INDEX_FILE="$idx" git write-tree 2>/dev/null)"
rm -f "$idx"; mkdir -p "$dir"
n=$(( $( [[ -f "$dir/stops.tsv" ]] && wc -l < "$dir/stops.tsv" || echo 0 ) + 1 ))
printf '%s\t%s\t%s\t%s\n' "$n" "$(date +%s)" "$tree" "$pending" >> "$dir/stops.tsv"
exit 0
