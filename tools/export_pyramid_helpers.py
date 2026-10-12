#!/usr/bin/env python3
"""Export the pyramid primitives so tests can assert the decomposition is exact."""
from __future__ import annotations

import pathlib
import subprocess
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
TARGET = WS / "web" / "js" / "kernels" / "erosion.js"

EDITS = [
    ("function downsample2(a, n) {", "export function downsample2(a, n) {"),
    ("function upsample2(a, m, n) {", "export function upsample2(a, m, n) {"),
    ("function buildPyramid(h, size, maxLevels) {", "export function buildPyramid(h, size, maxLevels) {"),
]


def main() -> int:
    src = TARGET.read_text(encoding="utf-8")
    changed = 0
    for old, new in EDITS:
        if new in src and old not in src:
            print(f"already exported: {new[:50]}")
            continue
        n = src.count(old)
        if n != 1:
            print(f"pattern count {n} for {old[:60]}")
            return 1
        src = src.replace(old, new, 1)
        changed += 1
        print(f"exported: {new[:60]}")

    if changed:
        TARGET.write_text(src, encoding="utf-8")
        check = TARGET.read_text(encoding="utf-8")
        assert check == src, "write verification failed"
        print(f"write verified ({changed} edits)")

    p = subprocess.run(["node", "--check", str(TARGET)], capture_output=True, text=True)
    print("syntax:", "OK" if p.returncode == 0 else p.stderr[:300])
    return 0 if p.returncode == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
