/**
 * overlays.js — Gaea's viewport overlays, drawn as screen-space layers.
 *
 * WHAT THESE ASSETS ARE, AND WHY THEY ARE NOT NODES
 * `Resources/Overlays` holds eight PNGs: colorcheck, colorgrid, dots, grid_dark, grid_light,
 * lines, quads, uv. They are REFERENCE LAYERS the application draws OVER the viewport, not data
 * any node consumes. So they are wired into the renderer rather than into a kernel, and the
 * registry deliberately does not mention them.
 *
 * WHY A SCREEN-SPACE QUAD
 * An overlay is a flat 2D image over the rendered frame. Applying it to the terrain's UVs instead
 * would make it move with the camera and distort with the geometry, which is the opposite of what
 * a reference grid is for. A quad drawn by a second orthographic camera after the scene is the
 * direct implementation of "draw this over the viewport", and it leaves the terrain shader
 * untouched.
 *
 * The textures are `web/assets/overlays/*.png`, produced by `tools/extract-assets.py`. That
 * directory is gitignored because these are vendor bytes, so an overlay that has not been
 * extracted must fail visibly rather than render a blank quad -- `loadAll()` reports per-name
 * results and `status()` exposes them.
 */

import * as THREE from '../vendor/three/three.module.js';

/** The eight shipped overlays, and what each is for. */
export const OVERLAY_NAMES = [
  'colorcheck', 'colorgrid', 'dots', 'grid_dark', 'grid_light', 'lines', 'quads', 'uv',
];

export const OVERLAY_BASE = 'assets/overlays';

/** Gaea's own descriptions, so the UI can label them without inventing text. */
export const OVERLAY_LABELS = {
  colorcheck: 'Colour calibration chart',
  colorgrid: 'Colour grid',
  dots: 'Dot grid',
  grid_dark: 'Grid on a dark background',
  grid_light: 'Grid on a light background',
  lines: 'Line grid',
  quads: 'Quad subdivision reference',
  uv: 'UV coordinate reference',
};

/**
 * Manages one screen-space overlay quad.
 *
 * Constructed with the same canvas size as the 3D renderer; `resize()` keeps it matched. Only one
 * overlay is visible at a time, which is how a reference layer is used -- stacking a grid on a UV
 * chart would defeat both.
 */
export class ViewportOverlay {
  constructor(width = 1, height = 1) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.textures = new Map();
    this.failures = new Map();
    this.current = null;
    this.opacity = 0.6;

    // A unit quad in clip space, so no camera maths is involved and the overlay cannot drift.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3,
    ));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry = geo;

    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: this.opacity,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1000;    // after everything in the scene

    // A dedicated scene and camera: the overlay must not be affected by the scene's camera, and
    // mixing them would put the quad in front of the terrain only by accident of draw order.
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** Load one overlay texture. Cached, so a second call is free. */
  async load(name) {
    if (this.textures.has(name)) return true;
    try {
      const url = `${OVERLAY_BASE}/${encodeURIComponent(name)}.png`;
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      // The overlays are reference charts: they must not be mirrored or flipped to look right.
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      this.textures.set(name, tex);
      this.failures.delete(name);
      return true;
    } catch (e) {
      // Recorded rather than thrown: a missing overlay is an ordinary state for a clone that has
      // not run tools/extract-assets.py, and it must not take the viewport down with it.
      this.failures.set(name, String(e && e.message ? e.message : e));
      return false;
    }
  }

  /** Load every overlay. Returns which succeeded and which did not. */
  async loadAll(names = OVERLAY_NAMES) {
    const failed = [];
    let loaded = 0;
    for (const n of names) {
      if (await this.load(n)) loaded++;
      else failed.push(n);
    }
    return { loaded, failed };
  }

  /** Per-name readiness, for a status readout or a test. */
  status() {
    return OVERLAY_NAMES.map((n) => ({
      name: n,
      label: OVERLAY_LABELS[n],
      loaded: this.textures.has(n),
      error: this.failures.get(n) ?? null,
    }));
  }

  /**
   * Show one overlay by name, or pass null to hide.
   * Returns false when the texture is not available, so a caller can report it instead of
   * silently showing nothing.
   */
  show(name, opacity = this.opacity) {
    if (name === null) {
      this.current = null;
      this.mesh.visible = false;
      return true;
    }
    const tex = this.textures.get(name);
    if (!tex) {
      this.mesh.visible = false;
      return false;
    }
    this.material.map = tex;
    this.material.opacity = Math.max(0, Math.min(1, opacity));
    this.material.needsUpdate = true;
    this.current = name;
    this.mesh.visible = true;
    return true;
  }

  setOpacity(v) {
    this.opacity = Math.max(0, Math.min(1, v));
    this.material.opacity = this.opacity;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    // The quad is in clip space, so nothing needs rescaling; the method exists so callers that
    // resize the 3D renderer have a matching call and the aspect ratio stays recorded.
  }

  /** Draw the overlay, if visible, using the given three.js renderer. */
  render(renderer) {
    if (!this.mesh.visible) return false;
    const prev = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prev;
    return true;
  }

  dispose() {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.geometry.dispose();
    this.material.dispose();
  }
}
