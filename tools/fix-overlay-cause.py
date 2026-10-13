#!/usr/bin/env python3
"""Stop blaming a missing asset when the real cause is a missing renderer.

WHAT THE DIAGNOSTIC SHOWED

    forced load:    {"renderer3d": null, "note": "Viewport has no renderer3d yet"}
    real selection: {"selected":"colorcheck", "loadedAfterSelect":0, "colorcheckLoaded":false}
    fetch:          colorcheck -> 200 OK

The texture files are present and served. The overlay quad, however, lives on the three.js
renderer, and `Viewport` creates that renderer LAZILY -- so with no WebGL2 context (headless with
`--disable-gpu` is exactly that case) or before 3D has ever been entered, `renderer3d` is null and
the overlays were never loaded at all.

The old message said "overlay colorcheck is not loaded; run tools/extract-assets.py", which sends
the reader after a missing FILE when the file is fine. That is worse than no message: it makes a
renderer-availability problem look like a build problem, and I spent a diagnostic run believing it.

Two changes:
  * the component distinguishes the two causes and says which one it is
  * the dropdown is disabled while there is no renderer, because an overlay cannot be shown without
    one -- offering a control that can only fail is its own defect
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "Viewport3D.vue"
t = P.read_text(encoding="utf-8")

old = """function onOverlayChange(ev) {
  const name = ev.target.value || null;
  overlayName.value = name;
  const r3 = rendererOf();
  if (!r3) {
    console.warn('[gaea] overlay requested before the renderer exists');
    return;
  }
  if (name === null) { r3.setOverlay?.(null); return; }
  // `setOverlay` returns false for a texture it does not have; routing through the return value is
  // what lets a missing asset be reported instead of showing an empty quad.
  if (!r3.setOverlay?.(name, overlayOpacity.value)) {
    console.warn(`[gaea] overlay "${name}" is not loaded; run tools/extract-assets.py`);
  }
}"""
new = """function onOverlayChange(ev) {
  const name = ev.target.value || null;
  overlayName.value = name;
  if (name === null) {
    rendererOf()?.setOverlay?.(null);
    return;
  }

  // TWO DIFFERENT FAILURES, and the first version reported both as "the asset is missing".
  //
  // The overlay quad is drawn by the three.js renderer, and `Viewport` builds that renderer
  // lazily -- so in 2D mode, or whenever WebGL2 is unavailable, there is no renderer and the
  // overlays were never loaded. Saying "run tools/extract-assets.py" then sends the reader after a
  // file that is present and served (a fetch of it returns 200).
  const r3 = rendererOf();
  if (!r3) {
    console.warn(
      '[gaea] overlays need the 3D renderer, which does not exist yet '
      + '(2D mode, or WebGL2 unavailable). The textures themselves are fine.',
    );
    return;
  }
  if (!r3.setOverlay?.(name, overlayOpacity.value)) {
    console.warn(
      `[gaea] overlay "${name}" has no texture loaded. The renderer exists, so this is the asset: `
      + 'run tools/extract-assets.py to regenerate web/assets/overlays/.',
    );
  }
}"""
if old not in t:
    print("  !! onOverlayChange not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# Disable the control while it cannot work, and say why.
t = t.replace(
    """        <label v-if="availableOverlays.length" class="tb-field" :title="term('Overlay')">""",
    """        <label
          v-if="availableOverlays.length"
          class="tb-field"
          :title="rendererReady
            ? term('Overlay')
            : term('Overlays need the 3D renderer; the textures are present but nothing can draw them in 2D.')"
        >""")
t = t.replace(
    """          <select
            :value="overlayName"
            :aria-label="term('Overlay')"
            @change="onOverlayChange"
          >""",
    """          <select
            :value="overlayName"
            :disabled="!rendererReady"
            :aria-label="term('Overlay')"
            @change="onOverlayChange"
          >""")

# `rendererReady` has to be reactive, so it is re-checked when the viewport publishes a renderer.
if "const rendererReady" not in t:
    anchor = "const availableOverlays = computed(() => overlayReady.value.filter((o) => o.loaded));"
    t = t.replace(anchor, anchor + """

/**
 * Whether a renderer exists to draw an overlay with.
 *
 * Reactive rather than a one-time check: `Viewport` creates its renderer lazily, so this becomes
 * true only after the first 3D frame or a mode switch, and the control must un-disable itself then.
 */
const rendererReady = ref(false);""", 1)

# Poll the renderer once after mount and whenever the mode changes -- cheap, and it is the only
# signal available without reaching into `Viewport`'s internals.
if "rendererReady.value = !!rendererOf()" not in t:
    t = t.replace(
        """function chooseMode(m) {
  setViewMode(m);
  mode.value = m;
}""",
        """function chooseMode(m) {
  setViewMode(m);
  mode.value = m;
  // The renderer is created on demand, so a mode switch is exactly when it can appear.
  setTimeout(() => { rendererReady.value = !!rendererOf(); }, 400);
}""", 1)

    t = t.replace(
        """  const r3 = rendererOf();
  if (r3?.loadOverlays) {""",
        """  const r3 = rendererOf();
  rendererReady.value = !!r3;
  if (r3?.loadOverlays) {""", 1)

P.write_text(t, encoding="utf-8")
print("  Viewport3D.vue: renderer-missing and asset-missing are now distinct, and the control")
print("                  reflects whether it can work at all")
