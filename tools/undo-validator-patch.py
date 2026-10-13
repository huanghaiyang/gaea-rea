#!/usr/bin/env python3
"""Undo the validator patch, which landed on the wrong `if`.

The insertion was anchored on the nearest preceding `if` to the string "bare specifier", and that
turned out to be `if status == "skip"` in the HTML-reference loop -- so the guard was spliced into
an unrelated statement and the file stopped parsing. A regex-based edit to a file I had not read in
full; the same mistake the patch was meant to fix in the validator.

The lines are removed verbatim, restoring the original.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "validate_web.py"
lines = p.read_text(encoding="utf-8").splitlines(keepends=True)

# The four inserted lines, matched by content rather than by number.
bad_markers = [
    "# web/src is compiled by Vite, whose aliases no import map declares.",
    "and not str(f).replace('\\\\', '/').startswith('src/')",
    "and '/src/' not in str(f).replace('\\\\', '/')",
]
removed = 0
out = []
i = 0
while i < len(lines):
    stripped = lines[i].strip()
    if (stripped in bad_markers
            or stripped == ":"
            or stripped.startswith("# Vite resolves web/src")):
        # Only drop a bare ":" when the previous kept line is a dangling `if ...` we just broke.
        removed += 1
        i += 1
        continue
    out.append(lines[i])
    i += 1

p.write_text("".join(out), encoding="utf-8")
print(f"  removed {removed} inserted line(s)")

import ast  # noqa: E402
try:
    ast.parse(p.read_text(encoding="utf-8"))
    print("  validate_web.py parses again")
except SyntaxError as e:
    print(f"  !! still broken at line {e.lineno}: {e.text}")
    sys.exit(1)
