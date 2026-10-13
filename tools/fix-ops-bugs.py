#!/usr/bin/env python3
"""Fix three real bugs found by gaea-ops-test.mjs, and two test-construction errors."""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
ops = WS / "web" / "js" / "kernels" / "ops.js"
tst = WS / "web" / "tests" / "gaea-ops-test.mjs"

t = ops.read_text(encoding="utf-8")

# BUG 1: Terraces did not quantise at all. `(floor(t*n) + pow(frac, ex)) / n` with ex = 1 is
# `(floor + frac) / n`, which equals `t` -- the identity. The exponent must sharpen the INPUT
# curve before flooring, not the fractional part after.
OLD_T = """    const jitter = (rand(i) - 0.5) * (1 - uniformity) * (1 / n);
    const t = Math.max(0, Math.min(1, v + jitter));
    const band = Math.floor(t * n) / (n - 1);
    const sharp = Math.pow(Math.min(1, t * n - Math.floor(t * n)), ex);
    const terraced = (Math.floor(t * n) + sharp) / n;
    out.data[i] = v + (terraced - v) * intensity;"""
NEW_T = """    const jitter = (rand(i) - 0.5) * (1 - uniformity) * (1 / n);
    const t = Math.max(0, Math.min(1, v + jitter));
    // THE QUANTISATION MUST SURVIVE steepness = 0. The first version added the sharpened
    // fraction to the floored band, which with ex = 1 collapses to `t` exactly -- the identity,
    // so the node produced 256 distinct values on a 256-step ramp instead of `n` bands. The
    // exponent belongs on the INPUT curve, ahead of the floor, so the step edges sharpen while
    // the steps themselves remain steps.
    const shaped = steepness <= 0 ? t : Math.pow(t, 1 / (1 + steepness * 3));
    const terraced = Math.floor(shaped * n) / n;
    out.data[i] = v + (terraced - v) * intensity;"""
if OLD_T not in t:
    print("  !! terraces block not found")
    sys.exit(1)
t = t.replace(OLD_T, NEW_T)
# `ex` is now unused; drop its declaration so the file does not carry a dead binding.
t = t.replace("  const ex = 1 + steepness * 4;\n", "")

# BUG 2: the Curvature window returned 0.5 at zero curvature. `(m - lo) / falloff` centred on
# lo puts zero at the middle of the smoothstep. A falloff window that starts at `lo` is what
# makes a plane come out at 0.
OLD_C = """      const m = Math.abs(v);
      // A soft window over [lo, hi] with the falloff widening both edges.
      const t = (m - lo) / Math.max(1e-9, hi - lo);
      const a = Math.max(0, Math.min(1, (t + falloff) / (2 * falloff)));
      out.data[y * size + x] = a * a * (3 - 2 * a);"""
NEW_C = """      const m = Math.abs(v);
      // THE WINDOW MUST BE ZERO AT ZERO CURVATURE. The first version centred a smoothstep on
      // `lo`, so a plane -- curvature exactly 0 with the default Range starting at 0 -- came out
      // at 0.5, i.e. half-lit everywhere. A ramp that rises FROM `lo` over `falloff` and reaches
      // 1 at `hi` is what makes flat ground read as flat.
      const width = Math.max(1e-9, falloff * (hi - lo));
      const a = Math.max(0, Math.min(1, (m - lo) / width));
      out.data[y * size + x] = a * a * (3 - 2 * a);"""
if OLD_C not in t:
    print("  !! curvature block not found")
    sys.exit(1)
t = t.replace(OLD_C, NEW_C)
ops.write_text(t, encoding="utf-8")
print("  ops.js: terraces quantisation + curvature window fixed")

# TEST FIX 1: Softness 0.3 against a 0.3 offset saturates the knee, so the value lands exactly
# on the threshold. A wider knee is what makes the "stays above" property visible.
s = tst.read_text(encoding="utf-8")
OLD_S = """  const soft = gaeaSoftClip(ctx(size, P({ Softness: 0.3 }), flat));"""
NEW_S = """  // The knee spans +-Softness, so a 0.3 offset needs a knee wider than 0.3 for the value to
  // stay above the threshold. The first version used 0.3 and saturated the knee exactly.
  const soft = gaeaSoftClip(ctx(size, P({ Softness: 0.5 }), flat));"""
if OLD_S not in s:
    print("  !! softclip test not found")
    sys.exit(1)
s = s.replace(OLD_S, NEW_S)

# TEST FIX 2: `(x + y) / (2 * (size - 1))` is constant along anti-diagonals, so whole blocks
# share a mean and the distinct count is 7 rather than block^2. A per-block-varying ramp is
# needed to make the count meaningful.
OLD_P = """  const d = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) d[idx(size, x, y)] = (x + y) / (2 * (size - 1));"""
NEW_P = """  // The ramp must vary ACROSS blocks, not merely along a direction: `(x + y)` is constant on
  // anti-diagonals, so several blocks share a mean and the distinct-value count came out at 7
  // instead of block^2. Indexing by the block itself makes every block distinct.
  const d = new Float32Array(size * size);
  {
    const blk = Math.round(0.25 * size);
    const bw = Math.ceil(size / blk);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const bi = Math.floor(y / blk) * bw + Math.floor(x / blk);
        d[idx(size, x, y)] = (bi + 1) / (bw * bw + 1);
      }
    }
  }"""
if OLD_P not in s:
    print("  !! pixelate test not found")
    sys.exit(1)
s = s.replace(OLD_P, NEW_P)
tst.write_text(s, encoding="utf-8")
print("  test: softclip knee and pixelate ramp fixed")
