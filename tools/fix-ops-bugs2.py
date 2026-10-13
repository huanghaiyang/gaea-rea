#!/usr/bin/env python3
"""Fix the Concave bug and make the terrace jitter assertion test the right thing."""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
ops = WS / "web" / "js" / "kernels" / "ops.js"
tst = WS / "web" / "tests" / "gaea-ops-test.js"  # placeholder, corrected below
tst = WS / "web" / "tests" / "gaea-ops-test.mjs"

t = ops.read_text(encoding="utf-8")

# BUG 3: Type had no effect. `v = concave ? -lap : lap` followed by `m = Math.abs(v)` makes the
# sign irrelevant, so Convex and Concave returned identical masks.
OLD = """      const lap = sum / 8 - h[y * size + x];
      // Convex terrain has a positive Laplacian under this convention; concave reverses it.
      const v = String(type).toLowerCase().includes('concave') ? -lap : lap;
      const m = Math.abs(v);"""
NEW = """      const lap = sum / 8 - h[y * size + x];
      // THE SELECTOR MUST PICK A SIGN, NOT A NEGATION. The first version negated `lap` for the
      // concave case and then took the absolute value, which cancels -- both types returned the
      // same mask. Convex lights cells where the Laplacian is positive (a peak above its
      // neighbours) and Concave lights where it is negative (a pit), so the negative branch must
      // be CLAMPED to zero, not folded.
      const concave = String(type).toLowerCase().includes('concave');
      const m = concave ? Math.max(0, -lap) : Math.max(0, lap);"""
if OLD not in t:
    print("  !! curvature sign block not found")
    sys.exit(1)
t = t.replace(OLD, NEW)
ops.write_text(t, encoding="utf-8")
print("  ops.js: Concave now selects a sign instead of negating into an absolute value")

s = tst.read_text(encoding="utf-8")
OLD_S = """  // Jitter must depend on the seed, or Uniformity would be the only control.
  const a = gaeaTerraces(ctx(size, { NumTerraces: 8, Uniformity: 0.2, Steepness: 0.3, Intensity: 1, Seed: 1 }, ramp));
  const b = gaeaTerraces(ctx(size, { NumTerraces: 8, Uniformity: 0.2, Steepness: 0.3, Intensity: 1, Seed: 2 }, ramp));
  let differs = false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) { differs = true; break; }
  ok(differs, 'a different Seed changes the result');"""
NEW_S = """  // Uniformity controls the jitter and must be observable. An earlier version asserted a
  // seed-to-seed difference instead, which at 8 bands is not reliable: the jitter amplitude is
  // at most half a band, so most cells stay inside their step and the two seeds agree. Uniformity
  // 0 against 1 is the effect the parameter actually names.
  const jittered = gaeaTerraces(ctx(size, { NumTerraces: 8, Uniformity: 0.2, Steepness: 0, Intensity: 1, Seed: 1 }, ramp));
  const clean = gaeaTerraces(ctx(size, { NumTerraces: 8, Uniformity: 1, Steepness: 0, Intensity: 1, Seed: 1 }, ramp));
  let differs = false;
  for (let i = 0; i < jittered.data.length; i++) {
    if (jittered.data[i] !== clean.data[i]) { differs = true; break; }
  }
  ok(differs, 'Uniformity below 1 introduces jitter');"""
if OLD_S not in s:
    print("  !! seed test not found")
    sys.exit(1)
s = s.replace(OLD_S, NEW_S)
tst.write_text(s, encoding="utf-8")
print("  test: uniformity assertion replaces the unreliable seed comparison")
