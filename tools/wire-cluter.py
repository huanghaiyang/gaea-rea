#!/usr/bin/env python3
"""Fix clut.js to the RGBA field layout, then register the CLUTer node."""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
clut = WS / "web" / "js" / "clut.js"
reg = WS / "web" / "js" / "registry.js"

t = clut.read_text(encoding="utf-8")

# `CHANNELS.color` is 4 (RGBA), and `createField`'s third argument is a FILL VALUE, not a length.
old = """  const out = createField(size, 'color', n * 3);
  out.channels = 3;"""
new = """  // `CHANNELS.color` is 4, i.e. RGBA, and `createField`'s third argument is a FILL VALUE rather
  // than a length -- the first version passed `n * 3`, which would have been interpreted as the
  // value to fill every component with.
  const out = createField(size, 'color');"""
if old not in t:
    print("  !! clut.js field-creation block not found")
    sys.exit(1)
t = t.replace(old, new)

old = """    if (hue === 0 && sat === 0 && light === 0) {
      out.data[i * 3] = c.r;
      out.data[i * 3 + 1] = c.g;
      out.data[i * 3 + 2] = c.b;
      continue;
    }"""
new = """    if (hue === 0 && sat === 0 && light === 0) {
      out.data[i * 4] = c.r;
      out.data[i * 4 + 1] = c.g;
      out.data[i * 4 + 2] = c.b;
      out.data[i * 4 + 3] = 1;
      continue;
    }"""
if old not in t:
    print("  !! clut.js passthrough block not found")
    sys.exit(1)
t = t.replace(old, new)

old = """    const [r, g, b] = hsl2rgb(h, s, Math.max(0, Math.min(1, l)));
    out.data[i * 3] = r;
    out.data[i * 3 + 1] = g;
    out.data[i * 3 + 2] = b;"""
new = """    const [r, g, b] = hsl2rgb(h, s, Math.max(0, Math.min(1, l)));
    out.data[i * 4] = r;
    out.data[i * 4 + 1] = g;
    out.data[i * 4 + 2] = b;
    out.data[i * 4 + 3] = 1;"""
if old not in t:
    print("  !! clut.js hsl block not found")
    sys.exit(1)
t = t.replace(old, new)

# `n` is now only used by the loop bound, so keep it but drop the misleading name use.
clut.write_text(t, encoding="utf-8")
print("  clut.js: RGBA layout (4 channels)")

# ------------------------------------------------------------------ registry
r = reg.read_text(encoding="utf-8")
if "name: 'CLUTer'" in r:
    print("  CLUTer already registered")
    sys.exit(0)

if "const OUT_C" not in r:
    anchor = "const MASK = (name = 'Mask') => ({ name, kind: 'mask' });"
    if anchor not in r:
        print("  !! output-helper anchor not found")
        sys.exit(1)
    r = r.replace(anchor, anchor + "\nconst OUT_C = (name = 'Output') => ({ name, kind: 'color' });")
    print("  added the OUT_C colour output helper")

if "from './clut.js'" not in r:
    imp = "import { gaeaThreshold, gaeaSoftClip, gaeaTerraces, gaeaPixelate,"
    if imp not in r:
        print("  !! import anchor not found")
        sys.exit(1)
    r = r.replace(imp, "import { gaeaCLUTer, CLUT_NAMES } from './clut.js';\n" + imp)
    print("  added the clut.js import")

node_anchor = "  // FOUR MORE FROM THE COST-RANKED WORKLIST (round 38)."
if node_anchor not in r:
    print("  !! node anchor not found")
    sys.exit(1)

BLOCK = """  // CLUTer -- the first node wired to EXTRACTED VENDOR DATA rather than to a formula.
  //
  // Its managed Build() maps a grayscale height through `GradientData` and then applies Bias,
  // Hue, Saturation and Lightness:
  //
  //     Migrated.ClutterProcess(input.GrayscaleConversion(2), GradientData, gradient,
  //                             AutolevelInput, Reverse, Bias, Hue, Saturation, Lightness)
  //
  // `GradientData` is the gradient chosen in the UI's GradientEditor, and the eight `.clut`
  // files in Resources/Color are Gaea's built-in presets for that editor. They are now decoded
  // from `web/assets/color/*.png` (see tools/extract-assets.py), which is what makes this node
  // reproduce the vendor's OWN palettes instead of an invented ramp.
  //
  // The palettes are PNG textures, so decoding is async while kernels are synchronous. They are
  // decoded once by `preloadCLUTs()` and cached; a palette that has not loaded falls back to a
  // grey ramp and `clutStatus()` reports which. Silent fallback would make a missing asset look
  // like a desaturated image rather than an error.
  {
    name: 'CLUTer', algorithm: gaeaCLUTer, category: CAT.IO,
    summary: 'Maps a grayscale field through one of Gaea\\'s eight built-in palette textures, then adjusts hue, saturation and lightness.',
    inputs: [H()], outputs: [OUT_C()], note: 'approx',
    params: {
      GradientData: { d: 'Rock', options: CLUT_NAMES, hint: 'One of Gaea\\'s shipped CLUT presets, decoded from Resources/Color.' },
      Bias: { d: 0, min: -1, max: 1, step: 0.01, hint: 'Shifts the lookup position; distinct from Lightness.' },
      Hue: { d: 0, min: -1, max: 1, step: 0.01 },
      Saturation: { d: 0, min: -1, max: 1, step: 0.01 },
      Lightness: { d: 0, min: -1, max: 1, step: 0.01 },
    },
  },
"""

r = r.replace(node_anchor, BLOCK + node_anchor)
reg.write_text(r, encoding="utf-8")
print("  registered CLUTer")
