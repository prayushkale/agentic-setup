#!/usr/bin/env bash
# e2e-core.sh: install the core pack for real into an empty sandbox HOME, run doctor, measure
# startup tokens, uninstall everything, and check the sandbox HOME is back to its pre-install state.
#
#   tools/e2e-core.sh [--dry-run] [--keep] [--npx <spec>]
#     --dry-run     stop after the install dry-run (nothing is installed)
#     --keep        leave sandbox/e2e in place at the end (default: destroy it)
#     --npx <spec>  test a package instead of this checkout: run `npx -y --package <spec> agentic-setup` (a tarball path or
#                   agentic-setup@<version>) with its bundled assets; no build, no AGENTIC_SETUP_ROOT
#
# Logs go to sandbox/e2e-logs/ (kept after the sandbox is destroyed).
# The sandbox PATH holds only the sandbox's npm prefix and ~/.local/bin, a shim dir with
# claude/node/npm/npx, and the system dirs, so tools already in the real ~/.local/bin do not
# make items look installed. NPM_CONFIG_PREFIX points into the sandbox, so `npm i -g` stays there.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SB="$REPO/tools/sandbox.sh"
NAME=e2e
PROFILE="$REPO/tools/e2e-core-profile.yaml"
LOGS="$REPO/sandbox/e2e-logs"
DRY=0; KEEP=0; NPX=""
while (($#)); do
  case "$1" in
    --dry-run) DRY=1 ;;
    --keep) KEEP=1 ;;
    --npx) NPX="${2:?--npx needs a spec}"; shift ;;
    *) echo "usage: e2e-core.sh [--dry-run] [--keep] [--npx <spec>]" >&2; exit 2 ;;
  esac
  shift
done

GUARD="$REPO/sandbox/guard-before.tsv"
[[ -f "$GUARD" ]] || { echo "e2e: $GUARD missing; take it first: tools/realhome-guard.sh snapshot $GUARD" >&2; exit 1; }

t0=$SECONDS
step() { printf '\n== %s (t+%ss)\n' "$*" $((SECONDS - t0)); }

