#!/usr/bin/env python3
"""Expose the overlay status on `window.__gaea.overlays`, which the boot never did.

`main.js` publishes `clut` and `thresholds` after their preloads but never `overlays`, so there was
no way to read the overlay state from the page. That omission is why diagnosing the reported
"overlay is not loaded" message needed a throwaway script instead of one line in the console.

The overlays are loaded by `Renderer3D` inside `Viewport`, which may not exist at boot time (the
renderer is created lazily). So this is not a preload: it reads the status whenever it is asked,
and returns an empty list while no renderer exists rather than inventing one.
"""
import pathlib
import sys

M = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "main.js"
t = M.read_text(encoding="utf-8")

if "__gaea" not in t:
    print("  !! __gaea block not found")
    sys.exit(1)

old = """  window.__gaea = {
    catalog,
    clut: clutStatus(),
    thresholds: thresholdStatus(),
    warnings,
  };"""
new = """  window.__gaea = {
    catalog,
    clut: clutStatus(),
    thresholds: thresholdStatus(),
    warnings,
  };

  // The overlay textures belong to the renderer inside `Viewport`, which is created lazily and may
  // not exist yet. So this is a GETTER rather than a snapshot: reading `window.__gaea.overlays`
  // always reflects the live renderer, and reports an empty list while there is none rather than
  // pretending the assets are missing.
  Object.defineProperty(window.__gaea, 'overlays', {
    enumerable: true,
    get() {
      const r3 = window.__viewportRenderer && window.__viewportRenderer();
      return r3 && r3.overlayStatus ? r3.overlayStatus() : [];
    },
  });"""
if old not in t:
    print("  !! __gaea assignment not found")
    sys.exit(1)
t = t.replace(old, new, 1)
M.write_text(t, encoding="utf-8")
print("  main.js: window.__gaea.overlays is now a live getter")

# The viewport needs to publish its renderer for that getter to reach.
S = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "stores" / "session.js"
s = S.read_text(encoding="utf-8")
if "__viewportRenderer" not in s:
    anchor = "export function detachViewport() {"
    s = s.replace(anchor, """/**
 * The renderer the boot exposes for inspection.
 *
 * `Viewport` creates its three.js renderer lazily, so there is no moment at boot when it can be
 * captured. Handing out a lookup instead of an instance is what lets `window.__gaea.overlays`
 * always read the live object.
 */
window.__viewportRenderer = () => viewport.value?.renderer3d || null;

""" + anchor, 1)
    S.write_text(s, encoding="utf-8")
    print("  session.js: publishes a renderer lookup")
else:
    print("  session.js already publishes the lookup")
