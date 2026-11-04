#!/usr/bin/env bash
# realhome-guard.sh: prove trials wrote nothing to the real agent config.
#   tools/realhome-guard.sh snapshot <out.tsv>
#   tools/realhome-guard.sh check <before.tsv>    exit 1 and list changes if any
# Covers ~/.agents, ~/.codex, ~/.graft and ~/.claude config (settings*, CLAUDE.md, skills/,
# plugins/ except caches, agents/, commands/, hooks/). ~/.claude session logs are excluded
# because this controlling session writes them; instead `check` fails if any real
# ~/.claude/projects dir name mentions the sandbox path (a trial session leaking out).
set -euo pipefail
H="${REAL_HOME:-$HOME}"

snapshot() {
  {
    for d in "$H/.agents" "$H/.codex" "$H/.graft" "$H/.claude/skills" "$H/.claude/agents" \
             "$H/.claude/commands" "$H/.claude/hooks"; do
      [[ -e "$d" ]] && find "$d" \( -type f -o -type l \) -print0
    done
    find "$H/.claude" -maxdepth 1 -type f \( -name 'settings*' -o -name 'CLAUDE.md' \) -print0
    find "$H/.claude/plugins" -maxdepth 1 -type f -name '*.json' ! -name 'plugin-directory-cache*' -print0
  } | while IFS= read -r -d '' f; do
    if [[ -L "$f" ]]; then printf '%s\tlink:%s\n' "$f" "$(readlink "$f")"
    else printf '%s\t%s\n' "$f" "$(shasum -a 256 "$f" | cut -c1-16)"; fi
  done | LC_ALL=C sort
}

case "${1:-}" in
  snapshot) snapshot > "$2"; wc -l < "$2" | tr -d ' ' ;;
  check)
    rc=0; tmpf="$(mktemp)"
    if ! diff <(cat "$2") <(snapshot) > "$tmpf"; then
      echo "CHANGED under real config:"; cat "$tmpf"; rc=1
    fi
    rm -f "$tmpf"
    if ls "$H/.claude/projects" | grep -i 'sandbox' ; then echo "LEAK: sandbox session in real ~/.claude/projects"; rc=1; fi
    [[ $rc == 0 ]] && echo "real config unchanged"
    exit $rc ;;
  *) echo "usage: realhome-guard.sh snapshot|check <file>" >&2; exit 2 ;;
esac
