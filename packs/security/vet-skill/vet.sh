#!/usr/bin/env bash
# vet.sh <skill-dir> [report.json]
# Static pre-install gate: NVIDIA SkillSpector (pin v2.13.3) with --no-llm. Fails closed.
#   exit 0  SAFE             install
#   exit 10 CAUTION          show findings; install only after the user says yes
#   exit 20 DO_NOT_INSTALL   refuse; never "fix" it into passing
#   exit 3  ERROR            scanner failed or report unreadable: do not install
#   exit 2  usage
# Runs the scanner from a temp dir, never from inside the skill, and never executes the skill.
set -uo pipefail
skill="${1:-}"; [[ -n "$skill" && -d "$skill" ]] || { echo "usage: vet.sh <skill-dir> [report.json]" >&2; exit 2; }
skill="$(cd "$skill" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
report="${2:-$work/report.json}"
( cd "$work" && "${SKILLSPECTOR:-skillspector}" scan "$skill" --no-llm --format json -o "$report" ) > "$work/scan.log" 2>&1
rc=$?
if [[ $rc -ge 2 ]]; then echo "VERDICT ERROR (scanner exit $rc)"; tail -5 "$work/scan.log"; exit 3; fi
python3 -I - "$report" <<'PY'
import json, sys
try:
    r = json.load(open(sys.argv[1]))
    ra = r["risk_assessment"]; rec = ra["recommendation"]
except Exception as e:
    print(f"VERDICT ERROR (report unreadable: {e.__class__.__name__})"); sys.exit(3)
codes = {"SAFE": 0, "CAUTION": 10, "DO_NOT_INSTALL": 20}
if rec not in codes: print(f"VERDICT ERROR (unknown recommendation {rec!r})"); sys.exit(3)
print(f"VERDICT {rec} score={ra.get('score', ra.get('risk_score', '?'))}")
for f in (r.get("findings") or [])[:15]:
    loc = f.get("file") or f.get("location") or ""
    print(f"- [{f.get('severity', '?')}] {f.get('rule_id') or f.get('id') or ''} {f.get('message') or f.get('title') or f.get('description') or ''} {loc}".rstrip())
sys.exit(codes[rec])
PY
