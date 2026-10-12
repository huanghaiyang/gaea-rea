#!/usr/bin/env python3
"""Prove the graph coordinate test fails on the original defect.

Temporarily restores the un-scaled context (ctx.scale(1, 1)) in
web/js/graph-editor.js, runs the coordinate test, and restores the file. If the
test still passes while the bug is present, the guard is worthless.

Usage:
    python tools/verify_graph_coords_regression.py
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
EDITOR = WS / "web" / "js" / "graph-editor.js"
TEST = WS / "web" / "tests" / "graph-coords-test.mjs"

GOOD = """    // The backing store is sized `CSS px * dpr`, so the context must be scaled by
    // the same factor. Everything drawn after this — and every pointer coordinate
    // read from offsetX/offsetY — is then in CSS pixels, which is also the space
    // view.x/view.y live in. Without this scale the drawing occupies the top-left
    // 1/dpr of the bitmap while hit-testing still assumes CSS pixels, so clicks
    // land off by that factor on any display with devicePixelRatio > 1.
    ctx.scale(dpr, dpr);"""

BUGGY = """    ctx.scale(1, 1);"""


def run_test() -> tuple[int, str]:
    p = subprocess.run(
        ["node", str(TEST)],
        capture_output=True, text=True, cwd=str(WS), encoding="utf-8", errors="replace",
    )
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main() -> int:
    src = EDITOR.read_text(encoding="utf-8")
    if GOOD not in src:
        print("could not locate the fixed scale block; aborting")
        return 2

    print("1. baseline (ctx.scale(dpr, dpr))")
    rc, out = run_test()
    m = re.search(r"PASS (\d+)\s+FAIL (\d+)", out)
    print(f"   exit={rc}  {m.group(0) if m else out.strip()[:120]}")
    if rc != 0:
        print("   baseline already failing; cannot verify")
        return 1

    try:
        EDITOR.write_text(src.replace(GOOD, BUGGY, 1), encoding="utf-8")
        print("\n2. with ctx.scale(1, 1) restored (the original bug)")
        rc2, out2 = run_test()
        m2 = re.search(r"PASS (\d+)\s+FAIL (\d+)", out2)
        print(f"   exit={rc2}  {m2.group(0) if m2 else ''}")
        caught = rc2 != 0
        print(f"   test now fails: {caught}")
        for line in out2.splitlines():
            if line.strip().startswith('- '):
                print(f"     {line.strip()}")
    finally:
        EDITOR.write_text(src, encoding="utf-8")
        print("\n3. restored the fixed file")

    ok = rc == 0 and caught
    print("\n" + ("VERIFIED: the test catches the un-scaled context bug" if ok
                  else "NOT VERIFIED: the test does not catch the bug"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
