"""Assign item IDs, extract zips via tools/extract.sh, hash every file.
Writes private/inventory.json.
Run: AGENTIC_SOURCE=<raw source dir> python3 -I tools/inventory.py
The source dir holds `Library/` plus one resources dir with Guides/, Curated/, Setup/.
"""
import hashlib, json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(os.environ["AGENTIC_SOURCE"]).expanduser()
LIB = SRC / "Library"
RES = next(p for p in SRC.iterdir() if p.is_dir() and (p / "Guides").is_dir())


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def files_in(d):
    return sorted(p for p in d.rglob("*") if p.is_file() and p.name != ".DS_Store")


def items():
    for i, d in enumerate(sorted(p for p in LIB.iterdir() if p.is_dir()), 1):
        yield f"L{i:02d}", d.name, d
    for i, f in enumerate(sorted((RES / "Guides").glob("*.md")), 1):
        yield f"G{i:02d}", f.stem, f
    for i, d in enumerate(sorted(p for p in (RES / "Curated").iterdir() if p.is_dir()), 1):
        yield f"C{i:02d}", d.name, d
    for i, d in enumerate(sorted(p for p in (RES / "Setup").iterdir() if p.is_dir()), 1):
        yield f"S{i:02d}", d.name, d


def main():
    out = []
    for iid, title, path in items():
        fs = [path] if path.is_file() else files_in(path)
        multi = sum(1 for f in fs if f.suffix == ".zip") > 1
        recs = []
        for f in fs:
            rec = {"path": str(f.relative_to(SRC)), "sha256": sha(f), "size": f.stat().st_size}
            if f.suffix == ".zip":
                sub = f"{iid}/{f.stem}" if multi else iid
                r = subprocess.run(["bash", str(ROOT / "tools/extract.sh"), str(f), sub],
                                   capture_output=True, text=True)
                if r.returncode != 0:
                    rec["extract_error"] = r.stderr.strip()
                else:
                    j = json.loads(r.stdout.strip().splitlines()[-1])
                    rec.update(entry_count=int(j["entries"]), extracted=f"work/extracted/{sub}",
                               git_remote=j["git_remote"] or None)
            recs.append(rec)
        out.append({"id": iid, "title": title, "files": recs})
        print(iid, title[:60], len(recs), file=sys.stderr)
    (ROOT / "private/inventory.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
