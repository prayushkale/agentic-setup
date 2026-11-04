#!/usr/bin/env bash
# Tests for tools/sandbox.sh against a fake REAL_HOME (no network, no claude).
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"; T="$(mktemp -d)"; fail=0
ok() { echo "ok - $1"; }; no() { echo "not ok - $1"; fail=1; }
H="$T/realhome"; mkdir -p "$H/.agents/skills/a" "$H/.claude/skills" "$H/.claude/plugins/cache/superpowers-marketplace/superpowers/7.0.0" \
  "$H/.claude/plugins/marketplaces/superpowers-marketplace" "$H/Library/Keychains"
echo s > "$H/.agents/skills/a/SKILL.md"; echo '@~/.agents/AGENTS.md' > "$H/.claude/CLAUDE.md"
ln -s "$H/.agents/skills/a" "$H/.claude/skills/a"; ln -s ../../.agents/skills/a "$H/.claude/skills/rel"; ln -s /etc "$H/.claude/skills/ext"
echo '{"model":"opusplan","autoMode":{"environment":["secret-ish"]},"statusLine":{"x":1},"enabledPlugins":{"superpowers@superpowers-marketplace":true,"other@x":true},"hooks":{}}' > "$H/.claude/settings.json"
echo "{\"version\":2,\"plugins\":{\"superpowers@superpowers-marketplace\":[{\"installPath\":\"$H/.claude/plugins/cache/x\"}],\"other@x\":[]}}" > "$H/.claude/plugins/installed_plugins.json"
echo "{\"superpowers-marketplace\":{\"installLocation\":\"$H/.claude/plugins/marketplaces/superpowers-marketplace\"},\"other\":{}}" > "$H/.claude/plugins/known_marketplaces.json"
export REAL_HOME="$H" SANDBOX_ROOT="$T/sb"; mkdir -p "$SANDBOX_ROOT"
S="$R/tools/sandbox.sh"
"$S" new t1 >/dev/null && ok "new creates a sandbox" || no "new creates a sandbox"
SH="$SANDBOX_ROOT/t1/home"
[[ "$(readlink "$SH/.claude/skills/a")" == "$SH/.agents/skills/a" ]] && ok "absolute skill links point into the sandbox" || no "absolute skill links point into the sandbox"
[[ -e "$SH/.claude/skills/rel/SKILL.md" ]] && ok "relative links resolve inside the sandbox" || no "relative links resolve inside the sandbox"
[[ ! -e "$SH/.claude/skills/ext" && ! -L "$SH/.claude/skills/ext" ]] && ok "links outside the agent dirs are dropped" || no "links outside the agent dirs are dropped"
grep -q autoMode "$SH/.claude/settings.json" && no "settings drop autoMode" || ok "settings drop autoMode"
grep -q statusLine "$SH/.claude/settings.json" && no "settings drop statusLine" || ok "settings drop statusLine"
grep -q 'other@x' "$SH/.claude/settings.json" "$SH/.claude/plugins/installed_plugins.json" && no "only superpowers plugin kept" || ok "only superpowers plugin kept"
grep -q "$H/.claude" "$SH/.claude/plugins/"*.json && no "plugin paths rewritten" || ok "plugin paths rewritten"
grep -q claudeMdExcludes "$SH/.claude/settings.json" && ok "repo CLAUDE.md excluded" || no "repo CLAUDE.md excluded"
out="$("$S" run t1 -- /bin/sh -c 'echo "$HOME|$CODEX_HOME|${CLAUDECODE:-unset}"')"
[[ "$out" == "$SH|$SH/.codex|unset" ]] && ok "run sets HOME/CODEX_HOME and clears parent env" || no "run env: $out"
"$S" new t1 2>/dev/null && no "new refuses an existing sandbox" || ok "new refuses an existing sandbox"
"$S" new '../evil' 2>/dev/null && no "bad names refused" || ok "bad names refused"
"$S" new keys 2>/dev/null && no "reserved names refused" || ok "reserved names refused"
"$S" destroy t1 && [[ ! -e "$SANDBOX_ROOT/t1" ]] && ok "destroy removes it" || no "destroy removes it"
[[ -f "$H/.agents/skills/a/SKILL.md" && -L "$H/.claude/skills/a" ]] && ok "real home untouched" || no "real home untouched"
rm -rf "$T"; exit $fail
