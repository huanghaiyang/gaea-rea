#!/usr/bin/env python3
"""Remove the now-duplicated droplet loop left inside hydraulicDroplet().

After extracting erodeLevel(), the original inline loop still sits in
hydraulicDroplet. This deletes it by brace matching, together with the duplicate
shaping comment the extraction left behind, and then verifies the file parses and
that erodeLevel is called exactly once from hydraulicDroplet.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
TARGET = WS / "web" / "js" / "kernels" / "erosion.js"

src = TARGET.read_text(encoding="utf-8")
lines = src.split("\n")

# The stale loop is the one after the erodeLevel(...) call block.
call_line = None
for i, l in enumerate(lines):
    if "brushOffsets: brush.offsets, brushSum: brush.sum, depositRadius, depBoost, extraBoost," in l:
        call_line = i
        break
if call_line is None:
    print("could not find the erodeLevel call; aborting")
    sys.exit(2)

dup_comment = None
loop_start = None
for i in range(call_line, min(call_line + 20, len(lines))):
    if lines[i].strip().startswith("// ---- shaping: valley sharpening"):
        dup_comment = i
    if "for (let n = 0; n < droplets; n++) {" in lines[i]:
        loop_start = i
        break
if loop_start is None:
    print("stale loop not found (already removed?)")
    sys.exit(0)

# Brace-match to find the loop's closing line.
depth = 0
loop_end = None
for i in range(loop_start, len(lines)):
    depth += lines[i].count("{") - lines[i].count("}")
    if depth == 0 and i > loop_start:
        loop_end = i
        break
if loop_end is None:
    print("could not match braces for the stale loop; aborting")
    sys.exit(2)

print(f"duplicate comment line: {dup_comment + 1 if dup_comment is not None else 'none'}")
print(f"stale loop: lines {loop_start + 1}..{loop_end + 1} ({loop_end - loop_start + 1} lines)")

# Delete the loop, and the duplicate comment immediately above it if present.
start_del = loop_start
if dup_comment is not None and dup_comment == loop_start - 1:
    start_del = dup_comment

new_lines = lines[:start_del] + lines[loop_end + 1:]
out = "\n".join(new_lines)

# Collapse any triple blank lines the deletion created.
while "\n\n\n\n" in out:
    out = out.replace("\n\n\n\n", "\n\n\n")

TARGET.write_text(out, encoding="utf-8")
print(f"removed {loop_end - start_del + 1} lines")

# Verify.
check = TARGET.read_text(encoding="utf-8")
print("erodeLevel definitions:", check.count("function erodeLevel("))
print("erodeLevel calls:", check.count("erodeLevel(h, size"))
print("stale loop remaining:", check.count("for (let n = 0; n < droplets; n++)"))
print("shaping comments:", check.count("// ---- shaping: valley sharpening"))

p = subprocess.run(["node", "--check", str(TARGET)], capture_output=True, text=True)
print("syntax:", "OK" if p.returncode == 0 else p.stderr[:300])
sys.exit(0 if p.returncode == 0 else 1)
