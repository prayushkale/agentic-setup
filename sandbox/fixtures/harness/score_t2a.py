"""Hidden grader for T2-a (export task). Never shown to the agent.

python3 -I score_t2a.py REPO [TREE_SHA]
Grades a COPY: REPO's working tree, or the git tree object TREE_SHA (a Stop snapshot).
Outcomes O1..O6 = R1..R6 of the spec, plus whether `npm test` is green.
"""
import json, os, re, shutil, subprocess, sys, tempfile, math

DATA = {"taxRate": 0.1,
        "customers": [{"id": "a", "name": "Plain Co", "email": "p@x.test"},
                      {"id": "b", "name": 'Smith, "Jo" & Sons', "email": "s@x.test"}],
        "invoices": [{"id": "X-1", "customerId": "a", "issued": "2026-01-01", "dueDays": 10,
                      "items": [{"description": "a", "qty": 3, "unitCents": 333}]},
                     {"id": "X-2", "customerId": "b", "issued": "2026-01-01", "dueDays": 10, "discount": {"percent": 15},
                      "items": [{"description": "b", "qty": 1, "unitCents": 10001}, {"description": "c", "qty": 2, "unitCents": 5}]}]}

def jsround(x): return math.floor(x + 0.5)
def total(inv, tax):
    sub = sum(i["qty"] * i["unitCents"] for i in inv["items"])
    pct = (inv.get("discount") or {}).get("percent", 0)
    return jsround(jsround(sub * (100 - pct) / 100) * (1 + tax))
def fmt(c): return f"{'-' if c < 0 else ''}{abs(c)//100}.{abs(c)%100:02d}"
def q(s): return '"' + s.replace('"', '""') + '"' if ("," in s or '"' in s) else s

def run(cwd, *args):
    p = subprocess.run(["node", *args], cwd=cwd, capture_output=True, text=True, timeout=30)
    return p.returncode, p.stdout, p.stderr

def grade(d):
    names = {c["id"]: c["name"] for c in DATA["customers"]}
    json.dump(DATA, open(os.path.join(d, ".hidden-data.json"), "w"))
    out = {}
    try:
        rc, so, _ = run(d, "src/cli.ts", "export", "--format", "json", ".hidden-data.json")
        exp = [{"id": i["id"], "customer": names[i["customerId"]], "totalCents": total(i, DATA["taxRate"])} for i in DATA["invoices"]]
        out["O1_json"] = rc == 0 and json.loads(so) == exp
    except Exception: out["O1_json"] = False
    try:
        rc, so, _ = run(d, "src/cli.ts", "export", "--format", "csv", ".hidden-data.json")
        exp = ["id,customer,total"] + [f"{q(i['id'])},{q(names[i['customerId']])},{fmt(total(i, DATA['taxRate']))}" for i in DATA["invoices"]]
        out["O2_csv"] = rc == 0 and so.strip().splitlines() == exp
    except Exception: out["O2_csv"] = False
    try:
        ok = True
        for args in (["--format", "xml", ".hidden-data.json"], [".hidden-data.json"]):
            rc, so, se = run(d, "src/cli.ts", "export", *args)
            ok = ok and rc == 2 and so == "" and se.lower().lstrip().startswith("unknown format")
        out["O3_bad_format"] = ok
    except Exception: out["O3_bad_format"] = False
    readme = open(os.path.join(d, "README.md")).read() if os.path.exists(os.path.join(d, "README.md")) else ""
    sec = re.search(r"^## +Export\b(.*?)(?=^## |\Z)", readme, re.S | re.M)
    s = sec.group(1) if sec else ""
    out["O4_readme"] = bool(sec) and "json" in s.lower() and "csv" in s.lower() and bool(re.search(r"\b2\b", s)) and "exit" in s.lower()
    try:
        rc, so, _ = run(d, "-e", "import('./src/money.ts').then(m=>{const c=[[1000,3],[1,4],[999,7],[0,2],[1001,10]];"
                     "console.log(JSON.stringify(c.map(([t,n])=>{const r=m.split(t,n);return [r, r.reduce((a,b)=>a+b,0)===t]})))})")
        res = json.loads(so)
        out["O5_split"] = res[0][0] == [334, 333, 333] and all(ok for _, ok in res)
    except Exception: out["O5_split"] = False
    cl = open(os.path.join(d, "CHANGELOG.md")).read() if os.path.exists(os.path.join(d, "CHANGELOG.md")) else ""
    un = re.search(r"^## +Unreleased\b(.*?)(?=^## |\Z)", cl, re.S | re.M)
    u = (un.group(1) if un else "").lower()
    out["O6_changelog"] = "export" in u and any(w in u for w in ("split", "rounding", "cent"))
    p = subprocess.run(["npm", "test"], cwd=d, capture_output=True, text=True, timeout=120)
    out["suite_green"] = p.returncode == 0
    out["outcomes_met"] = sum(v for k, v in out.items() if k.startswith("O"))
    return out

def main():
    repo = os.path.abspath(sys.argv[1]); tree = sys.argv[2] if len(sys.argv) > 2 else None
    with tempfile.TemporaryDirectory() as t:
        d = os.path.join(t, "copy")
        if tree:
            os.makedirs(d)
            arc = subprocess.run(["git", "-C", repo, "archive", "--format=tar", tree], capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", d], input=arc, check=True)
        else:
            shutil.copytree(repo, d, ignore=shutil.ignore_patterns(".git", "node_modules"))
        print(json.dumps(grade(d)))

main()