root="$("$SB" new "$NAME" --empty)"
home="$root/home"
prefix="$home/.npm-global"
shim="$root/bin"
mkdir -p "$shim" "$LOGS"
rm -f "$LOGS"/*
for b in claude node npm npx; do
  p="$(command -v "$b")" || { echo "e2e: $b not found" >&2; exit 1; }
  ln -s "$p" "$shim/$b"
done

sbpath="$prefix/bin:$home/.local/bin:$shim:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
case "$prefix$sbpath$REPO$NPX" in *" "*) echo "e2e: paths must not contain spaces" >&2; exit 1 ;; esac
if [[ -n "$NPX" ]]; then
  export SANDBOX_EXTRA_ENV="NPM_CONFIG_PREFIX=$prefix PATH=$sbpath"
  cli() { "$SB" run "$NAME" -- npx -y --package "$NPX" agentic-setup "$@"; }
else
  export SANDBOX_EXTRA_ENV="NPM_CONFIG_PREFIX=$prefix PATH=$sbpath AGENTIC_SETUP_ROOT=$REPO"
  cli() { "$SB" run "$NAME" -- node "$REPO/installer/dist/cli.js" "$@"; }
  step "build"
  (cd "$REPO/installer" && npm run build >/dev/null)
fi

step "npm prefix inside the sandbox"
got="$("$SB" run "$NAME" -- npm config get prefix)"
echo "$got"
# Safeguard for `npm i -g` and `uv tool install`: global installs must land in the sandbox.
[[ "$got" == "$prefix" ]] || { echo "e2e: npm prefix is $got, expected $prefix" >&2; exit 1; }

# Measure from a dir outside the repo, so no project CLAUDE.md up the tree loads.
tokdir="$(mktemp -d)"
step "startup tokens, empty home (baseline)"
"$REPO/tools/startup-tokens.sh" "$NAME" -C "$tokdir" | tee "$LOGS/startup-tokens-empty.json" || true

settings="$home/.claude/settings.json"
before_hash=absent; [[ -e "$settings" ]] && before_hash="$(shasum -a 256 "$settings" | cut -d' ' -f1)"

step "install --dry-run"
cli install --dry-run --yes --agents claude-code,generic --profile "$PROFILE" | tee "$LOGS/dry-run.txt"
# Refuse to go on if the dry-run lists no commands, or any would write outside the sandbox HOME.
# The gate does not match `npm i -g` / `uv tool install`: the NPM_CONFIG_PREFIX assert above
# (and HOME/XDG_* from sandbox.sh run) is the safeguard for those.
if ! python3 -I "$REPO/tools/e2e-gate.py" "$LOGS/dry-run.txt" "$HOME" "$root"; then
  echo "e2e: dry-run gate failed (above); not installing" >&2
  exit 1
fi
[[ $DRY == 1 ]] && { echo "dry run only; sandbox kept at $root"; exit 0; }

step "install"
set +e
cli install --yes --agents claude-code,generic --profile "$PROFILE" 2>&1 | tee "$LOGS/install.txt"
install_rc=${PIPESTATUS[0]}
set -e
echo "install exit: $install_rc"

step "doctor"
set +e
cli doctor 2>&1 | tee "$LOGS/doctor.txt"
doctor_rc=${PIPESTATUS[0]}
set -e
echo "doctor exit: $doctor_rc"

step "startup tokens, after install"
"$REPO/tools/startup-tokens.sh" "$NAME" -C "$tokdir" | tee "$LOGS/startup-tokens.json" || true

core_sum="$(cli list --pack core | sed -n 's/.*≈+\([0-9]*\) tok.*/\1/p' | awk '{s+=$1} END {print s}')"
tok() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("startup_tokens","?"))' "$1" 2>/dev/null || echo '?'; }
base="$(tok "$LOGS/startup-tokens-empty.json")"; startup="$(tok "$LOGS/startup-tokens.json")"
printf 'core token_cost sum: %s\nmeasured startup_tokens: empty home %s, after install %s (delta %s)\nreference (current real setup): 18200\n' \
  "$core_sum" "$base" "$startup" "$( [[ "$base$startup" =~ ^[0-9]+$ ]] && echo $((startup - base)) || echo '?')" | tee "$LOGS/tokens.txt"

step "uninstall --all"
cli uninstall --all 2>&1 | tee "$LOGS/uninstall.txt"

step "post-uninstall checks"
rc=0
state="$home/.agentic-setup/state.json"
[[ -e "$state" ]] && cp "$state" "$LOGS/state-after-uninstall.json"
python3 -I - "$state" <<'PY' || rc=1
import json, os, sys
p = sys.argv[1]
if not os.path.exists(p): print("state.json: absent"); sys.exit(0)
items = json.load(open(p)).get("items", {})
print(f"state.json items: {len(items)} {sorted(items)}")
sys.exit(1 if items else 0)
PY
after_hash=absent; [[ -e "$settings" ]] && after_hash="$(shasum -a 256 "$settings" | cut -d' ' -f1)"
if [[ "$after_hash" == "$before_hash" ]]; then echo "settings.json: same as before install ($before_hash)"
else echo "settings.json: CHANGED (before $before_hash, after $after_hash)"; cp "$settings" "$LOGS/settings-after-uninstall.json"; rc=1; fi
(cd "$home" && find . -maxdepth 3 -not -path './.npm/*' -not -path './.cache/*' -not -path './Library/*' | LC_ALL=C sort) > "$LOGS/home-after-uninstall.txt"

step "real HOME guard"
"$REPO/tools/realhome-guard.sh" check "$GUARD" || rc=1

rm -rf "$tokdir"
[[ $KEEP == 1 ]] || "$SB" destroy "$NAME"
step "done: install=$install_rc doctor=$doctor_rc checks=$rc"
[[ $install_rc == 0 && $doctor_rc == 0 && $rc == 0 ]]
