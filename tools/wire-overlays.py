#!/usr/bin/env python3
"""Wire the viewport overlays into Renderer3D.

NOTE ON INDENTATION: the class members in render3d.js are indented TWO spaces. An earlier attempt
used four, having taken the indent from a shell dump that prefixed every line with "  " for
display, and the replacement silently failed to match.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
r3d = WS / "web" / "js" / "render3d.js"

t = r3d.read_text(encoding="utf-8")
if "ViewportOverlay" in t:
    print("  render3d.js already wired")
    sys.exit(0)

imp = "import * as THREE from '../vendor/three/three.module.js';"
if imp not in t:
    print("  !! three import anchor not found")
    sys.exit(1)
t = t.replace(imp, imp + "\nimport { ViewportOverlay } from './overlays.js';", 1)

# Create the overlay after the WebGLRenderer constructor call completes.
anchor = "      this.renderer = new THREE.WebGLRenderer({"
if anchor not in t:
    print("  !! renderer anchor not found")
    sys.exit(1)
i = t.index(anchor)
j = t.index("      });", i) + len("      });")
t = t[:j] + """

    // Gaea's viewport overlays (Resources/Overlays) are REFERENCE LAYERS drawn over the frame,
    // not node inputs, so they live here rather than in a kernel. Created alongside the renderer
    // and left invisible until `setOverlay` names one.
    this.overlay = new ViewportOverlay(canvas.clientWidth || 1, canvas.clientHeight || 1);""" + t[j:]

old_render = """  render(clear) {
    if (!this.ok) return;
    if (clear) this.renderer.setClearColor(clear.r, clear.g, clear.b, clear.a ?? 1);
    this.renderer.render(this.scene, this.camera);
  }"""
new_render = """  render(clear) {
    if (!this.ok) return;
    if (clear) this.renderer.setClearColor(clear.r, clear.g, clear.b, clear.a ?? 1);
    this.renderer.render(this.scene, this.camera);
    // The overlay draws on top. ViewportOverlay.render suppresses autoClear around its own pass
    // so it does not wipe the scene it is overlaying.
    if (this.overlay) this.overlay.render(this.renderer);
  }"""
if old_render not in t:
    print("  !! render() block not found")
    sys.exit(1)
t = t.replace(old_render, new_render, 1)

old_resize = "  resize(width, height) {"
if old_resize not in t:
    print("  !! resize() not found")
    sys.exit(1)
t = t.replace(old_resize, """  /**
   * Show one of Gaea's viewport overlays by name, or null to hide it.
   *
   * Returns false when the texture is not loaded, so a caller can name the missing overlay rather
   * than showing an empty frame -- these assets are gitignored vendor data and an unextracted
   * clone is an ordinary state.
   */
  setOverlay(name, opacity) {
    if (!this.overlay) return false;
    return this.overlay.show(name, opacity);
  }

  /** Per-overlay readiness, for a status readout. */
  overlayStatus() {
    return this.overlay ? this.overlay.status() : [];
  }

  /** Load the overlay textures; awaitable before any evaluation. */
  loadOverlays() {
    return this.overlay ? this.overlay.loadAll() : Promise.resolve({ loaded: 0, failed: [] });
  }

  resize(width, height) {
    if (this.overlay) this.overlay.resize(width, height);""", 1)

old_dispose = "      if (this.texture) this.texture.dispose();"
if old_dispose in t:
    t = t.replace(old_dispose, old_dispose
                  + "\n      if (this.overlay) this.overlay.dispose();", 1)
    print("  render3d.js: overlay disposed with the rest")
else:
    print("  note: texture dispose line not found; overlay is not disposed explicitly")

r3d.write_text(t, encoding="utf-8")
print("  render3d.js: ViewportOverlay created, rendered, exposed and resized")
