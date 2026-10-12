#!/usr/bin/env python3
"""Derive the horizontal pan sign from the projection.

The vertical axis was settled by deriving it; the horizontal one was asserted by
hand and turned out wrong (the user reported left/right inverted after up/down was
fixed). This computes it instead.

The camera orbits the target, so the screen right vector is
`normalize(fwd x world_up)` and the target sits at the origin of that basis.
Moving the target along an axis therefore moves the terrain the OPPOSITE way on
screen. The question is the sign of each world axis' projection onto screen-right.

Run: python tools/derive_pan_horizontal.py
"""
from __future__ import annotations

import math


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit(a):
    n = math.sqrt(dot(a, a)) or 1.0
    return [x / n for x in a]


def basis(yaw, pitch, dist, target):
    eye = [
        target[0] + dist * math.cos(pitch) * math.sin(yaw),
        target[1] + dist * math.sin(pitch),
        target[2] + dist * math.cos(pitch) * math.cos(yaw),
    ]
    fwd = unit(sub(target, eye))
    right = unit(cross(fwd, [0.0, 1.0, 0.0]))
    return eye, fwd, right


def main() -> int:
    yaw, pitch, dist = 0.62, 0.72, 2.45
    target = [0.0, 0.18, 0.0]
    eye, fwd, right = basis(yaw, pitch, dist, target)

    print(f"camera yaw={yaw} pitch={pitch} dist={dist}")
    print(f"  eye   = {[round(v, 4) for v in eye]}")
    print(f"  fwd   = {[round(v, 4) for v in fwd]}")
    print(f"  right = {[round(v, 4) for v in right]}   <- screen +X direction")
    print()

    # A target displacement d moves the terrain on screen by -d in view space.
    axis_x = dot([1.0, 0.0, 0.0], right)
    print(f"  screen-x contribution of world +X : {axis_x:+.4f}")
    print(f"  screen-x contribution of world +Z : {dot([0.0, 0.0, 1.0], right):+.4f}")
    print()

    s = dist * 0.0022
    print("Terrain on-screen motion per operator (drag dx = +30, i.e. rightward):")
    print()
    header = f"  {'operator':<14} {'dTarget[0]':>11} {'terrain screen-x':>17}  verdict"
    print(header)
    print("  " + "-" * (len(header) - 2))
    want = None
    for op, sign in (("+= dx * s", +1), ("-= dx * s", -1)):
        d = sign * 30 * s
        # terrain moves opposite to the target displacement
        screen = -axis_x * d
        verdict = "terrain RIGHT" if screen > 0 else "terrain LEFT"
        print(f"  {op:<14} {d:>+11.5f} {screen:>+17.5f}  {verdict}")
        if screen > 0:
            want = op
    print()
    print("Requirement (user, after up/down was confirmed fixed): direct manipulation —")
    print("dragging right must move the terrain RIGHT.")
    print(f"  -> correct operator: {want}")
    if want == "-= dx * s":
        print("     i.e. cam.target[0] -= dx * s")
    else:
        print("     i.e. cam.target[0] += dx * s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
