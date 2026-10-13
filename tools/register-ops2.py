#!/usr/bin/env python3
"""Register the five ops2 nodes recovered in round 36."""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "js" / "registry.js"
t = p.read_text(encoding="utf-8")

if "name: 'Craggy', algorithm: gaeaCraggy" in t:
    print("  already registered")
    sys.exit(0)

anchor_imp = "import { gaeaThreshold, gaeaSoftClip, gaeaTerraces, gaeaPixelate,"
if anchor_imp not in t:
    print("  !! import anchor not found")
    sys.exit(1)
t = t.replace(
    anchor_imp,
    "import { gaeaAngle, gaeaFilter, gaeaEdge, gaeaRoughen, gaeaCraggy } from './kernels/ops2.js';\n"
    + anchor_imp,
)

anchor = "  // FIVE SMALL NODES FROM THE COST-RANKED WORKLIST (round 35)."
if anchor not in t:
    print("  !! node anchor not found")
    sys.exit(1)

BLOCK = """  // FIVE MORE NODES FROM THE COST-RANKED WORKLIST (round 36).
  //
  // Angle, Filter, Edge, Roughen and Craggy. Same provenance as the batch above: each calls a
  // named Gaea helper (AspectMaps.GetAngle, FilterCore.FilterProcess, Migrated.EdgeProcess,
  // Migrated.RoughenProcess, Migrated.CraggyProcess) whose body was not decompiled, so the
  // parameters and ranges are exact while the curves are standard published forms.
  //
  // The test turned up a fifth real bug: the low-pass branch returned `low + detail`, which is
  // the identity, so `Filter` did nothing at Gain 1 and the variance was unchanged to the
  // digit. The assertion that caught it was the most obvious one available -- a low-pass must
  // reduce variance -- which is worth noting, because round 35's four bugs were all caught by
  // equivalently simple property checks rather than by anything elaborate.
  {
    name: 'Angle', algorithm: gaeaAngle, category: CAT.MASK,
    summary: 'Marks how much the terrain faces an azimuth. A flat cell reads 0, having no aspect.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: { Azimuth: {}, Range: {}, Falloff: { hint: 'Widens the cutoff around the range.' } },
  },
  {
    name: 'Filter', algorithm: gaeaFilter, category: CAT.ADJ,
    summary: 'Low, high or band-passes the field at Frequency, with Gain on the selected band and KeepDC preserving the mean.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Mode: { hint: 'LowPass keeps the base, HighPass keeps the detail.' },
      Frequency: {}, Gain: {}, Q: {},
      KeepDC: { hint: 'Restores the input mean, which a band gain would otherwise shift.' },
    },
  },
  {
    name: 'Edge', algorithm: gaeaEdge, category: CAT.MASK,
    summary: 'Traces sharp boundaries: a gradient detector at the requested scale, with square or round weighting.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: { Style: {}, Size: {}, Pixels: {}, Softness: {} },
  },
  {
    name: 'Roughen', algorithm: gaeaRoughen, category: CAT.FX,
    summary: 'Adds oriented or isotropic noise displacement. Depth 0 is a strict no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { Width: {}, Depth: {}, Oriented: {}, Quality: {} },
  },
  {
    name: 'Craggy', algorithm: gaeaCraggy, category: CAT.FX,
    summary: 'Adds craggy relief at Size, with Shape trading smooth noise for ridged. Depth 0 is a strict no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { Size: {}, Depth: {}, Shape: {}, Seed: {} },
  },
"""

t = t.replace(anchor, BLOCK + anchor)
p.write_text(t, encoding="utf-8")
print("  registered Angle, Filter, Edge, Roughen, Craggy")
