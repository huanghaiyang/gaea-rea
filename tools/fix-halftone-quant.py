#!/usr/bin/env python3
"""Fix the ordered-dither quantiser: divide by (levels - 1), not levels."""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "js" / "kernels" / "halftone.js"
t = p.read_text(encoding="utf-8")

old = """  const t = map.cells[(y % map.height) * map.width + (x % map.width)] / map.divisor;
  if (levels <= 1) return v > t ? 1 : 0;
  // Posterised: compare against a stepped threshold so the output takes `levels` values.
  const q = Math.floor(v * levels) / levels;
  const rem = v * levels - Math.floor(v * levels);
  return (q + (rem > t ? 1 / levels : 0));"""
new = """  const t = map.cells[(y % map.height) * map.width + (x % map.width)] / map.divisor;
  // THE QUANTISER NEEDS (levels - 1), NOT levels. With `levels` in the divisor, a two-level
  // dither came out as {0, 0.5, 1} -- three values, none of them binary -- because
  // `floor(v * 2) / 2` already spans two steps before the threshold term is added. Dividing by
  // `levels - 1` makes N levels mean exactly N distinct outputs: 2 gives {0,1}, 5 gives fifths.
  const n = Math.max(2, levels);
  const steps = n - 1;
  return Math.floor(v * steps + t) / steps;"""
if old not in t:
    print("  !! ordered() block not found")
    sys.exit(1)
t = t.replace(old, new)
p.write_text(t, encoding="utf-8")
print("  ordered(): quantiser now divides by (levels - 1)")
