#!/usr/bin/env bash
# Safely extract one zip into work/extracted/<ID>/. Never executes extracted content.
# Usage: tools/extract.sh <zip> <ID>
# Prints one JSON line: {"id","zip","sha256","size","entries","git_remote"}
set -euo pipefail
zip="$1"; id="$2"
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/work/extracted/$id"

[[ -f "$zip" ]] || { echo "no such zip: $zip" >&2; exit 1; }
if [[ -e "$dest" ]] && [[ -n "$(ls -A "$dest" 2>/dev/null)" ]]; then
  echo "refusing: $dest is not empty" >&2; exit 1
fi

# Refuse path traversal and absolute paths before extracting anything.
if unzip -Z1 "$zip" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "refusing: $zip has absolute or ../ entries" >&2; exit 2
fi
# Refuse symlinks (unix mode starting with l in zipinfo listing).
if unzip -Z "$zip" | grep -Eq '^l'; then
  echo "refusing: $zip contains symlinks" >&2; exit 3
fi

entries=$(unzip -Z1 "$zip" | grep -vc -E '(^__MACOSX/|(^|/)\._)' || true)
sha=$(shasum -a 256 "$zip" | cut -d' ' -f1)
size=$(stat -f %z "$zip")

mkdir -p "$dest"
unzip -q -o "$zip" -d "$dest"
rm -rf "$dest/__MACOSX"
find "$dest" -name '._*' -delete
find "$dest" -name '.DS_Store' -delete

# Move any .git dirs aside after reading their remote URL (read as text, no git exec inside).
remote=""
while IFS= read -r -d '' g; do
  if [[ -f "$g/config" ]]; then
    r=$(grep -E '^[[:space:]]*url[[:space:]]*=' "$g/config" | head -1 | sed -E 's/^[[:space:]]*url[[:space:]]*=[[:space:]]*//')
    [[ -n "$r" ]] && remote="$r"
  fi
  rel="${g#$dest/}"
  meta="$root/work/extracted/$id.git-meta/$(dirname "$rel")"
  mkdir -p "$meta"
  mv "$g" "$meta/"
done < <(find "$dest" -type d -name .git -prune -print0)

python3 -I -c 'import json,sys; print(json.dumps(dict(zip(["id","zip","sha256","size","entries","git_remote"], sys.argv[1:]))))' \
  "$id" "$zip" "$sha" "$size" "$entries" "$remote"
