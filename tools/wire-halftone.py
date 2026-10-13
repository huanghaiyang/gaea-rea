#!/usr/bin/env python3
"""Register the Halftone node and add the threshold-map preload to the app boot."""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
reg = WS / "web" / "js" / "registry.js"
app = WS / "web" / "js" / "app.js"

# ------------------------------------------------------------------ registry
r = reg.read_text(encoding="utf-8")
if "name: 'Halftone'" in r:
    print("  Halftone already registered")
else:
    imp = "import { gaeaCLUTer, CLUT_NAMES } from './clut.js';"
    if imp not in r:
        print("  !! clut import anchor not found")
        sys.exit(1)
    r = r.replace(imp, "import { gaeaHalftone, HALFTONE_PATTERN_NAMES } from './kernels/halftone.js';\n" + imp)

    node_anchor = "  // CLUTer -- the first node wired to EXTRACTED VENDOR DATA rather than to a formula."
    if node_anchor not in r:
        print("  !! node anchor not found")
        sys.exit(1)

    BLOCK = """  // Halftone -- the second node backed by extracted vendor data.
  //
  // Its managed Build() is
  //
  //     RenderAsMask(true);
  //     Migrated.HalftoneProcess(input, Posterize ? Depth : (-1), Pattern, maps)
  //
  // `maps` is the threshold-map set and `Pattern` picks from it. THE ENUM IS IMAGEMAGICK'S MAP
  // SET: `HalftonePattern` has eighteen values and sixteen of them are threshold maps that
  // `tools/extract-magick.py` pulls out of Resources/Magick/thresholds.xml, with the enum value
  // lowerecased matching the map name for O2X2 through the six C-maps. Two pair by SHAPE rather
  // than name -- DIAG is `diag5x5` and HLINE is `hlines12x4` -- and `HALFTONE_PATTERNS` flags
  // those with `byName: true` so a reader can tell a recovered correspondence from an assumed one.
  //
  // The remaining two, FloydSteinberg and Riemersma, are NOT maps. They are error diffusion and
  // its Hilbert-curve variant, and neither can be a lookup because each cell's threshold depends
  // on the error carried in from cells already visited. Both are implemented as their published
  // algorithms, which is why the node is `approx` even though sixteen of its patterns are exact.
  {
    name: 'Halftone', algorithm: gaeaHalftone, category: CAT.FX,
    summary: 'Dithers the field with one of ImageMagick\\'s threshold maps, or by error diffusion. Posterize off dithers to black and white.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: {
      Pattern: { d: 'FloydSteinberg', options: HALFTONE_PATTERN_NAMES, hint: 'Sixteen ordered maps decoded from Resources/Magick, plus two error-diffusion forms.' },
      Posterize: { d: false, hint: 'When off, Depth is passed as -1 and the result is binary.' },
      Depth: { d: 5, min: 2, max: 64, step: 1, hint: 'Only takes effect when Posterize is set.' },
    },
  },
"""
    r = r.replace(node_anchor, BLOCK + node_anchor)
    reg.write_text(r, encoding="utf-8")
    print("  registered Halftone")

# ----------------------------------------------------------------------- app boot
a = app.read_text(encoding="utf-8")
if "preloadThresholds" in a:
    print("  threshold preload already wired")
    sys.exit(0)

imp = "import { preloadCLUTs, clutStatus } from './clut.js';"
if imp not in a:
    print("  !! clut import anchor missing in app.js")
    sys.exit(1)
a = a.replace(imp, imp + "\nimport { preloadThresholds, thresholdStatus } from './kernels/halftone.js';")

anchor = "    // Gaea's eight built-in palette textures, decoded up front."
if anchor not in a:
    print("  !! boot anchor not found")
    sys.exit(1)

boot = """    // The Halftone node's threshold maps, decoded alongside the palettes.
    //
    // Same reasoning as the CLUTs: the kernels are synchronous and the maps are a fetched file,
    // so the set has to be in the cache before a graph using Halftone is evaluated. Also
    // non-fatal -- the maps come from the same gitignored `web/assets/`, so a clone that has not
    // run tools/extract-magick.py is an ordinary state, and during it the two diffusion patterns
    // still work while the sixteen ordered ones fall back to Floyd-Steinberg.
    try {
      const th = await preloadThresholds();
      if (!th.loaded) {
        console.warn(
          '[halftone] no threshold maps available; ordered patterns will fall back to '
          + 'Floyd-Steinberg. Run tools/extract-magick.py to regenerate web/assets/magick/.',
        );
      }
      window.__thresholdStatus = thresholdStatus();
    } catch (e) {
      console.warn('[halftone] threshold preload failed.', e);
    }

""" + anchor

a = a.replace(anchor, boot, 1)
app.write_text(a, encoding="utf-8")
print("  app.js: threshold preload added to init()")
print("  exposed as window.__thresholdStatus")
