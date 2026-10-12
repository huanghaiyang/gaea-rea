#!/usr/bin/env python3
"""Prove the camera-controls test fails on the inverted vertical pan.

Temporarily restores `target[1] += dy * s` in web/js/viewport.js, runs the camera
test, and restores the file. If the test still passes while the inversion is
present, the guard is worthless.

Usage:
    python tools/verify_camera_pan_regression.py
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
VP = WS / "web" / "js" / "viewport.js"
TEST = WS / "web" / "tests" / "camera-controls-test.mjs"

GOOD = "    cam.target[1] -= dy * s;"
BUGGY = "    cam.target[1] += dy * s;"


def run_test() -> tuple[int, str]:
    p = subprocess.run(
        ["node", str(TEST)],
        capture_output=True, text=True, cwd=str(WS), encoding="utf-8", errors="replace",
    )
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main() -> int:
    src = VP.read_text(encoding="utf-8")
    if GOOD not in src:
        print("could not locate the fixed pan line; aborting")
        return 2

    print("1. baseline (target[1] -= dy * s)")
    rc, out = run_test()
    m = re.search(r"PASS (\d+)\s+FAIL (\d+)", out)
    print(f"   exit={rc}  {m.group(0) if m else out.strip()[:120]}")
    if rc != 0:
        print("   baseline already failing; cannot verify")
        return 1

    try:
        VP.write_text(src.replace(GOOD, BUGGY, 1), encoding="utf-8")
        print("\n2. with the inverted vertical pan restored (target[1] += dy * s)")
        rc2, out2 = run_test()
        m2 = re.search(r"PASS (\d+)\s+FAIL (\d+)", out2)
        print(f"   exit={rc2}  {m2.group(0) if m2 else ''}")
        caught = rc2 != 0
        print(f"   test now fails: {caught}")
        for line in out2.splitlines():
            if line.strip().startswith('- '):
                print(f"     {line.strip()}")
    finally:
        VP.write_text(src, encoding="utf-8")
        print("\n3. restored the fixed file")

    ok = rc == 0 and caught
    print("\n" + ("VERIFIED: the test catches the inverted vertical pan" if ok
                  else "NOT VERIFIED: the test does not catch the bug"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
