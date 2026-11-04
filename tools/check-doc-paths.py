#!/usr/bin/env python3 -I
"""Spot-check file paths cited in research docs against work/extracted/<ID>/.

Usage: python3 -I tools/check-doc-paths.py private/research/items/*.md
Collects backticked tokens that look like relative paths (contain '/' or a file
extension), and reports which ones do not resolve under the item's extracted dir
(searched as given, then by suffix match anywhere under the dir).
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRACTED = os.path.join(ROOT, "work", "extracted")
TICK = re.compile(r"`([^`\s]+)`")
EXT = re.compile(r"\.(md|json|sh|mjs|js|ts|tsx|py|yaml|yml|toml|txt|css|html)$")
SKIP_PREFIX = ("~", "/", "http", "$", "-", "npx", "<")


def candidates(text):
    for tok in TICK.findall(text):
        tok = tok.rstrip(".,:;)").lstrip("(")
        tok = re.sub(r":\d+(-\d+)?$", "", tok)  # strip :line refs
        if tok.startswith(SKIP_PREFIX) or "*" in tok or "{" in tok:
            continue
        if "/" in tok or EXT.search(tok):
            yield tok


def index(base):
    files = []
    for dirpath, dirnames, filenames in os.walk(base):
        for n in filenames + dirnames:
            files.append(os.path.relpath(os.path.join(dirpath, n), base))
    return files


def main(paths):
    total_bad = 0
    for doc in paths:
        item = os.path.basename(doc).split("-")[0]
        ids = [item] + (["L04", "L41"] if item == "S01" else [])
        bases = [os.path.join(EXTRACTED, i) for i in ids]
        all_files = [f for b in bases for f in index(b)]
        text = open(doc, encoding="utf-8").read()
        toks = sorted(set(candidates(text)))
        bad = []
        for t in toks:
            t2 = re.sub(r"^work/extracted/[A-Z]\d\d/", "", t).rstrip("/")
            if any(os.path.exists(os.path.join(b, t2)) for b in bases):
                continue
            if any(f == t2 or f.endswith("/" + t2) for f in all_files):
                continue
            bad.append(t)
        total_bad += len(bad)
        print(f"{item}: {len(toks)} path refs, {len(bad)} unresolved")
        for b in bad:
            print(f"    ? {b}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
