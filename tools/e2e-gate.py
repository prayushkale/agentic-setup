#!/usr/bin/env python3 -I
"""e2e-gate.py <dry-run output> <real HOME> <sandbox root>

Exit 0 only when the dry-run lists at least one planned command and none would write outside
the sandbox: no brew/sudo/apt/port, no /opt, /usr, /etc, /Library or /System path, no real-HOME
path outside the sandbox. `npm i -g` and `uv tool install` are not matched here; e2e-core.sh
guards them by asserting NPM_CONFIG_PREFIX (and HOME/XDG_*) point into the sandbox first.
"""
import re
import sys

text, real, root = open(sys.argv[1]).read(), sys.argv[2], sys.argv[3]
cmds = re.findall(r"^\s+\$ (.*)$", text.split("Would run:", 1)[1], re.M) if "Would run:" in text else []
if not cmds:
    print("BLOCKED: no planned commands found (no 'Would run:' list, or its format changed)")
    sys.exit(1)
bad = []
for c in cmds:
    if re.search(r"(^|[;&|(\s])(brew|sudo|apt|apt-get|port)\s", c): bad.append(("system installer", c))
    if re.search(r"(^|[\s=])/(opt|usr|etc|Library|System)/", c): bad.append(("system path", c))
    for m in re.finditer(re.escape(real) + r"/\S*", c):
        if not m.group(0).startswith(root + "/"): bad.append(("real HOME path", c))
for why, c in bad: print(f"BLOCKED ({why}): {c}")
print(f"checked {len(cmds)} planned commands, {len(bad)} blocked")
sys.exit(1 if bad else 0)
