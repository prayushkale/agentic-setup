#!/usr/bin/env bash
# sandbox.sh: throwaway HOME dirs for Phase 4 trials.
#
#   tools/sandbox.sh new <name>            create sandbox/<name>/{home,work} with a minimal baseline
#   tools/sandbox.sh new <name> --empty    same, but home holds only the Keychains link (no baseline)
#   tools/sandbox.sh destroy <name>        delete sandbox/<name>
#   tools/sandbox.sh run <name> [-C dir] -- <cmd...>
#                                          run cmd with HOME/CODEX_HOME/XDG_* inside the sandbox
#   tools/sandbox.sh path <name>           print the sandbox root
#
# Baseline copied in: ~/.agents (whole), ~/.claude/{CLAUDE.md,skills}, the superpowers
# plugin, and a filtered settings.json (no autoMode text, no statusLine, no other plugins).
# Symlinks that point into the real ~/.agents or ~/.claude are rewritten to the sandbox copy;
# links that point anywhere else are dropped. Auth: macOS keeps the Claude login in the user
# keychain, so home/Library/Keychains is a symlink to the real keychain dir (nothing else
# under the real HOME is linked).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX_ROOT="${SANDBOX_ROOT:-$REPO/sandbox}"
REAL_HOME="${REAL_HOME:-$HOME}"

die() { echo "sandbox.sh: $*" >&2; exit 1; }

check_name() {
  [[ "${1:-}" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]] || die "bad name '${1:-}' (use [a-z0-9._-])"
  [[ "$1" != fixtures && "$1" != keys ]] || die "'$1' is reserved"
}

root_of() { echo "$SANDBOX_ROOT/$1"; }

