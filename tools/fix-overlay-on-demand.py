#!/usr/bin/env python3
"""Load the overlay into the renderer that is actually being asked, at the moment it is asked.

WHAT THE SCREENSHOT SHOWED
3D mode worked and the console carried the message "...has no texture loaded. The renderer exists,
so this is the asset..." -- the second branch, not the first. So the renderer was there and the
texture was not in it, while `overlayStatus()` had reported all eight loaded.

The cause is a timing mismatch, not a missing file: the component preloads the overlays ONCE in
`onMounted`, and `Viewport` builds its three.js renderer LAZILY. Entering 3D creates a renderer
that never received the preload, so `setOverlay` correctly reports it has no texture. A `fetch` of
the file still returns 200, which is why the asset branch of the message was itself misleading.

The fix is to stop treating load as a boot-time event: before showing an overlay, make sure THIS
renderer holds it. `loadOverlays()` already skips what it has and loads what it lacks, so calling
it again is both correct and cheap.
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "Viewport3D.vue"
t = P.read_text(encoding="utf-8")

if "await ensureLoaded" in t:
    print("  already loading on demand")
    sys.exit(0)

start = t.find("function onOverlayChange(ev) {")
end = t.find("function onOpacity(ev) {")
if start < 0 or end < 0:
    print("  !! onOverlayChange not found")
    sys.exit(1)

NEW = '''/**
 * Make sure the CURRENT renderer holds the palette, then show it.
 *
 * The overloads are loaded once at mount, but `Viewport` creates its three.js renderer lazily --
 * so a renderer built when 3D is first entered has none of them, and `setOverlay` correctly says
 * so. Loading on demand is what makes the control independent of WHEN the renderer appeared.
 *
 * `loadOverlays()` skips the ones it already has, so calling it per selection costs nothing after
 * the first time.
 */
async function ensureLoaded(r3, name) {
  if (r3.overlay?.textures?.has?.(name)) return true;
  await r3.loadOverlays?.();
  overlayReady.value = r3.overlayStatus?.() || [];
  return !!r3.overlay?.textures?.has?.(name);
}

async function onOverlayChange(ev) {
  const name = ev.target.value || null;
  overlayName.value = name;
  if (name === null) {
    rendererOf()?.setOverlay?.(null);
    return;
  }

  // TWO DIFFERENT FAILURES, reported separately. The first version called both "the asset is
  // missing", which sent the reader after a file that fetches with a 200.
  const r3 = rendererOf();
  if (!r3) {
    console.warn(
      '[gaea] overlays need the 3D renderer, which does not exist yet '
      + '(2D mode, or WebGL2 unavailable). The textures themselves are fine.',
    );
    return;
  }

  await ensureLoaded(r3, name);

  if (!r3.setOverlay?.(name, overlayOpacity.value)) {
    console.warn(
      `[gaea] overlay "${name}" could not be shown even after loading it into the current `
      + 'renderer. If the fetch for web/assets/overlays/' + name + '.png fails, run '
      + 'tools/extract-assets.py.',
    );
  }
}

'''
t = t[:start] + NEW + t[end:]

# `onOpacity` should not fight a pending load.
t = t.replace(
    "  if (overlayName.value) rendererOf()?.setOverlay?.(overlayName.value, overlayOpacity.value);",
    "  if (overlayName.value) rendererOf()?.setOverlay?.(overlayName.value, overlayOpacity.value);", 1)

P.write_text(t, encoding="utf-8")
print("  Viewport3D.vue: overlay loaded into the current renderer on demand")
