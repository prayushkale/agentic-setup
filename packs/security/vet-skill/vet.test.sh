#!/usr/bin/env bash
# Tests for vet.sh using a fake scanner (SKILLSPECTOR=<fake>). No network.
set -uo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; T="$(mktemp -d)"; fail=0
ok() { echo "ok - $1"; }; no() { echo "not ok - $1"; fail=1; }
mkdir -p "$T/skill"; echo '---\nname: s\n---' > "$T/skill/SKILL.md"
fake() { # fake <exit> <json-or-empty>
  cat > "$T/fake" <<F
#!/usr/bin/env bash
out=""; while [[ \$# -gt 0 ]]; do [[ "\$1" == "-o" ]] && out="\$2"; shift; done
[[ -n '$2' ]] && printf '%s' '$2' > "\$out"
echo "\$PWD" > "$T/scanned-from"
exit $1
F
  chmod +x "$T/fake"; }
run() { SKILLSPECTOR="$T/fake" "$D/vet.sh" "$T/skill" > "$T/out" 2>&1; echo $?; }
fake 0 '{"risk_assessment":{"recommendation":"SAFE","score":3},"findings":[]}'
[[ "$(run)" == 0 ]] && grep -q "VERDICT SAFE" "$T/out" && ok "SAFE exits 0" || no "SAFE exits 0: $(cat "$T/out")"
fake 0 '{"risk_assessment":{"recommendation":"CAUTION","score":40},"findings":[{"rule_id":"X1","severity":"medium","message":"shell=True"}]}'
[[ "$(run)" == 10 ]] && grep -q "shell=True" "$T/out" && ok "CAUTION exits 10 and lists findings" || no "CAUTION: $(cat "$T/out")"
fake 1 '{"risk_assessment":{"recommendation":"DO_NOT_INSTALL","score":90},"findings":[]}'
[[ "$(run)" == 20 ]] && grep -q "VERDICT DO_NOT_INSTALL" "$T/out" && ok "DO_NOT_INSTALL (scanner exit 1) exits 20" || no "DNI: $(cat "$T/out")"
fake 2 ''
[[ "$(run)" == 3 ]] && grep -q "VERDICT ERROR" "$T/out" && ok "scanner error fails closed" || no "error: $(cat "$T/out")"
fake 0 'not json'
[[ "$(run)" == 3 ]] && ok "unparseable report fails closed" || no "unparseable: $(cat "$T/out")"
fake 0 '{"risk_assessment":{}}'
[[ "$(run)" == 3 ]] && ok "missing recommendation fails closed" || no "missing rec: $(cat "$T/out")"
fake 0 '{"risk_assessment":{"recommendation":"SAFE","score":0}}'
run >/dev/null; [[ "$(cat "$T/scanned-from")" != "$T/skill" ]] && ok "scanner does not run inside the skill dir" || no "ran inside skill dir"
SKILLSPECTOR="$T/fake" "$D/vet.sh" "$T/nope" >/dev/null 2>&1; [[ $? == 2 ]] && ok "missing skill dir is a usage error" || no "missing dir"
rm -rf "$T"; exit $fail