# Rewrite symlinks under $1: targets inside REAL_HOME/.agents or REAL_HOME/.claude point at
# the sandbox copy; relative links that stay inside the sandbox are kept; anything else goes.
fix_links() {
  local dir="$1" home="$2" link target
  while IFS= read -r -d '' link; do
    target="$(readlink "$link")"
    case "$target" in
      "$REAL_HOME/.agents"*) ln -sfn "$home/.agents${target#"$REAL_HOME/.agents"}" "$link" ;;
      "$REAL_HOME/.claude"*) ln -sfn "$home/.claude${target#"$REAL_HOME/.claude"}" "$link" ;;
      /*) rm "$link" ;;
      *) ;; # relative: resolves inside the copied tree
    esac
  done < <(find "$dir" -type l -print0)
}

cmd_new() {
  check_name "$1"
  local root home; root="$(root_of "$1")"; home="$root/home"
  [[ ! -e "$root" ]] || die "$root already exists (destroy it first)"
  case "${2:-}" in
    "") ;;
    --empty)
      mkdir -p "$home/Library" "$root/work"
      ln -s "$REAL_HOME/Library/Keychains" "$home/Library/Keychains"
      echo "$root"; return ;;
    *) die "new: unknown flag '$2'" ;;
  esac
  mkdir -p "$home/.claude/plugins/cache" "$home/.claude/plugins/marketplaces" \
           "$home/.codex" "$home/.config" "$home/.cache" "$home/.local/share" \
           "$home/Library" "$root/work"

  cp -R "$REAL_HOME/.agents" "$home/.agents"
  cp "$REAL_HOME/.claude/CLAUDE.md" "$home/.claude/CLAUDE.md"
  cp -R "$REAL_HOME/.claude/skills" "$home/.claude/skills"

  local sp="$REAL_HOME/.claude/plugins"
  cp -R "$sp/cache/superpowers-marketplace" "$home/.claude/plugins/cache/"
  cp -R "$sp/marketplaces/superpowers-marketplace" "$home/.claude/plugins/marketplaces/"
  python3 -I - "$sp" "$home/.claude/plugins" "$REAL_HOME/.claude" "$home/.claude" <<'PY'
import json, sys
src, dst, old, new = sys.argv[1:]
inst = json.load(open(f"{src}/installed_plugins.json"))
inst["plugins"] = {k: v for k, v in inst["plugins"].items() if k.startswith("superpowers@")}
km = json.load(open(f"{src}/known_marketplaces.json"))
km = {k: v for k, v in km.items() if k == "superpowers-marketplace"}
for name, obj in (("installed_plugins.json", inst), ("known_marketplaces.json", km)):
    open(f"{dst}/{name}", "w").write(json.dumps(obj, indent=2).replace(old, new))
PY

  python3 -I - "$REAL_HOME/.claude/settings.json" "$home/.claude/settings.json" "$REPO" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
keep = ("model", "hooks", "extraKnownMarketplaces", "modelSettings")
out = {k: s[k] for k in keep if k in s}
out["enabledPlugins"] = {k: v for k, v in s.get("enabledPlugins", {}).items() if k.startswith("superpowers@")}
# Trial dirs live under the repo; keep its own agent rules out of trial context.
out["claudeMdExcludes"] = [f"{sys.argv[3]}/CLAUDE.md", f"{sys.argv[3]}/AGENTS.md"]
out["env"] = {"DO_NOT_TRACK": "1", "DISABLE_AUTOUPDATER": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}
open(sys.argv[2], "w").write(json.dumps(out, indent=2) + "\n")
PY

  echo '{"hasCompletedOnboarding":true}' > "$home/.claude.json"
  ln -s "$REAL_HOME/Library/Keychains" "$home/Library/Keychains"

  fix_links "$home/.agents" "$home"
  fix_links "$home/.claude" "$home"
  echo "$root"
}

cmd_destroy() {
  check_name "$1"
  local root; root="$(root_of "$1")"
  [[ -d "$root" ]] || die "no sandbox $1"
  case "$(cd "$root" && pwd -P)" in "$(cd "$SANDBOX_ROOT" && pwd -P)"/*) ;; *) die "refusing: $root is outside $SANDBOX_ROOT" ;; esac
  rm -rf "$root"
}

cmd_run() {
  check_name "$1"; local name="$1"; shift
  local root home cwd; root="$(root_of "$name")"; home="$root/home"; cwd="$root/work"
  [[ -d "$home" ]] || die "no sandbox $name"
  if [[ "${1:-}" == "-C" ]]; then cwd="$2"; shift 2; fi
  [[ "${1:-}" == "--" ]] && shift
  [[ $# -gt 0 ]] || die "run: no command"
  cd "$cwd"
  # SANDBOX_FLAG_FETCH=1 drops DO_NOT_TRACK so Claude Code can fetch feature flags (the advisor
  # tool needs them; any value of DO_NOT_TRACK=1/DISABLE_TELEMETRY/NONESSENTIAL_TRAFFIC blocks it).
  local dnt="DO_NOT_TRACK=1"; [[ "${SANDBOX_FLAG_FETCH:-}" == 1 ]] && dnt="SANDBOX_FLAG_FETCH=1"
  exec env -i \
    HOME="$home" CODEX_HOME="$home/.codex" \
    XDG_CONFIG_HOME="$home/.config" XDG_CACHE_HOME="$home/.cache" XDG_DATA_HOME="$home/.local/share" \
    PATH="$REAL_HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    USER="${USER:-$(id -un)}" LOGNAME="${USER:-$(id -un)}" SHELL=/bin/zsh TERM=dumb LANG=en_US.UTF-8 \
    "$dnt" NO_UPDATE_NOTIFIER=1 npm_config_update_notifier=false SANDBOX_NAME="$name" ${SANDBOX_EXTRA_ENV:-} \
    "$@"
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    new) cmd_new "${1:-}" "${2:-}" ;;
    destroy) cmd_destroy "${1:-}" ;;
    run) mkdir -p "$(root_of "${1:-x}")/tmp" 2>/dev/null || true; cmd_run "$@" ;;
    path) check_name "${1:-}"; root_of "$1" ;;
    *) die "usage: sandbox.sh new|destroy|run|path <name>" ;;
  esac
}
main "$@"
