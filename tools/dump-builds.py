#!/usr/bin/env python3
"""Dump the Build() body and parameters of named catalog-only nodes, for implementation."""
import json
import pathlib
import re
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
SRC = WS / "evidence" / "decompiled" / "Gaea.Nodes.whole.cs"
ROUTING = WS / "docs" / "node-routing.json"

lines = SRC.read_text(encoding="utf-8", errors="replace").splitlines()
routing = json.loads(ROUTING.read_text(encoding="utf-8"))["nodes"]

CLASS = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+)?class\s+(\w+)\s*:\s*Node\b")
BUILD = re.compile(r"internal\s+override\s+void\s+Build\s*\(\s*\)")

names = sys.argv[1:]
classes = [(m.group(1), i) for i, l in enumerate(lines) if (m := CLASS.match(l))]
index = {n: i for n, i in classes}

for name in names:
    if name not in index:
        print(f"=== {name}: NOT FOUND ===")
        continue
    ci = index[name]
    end = classes[ci + 1][1] if ci + 1 < len(classes) else len(lines)
    print("=" * 70)
    print(f"  {name}")
    meta = routing.get(name, {})
    for prm in meta.get("params", []):
        print(f"    [Parameter({prm['meta']})] {prm['name']}")
    bi = None
    for j in range(ci, end):
        if BUILD.search(lines[j]):
            bi = j
            break
    if bi is None:
        print("    (no Build())")
        continue
    depth = 0
    started = False
    for j in range(bi, min(bi + 80, len(lines))):
        for ch in lines[j]:
            if ch == "{":
                depth += 1
                started = True
            elif ch == "}":
                depth -= 1
        print("    " + lines[j].rstrip())
        if started and depth <= 0:
            break
