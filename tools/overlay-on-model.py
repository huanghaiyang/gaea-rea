#!/usr/bin/env python3
"""Render the overlay ON the terrain, and fix the `none` sentinel.

1. OVERLAY BELONGS ON THE MODEL, NOT OVER THE VIEWPORT
The first implementation drew it as a screen-space quad. The reasoning was that "a reference grid
must not move with the camera" -- which is true of a 2D viewport decoration and wrong here. `uv`,
`colorgrid` and the `grid_*` textures are UV and coordinate references for the GEOMETRY, so they
must be mapped through the model's own UVs: the screenshot showed a full-screen tiled pattern
sitting over the graph editor.

The mesh spans exactly one texture width, so the fragment's `vGrid` IS the UV. The overlay is
therefore a `texture2D(uOverlay, vGrid)` blended into the lit colour, driven by two uniforms -- no
second scene, no second camera, no quad.

2. THE `none` SENTINEL WAS A STRING
`<option :value="null">` becomes the string "none" once it is in the DOM: an option's value is
always text. So `ev.target.value` was never `null`, the `name === null` branch never ran, and the
component tried to load `none.png` -- which is the third symptom exactly.

3. THE DEFAULT IS `none`
The select starts with no overlay, which is also what the parameter panel offers for every other
optional thing.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
R = WS / "web" / "js" / "render3d.js"
V = WS / "web" / "src" / "components" / "Viewport3D.vue"

# ------------------------------------------------------------------ render3d ----
t = R.read_text(encoding="utf-8")

# 1a. Two uniforms.
old = """        uEye: { value: new THREE.Vector3() },
      };"""
new = """        uEye: { value: new THREE.Vector3() },
        // The overlay is drawn THROUGH the terrain's own UVs, so it needs no scene and no
          // camera of its own -- see the note on ViewportOverlay.
        uOverlay: { value: null },
        uOverlayAmt: { value: 0 },
      };"""
if old not in t:
    print("  !! uniforms block not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# 1b. Declare them in the fragment shader, next to the other samplers.
old = "uniform sampler2D uHeight;"
if old not in t:
    print("  !! uHeight declaration not found")
    sys.exit(1)
t = t.replace(old, old + """
uniform sampler2D uOverlay;      // reference layer, sampled through the terrain UVs
uniform float uOverlayAmt;       // 0 = off, so the default costs one branch""", 1)

# 1c. Blend it in just before the output.
old = "  gl_FragColor = vec4(toSrgb(lit * uExposure), 1.0);"
new = """  // The overlay is applied in the LIT domain, so a reference grid stays readable across the
  // whole height range instead of disappearing in the shadows.
  if (uOverlayAmt > 0.0) {
    vec4 ov = texture2D(uOverlay, vGrid);
    lit = mix(lit, mix(lit, ov.rgb, ov.a), uOverlayAmt);
  }

  gl_FragColor = vec4(toSrgb(lit * uExposure), 1.0);"""
if old not in t:
    print("  !! gl_FragColor line not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# 1d. `setOverlay` now drives the material; the screen-space quad is no longer drawn.
old_render = """    // The overlay draws on top. ViewportOverlay.render suppresses autoClear around its own pass
    // so it does not wipe the scene it is overlaying.
    if (this.overlay) this.overlay.render(this.renderer);"""
if old_render in t:
    t = t.replace(old_render, """    // No screen-space pass. The overlay is a texture on the terrain's material, so it is drawn by
    // the same draw call as the terrain and cannot cover the rest of the page.""", 1)
    print("  render3d.js: screen-space overlay pass removed")

old_show = """  setOverlay(name, opacity) {
    if (!this.overlay) return false;
    return this.overlay.show(name, opacity);
  }"""
if old_show in t:
    t = t.replace(old_show, """  /**
   * Show one of Gaea's reference layers ON the terrain, or null to hide it.
   *
   * Returns false when the texture is not loaded, so a caller can name what is missing instead of
   * rendering nothing. The texture is looked up in the same `ViewportOverlay` cache the loader
   * fills; only the drawing changed.
   */
  setOverlay(name, opacity) {
    if (!this.overlay) return false;
    if (name === null || name === undefined || name === '') {
      this.overlay.show(null);
      this.uniforms.uOverlayAmt.value = 0;
      return true;
    }
    if (!this.overlay.show(name, opacity)) return false;
    this.uniforms.uOverlay.value = this.overlay.textures.get(name);
    this.uniforms.uOverlayAmt.value = Math.max(0, Math.min(1, opacity ?? this.overlay.opacity));
    return true;
  }""", 1)
    print("  render3d.js: setOverlay drives the material uniforms")

R.write_text(t, encoding="utf-8")

# ----------------------------------------------------------------- viewport ----
v = V.read_text(encoding="utf-8")

# 2. The `none` option carries a real sentinel, and the handler tests for it.
v = v.replace("""            <option :value="null">{{ term('none') }}</option>""",
              """            <!-- An option's value is ALWAYS a string once it is in the DOM, so `:value="null"`
                 arrives as "null" and a `name === null` test never fires. A named sentinel is the
                 only reliable way to express "no overlay". -->
            <option value="">{{ term('none') }}</option>""")

v = v.replace("""async function onOverlayChange(ev) {
  const name = ev.target.value || null;
  overlayName.value = name;
  if (name === null) {
    rendererOf()?.setOverlay?.(null);
    return;
  }""",
"""async function onOverlayChange(ev) {
  // `''` is the sentinel the empty option carries. `null` never arrives from a select.
  const pick = ev.target.value;
  const name = pick === '' ? null : pick;
  overlayName.value = name;
  if (name === null) {
    rendererOf()?.setOverlay?.(null);
    return;
  }""")

# 3. Default to no overlay, and say so.
v = v.replace("const overlayName = ref(null);", "const overlayName = ref(null);   // none by default")
v = v.replace("""            :value="overlayName"
            :disabled="!rendererReady"
            :aria-label="term('Overlay')"
            @change="onOverlayChange"
          >""",
"""            :value="overlayName ?? ''"
            :disabled="!rendererReady"
            :aria-label="term('Overlay')"
            @change="onOverlayChange"
          >""")

V.write_text(v, encoding="utf-8")
print("  Viewport3D.vue: empty-string sentinel, none by default")
