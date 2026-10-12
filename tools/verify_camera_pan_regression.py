#!/usr/bin/env python3
"""Prove the camera-controls test fails when the pan convention is broken.

The fixed behaviour is direct manipulation: the terrain follows the cursor. Three
mutations are guarded:

  A. inverse-drag vertical sign (`target[1] -= dy * s`) — the bug the user reported
  B. inverse-drag horizontal sign (`target[0] -= dx * s`)
  C. re-adding the depth-axis coupling, which injects sideways drift

The fix is `target[0] += dx * s` and `target[1] += dy * s` with no target[2] term.
If the test still passes while a mutation is present, the guard is worthless.

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

GOOD = "    cam.target[0] += dx * s;\n    cam.target[1] += dy * s;\n    return cam;"

MUTATIONS = [
    (
        "A: inverse-drag vertical sign (the reported bug)",
        "    cam.target[0] += dx * s;\n    cam.target[1] -= dy * s;\n    return cam;",
    ),
    (
        "B: inverse-drag horizontal sign",
        "    cam.target[0] -= dx * s;\n    cam.target[1] += dy * s;\n    return cam;",
    ),
    (
        "C: depth-axis coupling re-added",
        "    cam.target[0] += dx * s;\n    cam.target[1] += dy * s;\n"
        "    cam.target[2] += dy * s;\n    return cam;",
    ),
]


def run_test() -> tuple[int, str]:
    p = subprocess.run(
        ["node", str(TEST)],
        capture_output=True, text=True, cwd=str(WS), encoding="utf-8", errors="replace",
    )
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def report(label: str, rc: int, out: str) -> bool:
    m = re.search(r"PASS (\d+)\s+FAIL (\d+)", out)
    print(f"   exit={rc}  {m.group(0) if m else out.strip()[:100]}")
    caught = rc != 0
    print(f"   test fails (guard works): {caught}")
    for line in out.splitlines():
        if line.strip().startswith("- "):
            print(f"     {line.strip()}")
    return caught


def main() -> int:
    src = VP.read_text(encoding="utf-8")
    if GOOD not in src:
        print("could not locate the fixed pan block; aborting")
        return 2

    print("1. baseline (target[1] -= dy * s, no depth coupling)")
    rc, out = run_test()
    m = re.search(r"PASS (\d+)\s+FAIL (\d+)", out)
    print(f"   exit={rc}  {m.group(0) if m else out.strip()[:100]}")
    if rc != 0:
        print("   baseline failing; cannot verify")
        return 1
    print("   baseline passes: guard premise holds")

    results: list[tuple[str, bool]] = []
    try:
        for label, bad in MUTATIONS:
            VP.write_text(src.replace(GOOD, bad, 1), encoding="utf-8")
            print(f"\n2. {label}")
            rc2, out2 = run_test()
            results.append((label, report(label, rc2, out2)))
    finally:
        VP.write_text(src, encoding="utf-8")
        print("\n3. restored the fixed file")

    ok = rc == 0 and all(caught for _, caught in results)
    print()
    for label, caught in results:
        print(f"  {label}: {'CAUGHT' if caught else 'NOT CAUGHT'}")
    print("\n" + ("VERIFIED: the guards catch every mutation" if ok
                  else "NOT VERIFIED: at least one mutation slips through"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())


if __name__ == "__main__":
    raise SystemExit(main())
