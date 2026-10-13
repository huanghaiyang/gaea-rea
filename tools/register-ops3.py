#!/usr/bin/env python3
"""Register the five ops3 nodes recovered in round 37."""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "js" / "registry.js"
t = p.read_text(encoding="utf-8")

if "name: 'Bulbous', algorithm: gaeaBulbous" in t:
    print("  already registered")
    sys.exit(0)

imp_anchor = "import { gaeaAngle, gaeaFilter, gaeaEdge, gaeaRoughen, gaeaCraggy } from './kernels/ops2.js';"
if imp_anchor not in t:
    print("  !! import anchor not found")
    sys.exit(1)
t = t.replace(imp_anchor, "import { gaeaGraphicEQ, gaeaPockmarks, gaeaOutcrops, gaeaRockMap,"
                          " gaeaBulbous } from './kernels/ops3.js';\n" + imp_anchor)

node_anchor = "  // FIVE MORE NODES FROM THE COST-RANKED WORKLIST (round 36)."
if node_anchor not in t:
    print("  !! node anchor not found")
    sys.exit(1)

BLOCK = """  // FIVE MORE FROM THE COST-RANKED WORKLIST (round 37).
  //
  // GraphicEQ, Pockmarks, Outcrops, RockMap and Bulbous. Provenance is unchanged: named Gaea
  // helpers (Profiles.GraphicEQ, Migrated.PockmarksProces, RockCore.Outcrops,
  // AspectMaps.RockMap, Migrated.BulbousProcess) whose bodies were not decompiled, so the
  // parameters and ranges are exact while the curves are standard forms.
  //
  // A SIXTH real bug turned up here, and it is the most instructive of the set. `Outcrops` and
  // `Pockmarks` both initialise their output field and then `continue` past cells that receive
  // no mark -- which silently left those cells at `createField`'s default of ZERO instead of
  // the input's value, erasing the terrain wherever nothing landed. The assertion that caught
  // it was the simplest one available: `Height: 0` should make the node an exact no-op.
  // A node that erases its input when it has nothing to add is not a no-op, and only a
  // no-op test says so.
  {
    name: 'GraphicEQ', algorithm: gaeaGraphicEQ, category: CAT.ADJ,
    summary: 'Seven-band equaliser over the height distribution. All bands at 1 is an identity.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Band1: {}, Band2: {}, Band3: {}, Band4: {}, Band5: {}, Band6: {}, Band7: {},
    },
  },
  {
    name: 'Pockmarks', algorithm: gaeaPockmarks, category: CAT.FX,
    summary: 'Scatters pits sized by Scale and thinned by Density; Invert turns them into bumps. Density 0 is a no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Size: {}, Scale: {}, Height: {}, Density: {}, Multiplier: {}, Invert: {}, Seed: {},
    },
  },
  {
    name: 'Outcrops', algorithm: gaeaOutcrops, category: CAT.FX,
    summary: 'Lays raised rock masses over the terrain, banded by Strata and optionally chipped. Density 0 is a no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Variations: {}, Strata: {}, Density: {}, Shape: {}, Chipped: {},
      Seed: {}, Size: {}, Height: {}, Rotation: {},
    },
  },
  {
    name: 'RockMap', algorithm: gaeaRockMap, category: CAT.MASK,
    summary: 'Masks where rock would sit, from slope against Coverage and Density. A flat field reads zero.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: { Coverage: {}, Density: {} },
  },
  {
    name: 'Bulbous', algorithm: gaeaBulbous, category: CAT.SHAPE,
    summary: 'Inflates or deflates the terrain masses; monotone in the input, with Jitter breaking the smoothness.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { Scale: {}, Jitter: {} },
  },
"""

t = t.replace(node_anchor, BLOCK + node_anchor)
p.write_text(t, encoding="utf-8")
print("  registered GraphicEQ, Pockmarks, Outcrops, RockMap, Bulbous")
