#!/usr/bin/env python3
"""Point Erosion2 (and its alias) at the multiscale solver, and say so in the summary."""
from __future__ import annotations

import pathlib
import subprocess
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
REG = WS / "web" / "js" / "registry.js"

src = REG.read_text(encoding="utf-8")
orig = src

pairs = [
    (
        "name: 'Erosion2', algorithm: hydraulicDroplet, category: CAT.EROS,",
        "name: 'Erosion2', algorithm: hydraulicDropletMultiscale, category: CAT.EROS,",
    ),
    (
        "summary: 'Particle (droplet) hydraulic erosion \u2014 the recommended erosion node in this build.',",
        "summary: 'Multiscale particle erosion on a Laplacian pyramid: levels are eroded "
        "coarse-to-fine, which is what produces long connected valleys instead of "
        "isolated scratches.',",
    ),
]

for old, new in pairs:
    if new.split("\n")[0] in src and old not in src:
        print(f"already applied: {old[:56]}")
        continue
    n = src.count(old)
    if n != 1:
        print(f"pattern count {n} for: {old[:70]}")
        sys.exit(1)
    src = src.replace(old, new, 1)
    print(f"patched: {old[:70]}")

if src != orig:
    REG.write_text(src, encoding="utf-8")
    # Confirm the write landed.
    check = REG.read_text(encoding="utf-8")
    assert check == src, "write verification failed"
    print("write verified")
else:
    print("no changes")

print("multiscale references in registry:", src.count("hydraulicDropletMultiscale"))
p = subprocess.run(["node", "--check", str(REG)], capture_output=True, text=True)
print("syntax:", "OK" if p.returncode == 0 else p.stderr[:300])
sys.exit(0 if p.returncode == 0 else 1)
