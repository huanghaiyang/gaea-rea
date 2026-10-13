#!/usr/bin/env python3
"""Make the Posterize level-count assertion use an input that can actually exercise it."""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "tests" / "gaea-halftone-test.mjs"
t = p.read_text(encoding="utf-8")

old = """  // POSTERIZE IS THE CHECKABLE ONE. False passes -1, i.e. two levels; true passes Depth.
  const post = gaeaHalftone(ctx({ Pattern: 'O4X4', Posterize: true, Depth: 5 }));
  const distinct = new Set();
  for (const v of post.data) distinct.add(v.toFixed(4));
  ok(distinct.size > 2, 'Posterize with Depth 5 yields more than two levels', distinct.size);
  ok(distinct.size <= 6, 'and no more than Depth levels', distinct.size);"""
new = """  // POSTERIZE IS THE CHECKABLE ONE, but it needs an input that can exercise it. The field above
  // is a CONSTANT, and a constant quantised to five levels lands in the middle of one step, so
  // varying the threshold by +-1 cannot cross a boundary and only one value comes out. That is
  // correct behaviour; the first version of this assertion called it a failure. A ramp is what
  // actually spans the levels.
  const ramp = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) ramp[y * size + x] = x / (size - 1);
  const rctx = (params) => ({ size, params, input: () => ({ data: ramp, channels: 1, size, channel: 'height' }) });

  const post = gaeaHalftone(rctx({ Pattern: 'O4X4', Posterize: true, Depth: 5 }));
  const distinct = new Set();
  for (const v of post.data) distinct.add(v.toFixed(4));
  ok(distinct.size > 2, 'Posterize with Depth 5 yields more than two levels', distinct.size);
  ok(distinct.size <= 5, 'and no more than Depth levels', distinct.size);

  // Without Posterize the SAME RAMP must still come out binary, which is what the -1 sentinel
  // means: the depth is ignored entirely.
  const bin = gaeaHalftone(rctx({ Pattern: 'O4X4', Posterize: false, Depth: 5 }));
  const binDistinct = new Set();
  for (const v of bin.data) binDistinct.add(v.toFixed(4));
  ok(binDistinct.size === 2, 'without Posterize the ramp is dithered to exactly two values',
    [...binDistinct].join(','));"""
if old not in t:
    print("  !! posterize block not found")
    sys.exit(1)
t = t.replace(old, new)
p.write_text(t, encoding="utf-8")
print("  posterize assertion now uses a ramp, and pins the binary case too")
