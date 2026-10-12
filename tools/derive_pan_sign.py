#!/usr/bin/env python3
"""Numerically settle the vertical-pan sign from the projection, not intuition.

I got this wrong twice by reasoning loosely, so derive it from the actual camera
math. Reproduces the viewport's eye placement and a standard look-at perspective
projection, then asks: when target[1] increases, does a fixed terrain point move
UP or DOWN the screen?

Run: python tools/derive_pan_sign.py
"""
from __future__ import annotations

import math


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def cross(a, b):
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def norm(a):
    return math.sqrt(dot(a, a))


def unit(a):
    n = norm(a) or 1.0
    return [x / n for x in a]


def eye_of(cam):
    """Matches viewport.js: ex/ey/ez around the target."""
    yaw, pitch, dist, t = cam["yaw"], cam["pitch"], cam["dist"], cam["target"]
    return [
        t[0] + dist * math.cos(pitch) * math.sin(yaw),
        t[1] + dist * math.sin(pitch),
        t[2] + dist * math.cos(pitch) * math.cos(yaw),
    ]


def screen_y(cam, point, fovy_deg=45.0, viewport_h=400):
    """NDC y of a world point; +1 is the TOP of the screen, -1 the bottom."""
    eye = eye_of(cam)
    fwd = unit(sub(cam["target"], eye))
    world_up = [0.0, 1.0, 0.0]
    right = unit(cross(fwd, world_up))
    up = cross(right, fwd)

    d = sub(point, eye)
    z = dot(d, fwd)          # depth along the view axis
    if z <= 1e-9:
        return None
    y = dot(d, up)

    f = 1.0 / math.tan(math.radians(fovy_deg) / 2.0)
    ndc_y = (f * y / z)
    return ndc_y


def main() -> int:
    cam = {"yaw": 0.62, "pitch": 0.72, "dist": 2.45, "target": [0.0, 0.18, 0.0]}
    # A terrain point sitting at the target's ground position.
    terrain = [0.0, 0.0, 0.0]

    print("default camera: yaw=0.62 pitch=0.72 dist=2.45")
    print(f"  eye = {[round(c, 4) for c in eye_of(cam)]}")
    print()

    base = screen_y(cam, terrain)
    print(f"  terrain point {terrain} at target[1]=0.18 -> ndc_y = {base:+.5f}")

    cam_hi = dict(cam)
    cam_hi["target"] = [0.0, 0.18 + 0.10, 0.0]
    hi = screen_y(cam_hi, terrain)
    print(f"  after target[1] += 0.10                 -> ndc_y = {hi:+.5f}")

    cam_lo = dict(cam)
    cam_lo["target"] = [0.0, 0.18 - 0.10, 0.0]
    lo = screen_y(cam_lo, terrain)
    print(f"  after target[1] -= 0.10                 -> ndc_y = {lo:+.5f}")
    print()

    raise_ndc = hi < base   # True when raising the target pushes terrain down-screen
    print(f"  FACT: raising target[1] moves the terrain "
          f"{'DOWN' if raise_ndc else 'UP'} the screen (ndc_y {'decreases' if raise_ndc else 'increases'})")
    print()

    # ---- the four sign combinations, in terms of on-screen terrain motion ----
    s = cam["dist"] * 0.0022
    print("On-screen terrain motion for each operator, from the projection above:")
    print()
    print("  drag UP is dy < 0; drag DOWN is dy > 0")
    print()
    print("  +-------------------------------------------------------------+")
    print("  | operator            | drag UP (dy<0)      | drag DOWN (dy>0)  |")
    print("  +---------------------+---------------------+-------------------+")
    for label, sign in (("target[1] += dy * s", +1), ("target[1] -= dy * s", -1)):
        cells = []
        for dy, direction in ((-40.0, "up"), (40.0, "down")):
            new = 0.18 + sign * dy * s
            # raising target pushes terrain down-screen; lowering pushes it up
            if abs(new - 0.18) < 1e-12:
                cells.append("no motion")
            else:
                raised = new > 0.18
                terrain_moves = ("down" if raise_ndc else "up") if raised else ("up" if raise_ndc else "down")
                cells.append(f"terrain {terrain_moves}")
        print(f"  | {label:19} | {cells[0]:19} | {cells[1]:17} |")
    print("  +---------------------+---------------------+-------------------+")
    print()

    # The requirement: motion is INVERSE of the cursor.
    print("Requirement (user-confirmed): the terrain moves OPPOSITE to the cursor,")
    print("i.e. drag UP must move the terrain DOWN the screen.")
    print()
    want_raise = raise_ndc
    if want_raise:
        print("  -> drag up (dy<0) must RAISE target[1]  =>  target[1] -= dy * s")
    else:
        print("  -> drag up (dy<0) must LOWER target[1]  =>  target[1] += dy * s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
