"""Write a trial-scoped settings JSON (passed with --settings).

python3 -I tools/trial-settings.py OUT.json --sandbox NAME [--gate] [--allow-domain D ...] [--no-os-sandbox]
- OS sandbox on for Bash (seatbelt): no network unless --allow-domain, no escape hatch.
- Unreadable to the agent (Read/Grep/Glob deny rules AND sandbox denyRead): answer keys, fixture
  templates, the research notes, extracted zips, every OTHER sandbox, and the real agent config.
- WebFetch/WebSearch denied. Stop snapshot hook always on; --gate adds the accept-gate hook.
"""
import argparse, json, os
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL = os.path.expanduser("~") if not os.environ.get("REAL_HOME") else os.environ["REAL_HOME"]
ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("--sandbox", required=True)
ap.add_argument("--gate", action="store_true"); ap.add_argument("--allow-domain", action="append", default=[])
ap.add_argument("--no-os-sandbox", action="store_true"); ap.add_argument("--extra-deny", action="append", default=[])
a = ap.parse_args()
sb = os.path.join(REPO, "sandbox")
hidden = [os.path.join(sb, "keys"), os.path.join(sb, "fixtures"), os.path.join(REPO, "private"), os.path.join(REPO, "work"),
          os.path.join(REPO, "tools"), os.path.join(REAL, ".claude"), os.path.join(REAL, ".agents"), os.path.join(REAL, ".codex"),
          os.path.join(REAL, ".graft")] + a.extra_deny
SOURCE = os.environ.get("AGENTIC_SOURCE")  # the research source dir; its Claude scratch dir is hidden too
if SOURCE:
    SOURCE = os.path.abspath(os.path.expanduser(SOURCE))
    hidden += [SOURCE, f"/private/tmp/claude-{os.getuid()}/{SOURCE.replace('/', '-')}"]
else:
    import sys; print("trial-settings: AGENTIC_SOURCE unset; the source dir is not hidden", file=sys.stderr)
hidden += [os.path.join(sb, d) for d in sorted(os.listdir(sb)) if d not in ("keys", "fixtures", a.sandbox)]
deny = ["WebFetch", "WebSearch"]
for p in hidden:
    for tool in ("Read", "Grep", "Glob"):
        deny.append(f"{tool}(/{p}/**)")
hooks = {"Stop": [{"hooks": [{"type": "command", "command": f"bash {REPO}/tools/trial-hooks/snap.sh"}]}]}
if a.gate:
    gate = f"node {REPO}/packs/verification/accept-gate/accept-gate.mjs"
    hooks["Stop"][0]["hooks"].append({"type": "command", "command": gate})
    hooks["PreToolUse"] = [{"matcher": "Write|Edit|MultiEdit", "hooks": [{"type": "command", "command": gate}]}]
# Bash is confined by the OS sandbox below, so allow it outright: background subagents cannot answer prompts.
allow = ["Bash", "Write(//private/tmp/claude-501/-Users-prayushkale-projects-agentic-setup-sandbox-*/**)", "Edit(//private/tmp/claude-501/-Users-prayushkale-projects-agentic-setup-sandbox-*/**)"]
s = {"permissions": {"allow": allow, "deny": deny, "defaultMode": "acceptEdits"}, "hooks": hooks}
if not a.no_os_sandbox:
    s["sandbox"] = {"enabled": True, "failIfUnavailable": True, "autoAllowBashIfSandboxed": True, "allowUnsandboxedCommands": False,
                    "filesystem": {"denyRead": hidden}, "network": {"allowedDomains": a.allow_domain, "allowLocalBinding": False}}
json.dump(s, open(a.out, "w"), indent=2)
print(a.out)
