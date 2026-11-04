"""Build a fixture git repo with planted bugs; write the answer key OUTSIDE the repo.

python3 -I plant.py --base DIR [--overlay DIR] --manifest bugs.json --plant B1,B3|all|none
                    --out NEWDIR --key KEYFILE [--branch NAME] [--extra DIR ...]
Without --branch, base+overlay+bugs land in one commit on main (build trials).
With --branch, base is main and overlay+bugs is one commit on NAME (review trials: the diff).
--extra copies more files (spec, plan) into the final commit.
Own re-implementation of the planted-bug method; the key never enters the tree.
"""
import argparse, json, os, shutil, stat, subprocess, sys

def sh(cwd, *a):
    env = dict(os.environ, GIT_AUTHOR_DATE="2026-11-01T10:00:00Z", GIT_COMMITTER_DATE="2026-11-01T10:00:00Z",
               GIT_AUTHOR_NAME="fixture", GIT_AUTHOR_EMAIL="fixture@example.test",
               GIT_COMMITTER_NAME="fixture", GIT_COMMITTER_EMAIL="fixture@example.test")
    subprocess.run(["git", *a], cwd=cwd, check=True, env=env, stdout=subprocess.DEVNULL)

def line_of(path, needle):
    text = open(path).read()
    i = text.find(needle)
    if i < 0: sys.exit(f"locator not found in {path}: {needle!r}")
    return text.count("\n", 0, i) + 1

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True); ap.add_argument("--overlay"); ap.add_argument("--manifest", required=True)
    ap.add_argument("--plant", default="all"); ap.add_argument("--out", required=True); ap.add_argument("--key", required=True)
    ap.add_argument("--branch"); ap.add_argument("--extra", action="append", default=[])
    a = ap.parse_args()
    out, key = os.path.abspath(a.out), os.path.abspath(a.key)
    if os.path.exists(out): sys.exit(f"{out} exists")
    if key.startswith(out + os.sep): sys.exit("key must live outside the fixture repo")
    m = json.load(open(a.manifest))
    want = [b["id"] for b in m["bugs"]] if a.plant == "all" else ([] if a.plant == "none" else a.plant.split(","))
    shutil.copytree(a.base, out)
    sh(out, "init", "-q", "-b", "main")
    if a.branch:
        sh(out, "add", "-A"); sh(out, "commit", "-qm", "tally 0.3.0"); sh(out, "checkout", "-q", "-b", a.branch)
    if a.overlay: shutil.copytree(a.overlay, out, dirs_exist_ok=True)
    for ex in a.extra: shutil.copytree(ex, out, dirs_exist_ok=True)
    planted = []
    for b in m["bugs"]:
        if b["id"] not in want: continue
        p = os.path.join(out, b["file"]); text = open(p).read()
        for old, new in b["patches"]:
            if text.count(old) != 1: sys.exit(f"{b['id']}: patch target must occur once in {b['file']}")
            text = text.replace(old, new)
        open(p, "w").write(text)
        planted.append({k: b[k] for k in ("id", "kind", "file", "keywords", "failure")} | {"line": line_of(p, b["locator"])})
    def located(items):
        return [{"id": i["id"], "file": i["file"], "line": line_of(os.path.join(out, i["file"]), i["locator"]), "why_safe": i["why_safe"]} for i in items]
    sh(out, "add", "-A"); sh(out, "commit", "-qm", "billing v2: split, discounts, reminders, rendering" if a.branch else "tally 0.4.0-dev")
    os.makedirs(os.path.dirname(key), exist_ok=True)
    with open(key, "w") as f:
        json.dump({"repo": out, "bugs": planted, "decoys": located(m.get("decoys", [])), "traps": located(m.get("traps", []))}, f, indent=2)
    os.chmod(key, stat.S_IRUSR | stat.S_IWUSR)
    print(json.dumps({"repo": out, "key": key, "planted": [b["id"] for b in planted]}))

main()
