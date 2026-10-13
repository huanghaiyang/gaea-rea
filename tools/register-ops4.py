#!/usr/bin/env python3
"""Register the four ops4 nodes recovered in round 38."""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "js" / "registry.js"
t = p.read_text(encoding="utf-8")

if "name: 'Accumulator', algorithm: gaeaAccumulator" in t:
    print("  already registered")
    sys.exit(0)

imp_anchor = "import { gaeaGraphicEQ, gaeaPockmarks, gaeaOutcrops, gaeaRockMap,"
if imp_anchor not in t:
    print("  !! import anchor not found")
    sys.exit(1)
t = t.replace(imp_anchor, "import { gaeaLichtenberg, gaeaOrigami, gaeaAperture,"
                          " gaeaAccumulator } from './kernels/ops4.js';\n" + imp_anchor)

node_anchor = "  // FIVE MORE FROM THE COST-RANKED WORKLIST (round 37)."
if node_anchor not in t:
    print("  !! node anchor not found")
    sys.exit(1)

BLOCK = """  // FOUR MORE FROM THE COST-RANKED WORKLIST (round 38).
  //
  // Lichtenberg, Origami, Aperture and Accumulator, from Erosions.Lichtenberg,
  // Migrated.OrigamiProcess, Morphology2.Aperture and Texturize.GetAccumulation. Same
  // provenance as the three batches before: parameters exact, curves standard forms, all
  // `approx`.
  //
  // ACCUMULATOR IS THE FIRST GENERATOR IN THESE BATCHES. It takes no input at all -- the
  // managed parameter list contains only a Type, a RestrictToGroup flag and a computed Warning
  // -- so its `inputs` array is empty and its whole content is the type selector. That is why
  // the test asserts the TYPES are anti-correlated rather than merely different: two masks that
  // differed only by a shift would satisfy "different" while meaning nothing.
  //
  // One assertion-design note worth recording. The first version of that check COUNTED cells
  // where snow exceeded rain and demanded more than 60%; it returned exactly 128 of 256,
  // because for two monotone gradients the split falls on the median. The masks were perfectly
  // anti-correlated and the test was measuring where the crossover sat, not whether one existed.
  // The assertion now uses the sign of the correlation.
  {
    name: 'Lichtenberg', algorithm: gaeaLichtenberg, category: CAT.EROS,
    summary: 'Branching discharge channels, deepened by Depth and widened by Expand. Depth 0 is a no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Style: {}, Scale: {}, Complexity: {}, Depth: {}, Expand: {}, Bias: {}, Seed: {},
    },
  },
  {
    name: 'Origami', algorithm: gaeaOrigami, category: CAT.SHAPE,
    summary: 'Folds the terrain along creased planes; the fold is piecewise-linear, so both sides rise. Amount 0 is a no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { Amount: {}, Seed: {} },
  },
  {
    name: 'Aperture', algorithm: gaeaAperture, category: CAT.ADJ,
    summary: 'Polygon-shaped morphological opening or closing; every cell is bracketed by the Erode and Dilate results.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Mode: {}, Size: {}, Shape: {}, VerticesCount: {}, CornerAngle: {},
      Direction: {}, Antialiased: {},
    },
  },
  {
    name: 'Accumulator', algorithm: gaeaAccumulator, category: CAT.PRIM,
    summary: 'Generates a material-accumulation mask from its Type alone, taking no input.',
    inputs: [], outputs: [MASK('Output')], note: 'approx',
    params: {
      Type: { hint: 'Snow settles high, rain collects low; the two are anti-correlated.' },
      RestrictToGroup: { hint: 'A graph-level scope, not a numeric effect; not reproduced.' },
    },
  },
"""

t = t.replace(node_anchor, BLOCK + node_anchor)
p.write_text(t, encoding="utf-8")
print("  registered Lichtenberg, Origami, Aperture, Accumulator")
