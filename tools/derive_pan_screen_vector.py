#!/usr/bin/env python3
"""Check the pan vector's on-screen direction, including the depth-axis coupling.

The vertical pan moves both target[1] and target[2]. That Z coupling was added so
the drag slides the terrain along the view's vertical axis, but it depends on yaw:
at yaw 0 the view faces +Z, so moving along Z is purely vertical on screen; at other
yaws the depth axis is partly horizontal in view space, which would add sideways
drift to a vertical drag.

This projects a fixed terrain point before and after a pan and reports the screen
motion, so the coupling can be accepted or removed on evidence.

Run: python tools/derive_pan_screen_vector.py
"""
from __future__ import annotations

import math

from derive_pan_sign import cross, dot, eye_of, sub, unit  # reuse the camera math


def screen_xy(cam, point, fovy_deg=45.0, aspect=1.6):
    """NDC (x, y) of a world point. +y is up the screen, +x is right."""
    eye = eye_of(cam)
    fwd = unit(sub(cam["target"], eye))
    world_up = [0.0, 1.0, 0.0]
    right = unit(cross(fwd, world_up))
    up = cross(right, fwd)

    d = sub(point, eye)
    z = dot(d, fwd)
    if z <= 1e-9:
        return None
    f = 1.0 / math.tan(math.radians(fovy_deg) / 2.0)
    return (f * dot(d, right) / (z * aspect), f * dot(d, up) / z)


def apply_pan(cam, dx, dy, use_z_coupling):
    s = cam["dist"] * 0.0022
    t = list(cam["target"])
    t[0] -= dx * s
    t[1] -= dy * s
    if use_z_coupling:
        t[2] += dy * s
    out = dict(cam)
    out["target"] = t
    return out


def main() -> int:
    base = {"yaw": 0.62, "pitch": 0.72, "dist": 2.45, "target": [0.0, 0.18, 0.0]}
    terrain = [0.0, 0.0, 0.0]

    print("Vertical drag (dy = 40) — screen displacement of a fixed terrain point")
    print("NDC units: x horizontal (+right), y vertical (+up). aspect = 1.6")
    print()
    header = f"{'yaw':>6}  {'coupling':>9}  {'dx_screen':>10}  {'dy_screen':>10}  {'|dx|/|dy|':>10}  verdict"
    print(header)
    print("-" * len(header))

    for yaw in (0.0, 0.62, 1.2, 2.4, 3.14):
        for use_z in (True, False):
            cam = dict(base)
            cam["yaw"] = yaw
            a = screen_xy(cam, terrain)
            after = apply_pan(cam, 0, 40, use_z)
            b = screen_xy(after, terrain)
            if a is None or b is None:
                continue
            sx, sy = b[0] - a[0], b[1] - a[1]
            ratio = abs(sx) / abs(sy) if abs(sy) > 1e-12 else float("inf")
            drift = "ok" if ratio < 0.15 else f"SIDEWAYS x{ratio:.2f}"
            print(f"{yaw:>6.2f}  {str(use_z):>9}  {sx:>10.5f}  {sy:>10.5f}  {ratio:>10.3f}  {drift}")

    print()
    print("Vertical sense check (sign of dy_screen must be the same for every yaw):")
    signs = set()
    for yaw in (0.0, 0.62, 1.2, 2.4, 3.14):
        cam = dict(base)
        cam["yaw"] = yaw
        a = screen_xy(cam, terrain)
        b = screen_xy(apply_pan(cam, 0, 40, True), terrain)
        signs.add(1 if b[1] > a[1] else -1)
    consistent = len(signs) == 1
    print(f"  drag down (dy>0) moves the terrain "
          f"{'UP' if signs == {1} else 'DOWN' if signs == {-1} else 'INCONSISTENTLY'} the screen")
    print(f"  consistent across yaw: {consistent}")
    print()
    print("Requirement: drag down -> terrain up (inverse of cursor). "
          f"{'SATISFIED' if signs == {1} else 'NOT satisfied'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
