#!/usr/bin/env python3
"""Extract node -> SyclFunctions kernel call sites (with parameter mapping)
from the decompiled node source. Read-only w.r.t. the input file.

Output: evidence/kernels/node-callsites.json
"""
import json
import os
import re
import sys

WS = r"D:\sgames\gaea-rea"
SRC = os.path.join(WS, "evidence", "decompiled", "Gaea.Nodes.whole.cs")
OUT = os.path.join(WS, "evidence", "kernels", "node-callsites.json")

KERNELS = ["Thermal2", "Cellular3D", "ThermalShaper", "ParallelErosion", "Flow",
           "ColorTransport", "MedianFilter", "MeshRasterizer", "Debris", "NativeLighting"]
CALL = re.compile(r"\b(" + "|".join(KERNELS) + r")\.([^\s(]+)\s*\(")
CLASSDECL = re.compile(
    r"^(?P<indent>\t*)(?:(?:public|internal|private|sealed|abstract|static|partial)\s+)*"
    r"(?:class|struct|record)\s+(?P<name>[A-Za-z0-9_]+)")
ASSIGN = re.compile(r"^\s*(\S+?)\s*=\s*(.+?),?\s*$")
SKIP_NAMES = {"var", "out", "return", "new", "if", "else", "for", "while"}


def indent_of(line):
    return len(line) - len(line.lstrip("\t"))


def main():
    lines = open(SRC, encoding="utf-8", errors="replace").read().splitlines()
    # precompute class declarations
    decls = [(i, indent_of(l), CLASSDECL.match(l).group("name"))
             for i, l in enumerate(lines) if CLASSDECL.match(l)]

    calls = []
    for i, line in enumerate(lines):
        m = CALL.search(line)
        if not m:
            continue
        myind = indent_of(line)
        owner = None
        for (j, ind, name) in reversed(decls):
            if j < i and ind < myind:
                owner = name
                break
        # capture object-initializer or argument block
        block, depth, started = [], 0, False
        for k in range(i, min(i + 120, len(lines))):
            t = lines[k]
            block.append(t)
            depth += t.count("{") - t.count("}")
            if "{" in t:
                started = True
            if started and depth <= 0:
                break
            if not started and t.rstrip().endswith(");"):
                break
        assigns = {}
        for b in block:
            am = ASSIGN.match(b.strip())
            if am and am.group(1) not in SKIP_NAMES and not am.group(1).startswith("new "):
                assigns.setdefault(am.group(1), am.group(2).rstrip(","))
        calls.append({
            "kernel": m.group(1),
            "member": m.group(2),
            "symbol": "%s.%s" % (m.group(1), m.group(2)),
            "ownerType": owner,
            "line": i + 1,
            "assignments": assigns,
            "rawBlock": [b.strip() for b in block[:46]],
        })
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(calls, fh, indent=1)
    print("call sites:", len(calls), "->", OUT)
    for c in calls:
        print("%-46s owner=%-24s line=%-6d assigns=%d" % (
            c["symbol"], c["ownerType"], c["line"], len(c["assignments"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
