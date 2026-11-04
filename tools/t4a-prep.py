"""Prepare a nifty-chronicles clone for one T4-a arm, then commit.
python3 -I tools/t4a-prep.py base|serena|graft REPO
All arms: drop remote MCP servers and the graft statusLine. base/serena: remove graft entirely
(hooks, MCP entry, skill, helpers, AGENTS.md section). graft: keep its hooks + MCP entry.
"""
import json, os, re, shutil, subprocess, sys
arm, repo = sys.argv[1], os.path.abspath(sys.argv[2])
p = lambda *a: os.path.join(repo, *a)
s = json.load(open(p(".claude", "settings.json")))
s.pop("statusLine", None); s.pop("subagentStatusLine", None)
mcp = json.load(open(p(".mcp.json")))
mcp["mcpServers"] = {k: v for k, v in mcp["mcpServers"].items() if k == "graft" and arm == "graft"}
if arm != "graft":
    s.pop("hooks", None)
    for d in (p(".claude", "skills", "graft"),): shutil.rmtree(d, ignore_errors=True)
    for f in os.listdir(p(".claude", "helpers")):
        if f.startswith("graft-"): os.remove(p(".claude", "helpers", f))
    a = open(p("AGENTS.md")).read()
    open(p("AGENTS.md"), "w").write(re.sub(r"<!-- graft:start -->.*?<!-- graft:end -->\n?", "", a, flags=re.S))
json.dump(s, open(p(".claude", "settings.json"), "w"), indent=2)
if mcp["mcpServers"]: json.dump(mcp, open(p(".mcp.json"), "w"), indent=2)
else: os.remove(p(".mcp.json"))
env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@x", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@x")
subprocess.run(["git", "-C", repo, "add", "-A"], check=True)
subprocess.run(["git", "-C", repo, "commit", "-qm", f"t4a {arm} arm config"], check=True, env=env)
print(json.dumps({"arm": arm, "settings_keys": sorted(s), "mcp": sorted(mcp["mcpServers"]), "graft_in_agents_md": "graft:start" in open(p("AGENTS.md")).read()}))
