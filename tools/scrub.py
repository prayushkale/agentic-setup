"""Remove the upstream course brand from public files. Idempotent.
Rules live in private/scrub-rules.json ([[regex, replacement], ...]) so the brand never lands in git.
Run: python3 -I tools/scrub.py [path ...]
  No paths: scrubs catalog/cards/*.md. Paths may be files or dirs (dirs are walked; non-text files skipped).
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_rules_file = ROOT / "private/scrub-rules.json"
RULES = json.loads(_rules_file.read_text()) if _rules_file.exists() else []


def scrub(text: str) -> str:
    for pat, rep in RULES:
        text = re.sub(pat, rep, text)
    return text


def targets(args):
    if not args:
        return sorted((ROOT / "catalog/cards").glob("*.md"))
    out = []
    for a in args:
        p = Path(a)
        if p.is_dir():
            out += sorted(f for f in p.rglob("*") if f.is_file())
        elif p.is_file():
            out.append(p)
        else:
            sys.exit(f"scrub: no such path: {a}")
    return out


def main(args):
    n = 0
    for p in targets(args):
        try:
            s = p.read_text()
        except UnicodeDecodeError:
            continue
        t = scrub(s)
        if t != s:
            p.write_text(t)
            n += 1
            print(f"scrubbed {p}")
    print(f"scrubbed {n} {'files' if args else 'cards'} ({len(RULES)} rules)")


if __name__ == "__main__":
    main(sys.argv[1:])
