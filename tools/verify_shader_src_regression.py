#!/usr/bin/env python3
"""Prove the shader test catches a uniform that is set but never located.

The validator found a real defect during development: `gl.uniform3f(this.loc.eye, ...)`
was called while `this.loc` had no `eye` key, so the location was `undefined` and
WebGL would silently ignore the assignment. That is exactly the kind of mistake a
browser would not report, so the guard needs to be demonstrably effective.

Three mutations are applied in turn, each restored afterwards:

  A. drop the `eye` entry from the loc object (the original defect)
  B. declare a uniform in the shader that JS never looks up
  C. use a non-built-in name in the fragment stage

Usage:
    python tools/verify_shader_src_regression.py
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

WS = Path(__file__).resolve().parent.parent
VP = WS / "web" / "js" / "viewport.js"
TEST = WS / "web" / "tests" / "shader-src-test.mjs"

MUTATIONS: list[tuple[str, str, str]] = [
    (
        "A: loc.eye mapping removed (uniform set at an undefined location)",
        "        spec: gl.getUniformLocation(prog, 'uSpec'),\n"
        "        eye: gl.getUniformLocation(prog, 'uEye'),\n",
        "        spec: gl.getUniformLocation(prog, 'uSpec'),\n",
    ),
    (
        "B: shader declares a uniform JS never looks up",
        "uniform vec3 uEye;           // camera position in world space",
        "uniform vec3 uEye;           // camera position in world space\nuniform float uOrphan;",
    ),
    (
        "C: fragment stage calls a name that is not a GLSL built-in",
        "  vec3 l = normalize(uLightDir);\n  float diff = max(dot(n, l), 0.0);",
        "  vec3 l = normalize(uLightDir);\n  float diff = max(dot(n, l), 0.0) * fakeBuiltin(1.0);",
    ),
]


def run_test() -> tuple[int, str]:
    p = subprocess.run(
        ["node", str(TEST)],
        capture_output=True, text=True, cwd=str(WS), encoding="utf-8", errors="replace",
    )
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def summarise(out: str) -> str:
    m = re.search(r"PASS (\d+)\s+FAIL (\d+)", out)
    return m.group(0) if m else out.strip()[:100]


def main() -> int:
    src = VP.read_text(encoding="utf-8")

    print("1. baseline")
    rc, out = run_test()
    print(f"   exit={rc}  {summarise(out)}")
    if rc != 0:
        print("   baseline failing; cannot verify")
        return 1
    print("   baseline passes: guard premise holds")

    results: list[tuple[str, bool]] = []
    for label, old, new in MUTATIONS:
        if src.count(old) != 1:
            print(f"\n{label}\n   SKIPPED: pattern count {src.count(old)}")
            results.append((label, False))
            continue
        try:
            VP.write_text(src.replace(old, new, 1), encoding="utf-8")
            print(f"\n2. {label}")
            rc2, out2 = run_test()
            print(f"   exit={rc2}  {summarise(out2)}")
            caught = rc2 != 0
            print(f"   test fails (guard works): {caught}")
            for line in out2.splitlines():
                if line.strip().startswith("- "):
                    print(f"     {line.strip()}")
            results.append((label, caught))
        finally:
            VP.write_text(src, encoding="utf-8")

    print("\n3. restored the original file")
    ok = rc == 0 and all(c for _, c in results)
    print()
    for label, caught in results:
        print(f"  {label}: {'CAUGHT' if caught else 'NOT CAUGHT'}")
    print("\n" + ("VERIFIED: the shader checks catch every mutation" if ok
                  else "NOT VERIFIED: at least one mutation slips through"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
