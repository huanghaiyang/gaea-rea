#!/usr/bin/env python3
"""Rank catalog-only nodes by how tractable their managed Build() body is.

The routing work in round 21 established that most nodes live in the decompiled managed
assembly, and round 31's audit gives the authoritative parameter metadata. What is missing is a
work list ordered by COST: a node whose Build() is four lines of arithmetic is a different
proposition from one that dispatches into a native kernel.

This measures each catalog-only node's Build() body in lines and statements, and flags the ones
that call out to something this build cannot see (a native export, a MagickImage op, a helper
that is itself large). Short and self-contained comes first.

Usage:  python tools/rank-nodes.py [--top N]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
SRC = WS / "evidence" / "decompiled" / "Gaea.Nodes.whole.cs"
ROUTING = WS / "docs" / "node-routing.json"

CLASS_RE = re.compile(r"^\s*(?:public|internal)\s+(?:sealed\s+)?class\s+(\w+)\s*:\s*Node\b")
BUILD_RE = re.compile(r"internal\s+override\s+void\s+Build\s*\(\s*\)")

# Calls that mean the node delegates its arithmetic somewhere this build cannot follow.
OPAQUE = [
    "MagickImage", "Ispc", "Interop", "native", "Native",
    "ParallelErosion", "Lake_Create", "Rivers(", "HydrologicalCorrection",
]
# Known-obfuscated string pool accessors appear in nearly every line; they are not informative
# for cost, so they are stripped before counting.
NOISE_RE = re.compile(r"\\ue[0-9a-f]{3}|\\uf[0-9a-f]{3}")


def build_body(lines: list[str], start: int) -> tuple[int, int]:
    """Return (line count, statement count) of the Build() body starting at `start`."""
    depth = 0
    started = False
    body: list[str] = []
    for i in range(start, min(start + 400, len(lines))):
        line = lines[i]
        for ch in line:
            if ch == "{":
                depth += 1
                started = True
            elif ch == "}":
                depth -= 1
        body.append(line)
        if started and depth <= 0:
            break
    stmts = sum(1 for ln in body if ln.strip().endswith(";"))
    return len(body), stmts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=30)
    args = ap.parse_args()

    lines = SRC.read_text(encoding="utf-8", errors="replace").splitlines()

    # Every class's line span, so Build() can be attributed to the class that owns it.
    classes: list[tuple[str, int]] = []
    for i, line in enumerate(lines):
        m = CLASS_RE.match(line)
        if m:
            classes.append((m.group(1), i))

    catalog = json.loads(ROUTING.read_text(encoding="utf-8"))["nodes"]
    implemented = set()
    reg = (WS / "web" / "js" / "registry.js").read_text(encoding="utf-8")
    for m in re.finditer(r"name:\s*'([^']+)'", reg):
        implemented.add(m.group(1))

    rows = []
    for idx, (name, cls_line) in enumerate(classes):
        if name not in catalog:
            continue
        if name in implemented:
            continue
        end = classes[idx + 1][1] if idx + 1 < len(classes) else len(lines)
        span = lines[cls_line:end]
        bi = None
        for j, ln in enumerate(span):
            if BUILD_RE.search(ln):
                bi = cls_line + j
                break
        if bi is None:
            continue
        nlines, nstmts = build_body(lines, bi)
        text = "\n".join(lines[bi:bi + nlines])
        opaque = [o for o in OPAQUE if o in text]
        rows.append({
            "name": name, "line": cls_line + 1, "lines": nlines, "stmts": nstmts,
            "opaque": opaque,
        })

    # Self-contained and short first.
    rows.sort(key=lambda r: (len(r["opaque"]) > 0, r["lines"], r["name"]))

    print(f"  catalog-only nodes with a Build(): {len(rows)}")
    print(f"  of those, self-contained and under 40 lines: "
          f"{sum(1 for r in rows if not r['opaque'] and r['lines'] < 40)}")
    print()
    print("  name                 line   lines  stmts  delegates-to")
    print("  " + "-" * 66)
    for r in rows[:args.top]:
        print(f"  {r['name']:<20} {r['line']:>5} {r['lines']:>6} {r['stmts']:>6}"
              f"  {', '.join(r['opaque']) if r['opaque'] else '-'}")

    out = WS / "docs" / "node-worklist.json"
    out.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n  wrote {out.relative_to(WS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
