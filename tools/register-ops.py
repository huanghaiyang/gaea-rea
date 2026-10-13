#!/usr/bin/env python3
"""Register the five ops nodes recovered in round 35."""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "js" / "registry.js"
t = p.read_text(encoding="utf-8")

if "name: 'Terraces', algorithm: gaeaTerraces" in t:
    print("  already registered")
    sys.exit(0)

if "from './kernels/ops.js'" not in t:
    anchor_imp = "import { gaeaLake } from './kernels/lake.js';"
    if anchor_imp not in t:
        print("  !! import anchor not found")
        sys.exit(1)
    t = t.replace(anchor_imp, anchor_imp
                  + "\nimport { gaeaThreshold, gaeaSoftClip, gaeaTerraces, gaeaPixelate,"
                    " gaeaCurvature } from './kernels/ops.js';")
    print("  import added")

anchor = "  // THE THREE GENUINE NO-OPS."
if anchor not in t:
    print("  !! node anchor not found")
    sys.exit(1)

BLOCK = """  // FIVE SMALL NODES FROM THE COST-RANKED WORKLIST (round 35).
  //
  // Each calls a named Gaea helper whose operation is fixed by the node's own parameters:
  // AspectMaps.GetThreshold, the SoftClip helper, Profiles.Terrace, Others.PixelateHeightfield
  // and AspectMaps.GetCurvature. The helper bodies live in the managed assembly and were NOT
  // decompiled, so every one of these is `approx`: the parameter shapes and ranges are exact
  // (taken from the [Parameter(...)] attributes) but the easing curves are published standard
  // forms, not transcriptions.
  //
  // Three real bugs were found while writing these and are recorded where they were fixed:
  // Terraces did not quantise at all (the exponent sat on the fractional part, cancelling to
  // the identity), the Curvature window returned 0.5 on flat ground instead of 0, and Concave
  // folded the Laplacian through Math.abs so both types returned the same mask. A fourth,
  // subtler one: the discrete Laplacian `neighbourMean - centre` is NEGATIVE at a peak, so the
  // convex branch had to be `-lap`, not `+lap` -- the test caught it as a ridge reading 0.
  {
    name: 'Threshold', algorithm: gaeaThreshold, category: CAT.MASK,
    summary: 'Splits the field at Level into a binary mask. The level is inclusive.',
    inputs: [H()], outputs: [OUT_MASK()], note: 'approx',
    params: { Level: { hint: 'Cells at or above this become 1; a strict test would darken a field sitting exactly on the level.' } },
  },
  {
    name: 'SoftClip', algorithm: gaeaSoftClip, category: CAT.ADJ,
    summary: 'Pulls values past a threshold back with a smooth knee; Softness 0 degenerates to a hard clip.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      ClipMode: { hint: 'AboveThreshold pulls high values down; BelowThreshold pulls low values up.' },
      Threshold: {}, Softness: {}, Clipping: {},
    },
  },
  {
    name: 'Terraces', algorithm: gaeaTerraces, category: CAT.SHAPE,
    summary: 'Quantises the field into NumTerraces bands, with Uniformity trading even spacing for jitter.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { NumTerraces: {}, Uniformity: {}, Steepness: {}, Intensity: {}, Seed: {} },
  },
  {
    name: 'Pixelate', algorithm: gaeaPixelate, category: CAT.ADJ,
    summary: 'Block-averages the field to Size, with Antialias off giving exactly one value per block.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Size: {}, Autosize: { hint: 'Overrides Size with a fixed scale.' }, Antialias: {},
    },
  },
  {
    name: 'Curvature', algorithm: gaeaCurvature, category: CAT.MASK,
    summary: 'Marks where the field bends, as a mask in Range. Convex lights peaks, Concave lights pits.',
    inputs: [H()], outputs: [OUT_MASK()], note: 'approx',
    params: { Range: {}, Type: {}, Falloff: {} },
  },
"""

t = t.replace(anchor, BLOCK + anchor)
p.write_text(t, encoding="utf-8")
print("  registered Threshold, SoftClip, Terraces, Pixelate, Curvature")
