/**
 * viewport.js — the terrain preview.
 *
 * Two independent canvases, because a single canvas cannot own a WebGL2 and a Canvas2D
 * context at the same time (whichever getContext wins, the other returns null):
 *
 *   #view-canvas-2d  Canvas2D heightmap through the selected ramp. Always available, and the
 *                    source for "Export PNG" at build resolution.
 *   #view-canvas-3d  WebGL2 lit height mesh with an orbit camera. Preferred, because shaded
 *                    relief is how you actually judge an erosion result.
 *
 * Only one is visible at a time; both render the same field.
 */

import { paintField, rampCSS } from './colormap.js';
import { rafThrottle } from './util.js';
import { MeshWorkerController } from './mesh-worker-controller.js';
import { Renderer3D, SHADER_VERT_3D, SHADER_FRAG_3D } from './render3d.js';
import { buildMesh } from './mesh-build.js';

/* ------------------------------------------------------------------ GLSL */

/* ---------------------------------------------------------------- shaders */

/** Shader sources live in render3d.js; re-exported so the static GLSL checks in
 * tests/shader-src-test.mjs have one place to inspect. */
export const SHADER_VERT = SHADER_VERT_3D;
export const SHADER_FRAG = SHADER_FRAG_3D;

export class Viewport {
  constructor(canvas2d, canvas3d, opts = {}) {
    this.c2d = canvas2d;
    this.c3d = canvas3d;
    /** The layout box the canvases fill. Always measure THIS, never a hidden canvas. */
    this.host = opts.host || canvas2d.parentElement || canvas2d;
    this.mode = '2d';
    this.ramp = 'terrain';
    this.exaggeration = 1;
    this.field = null;
    this.mesh = null;
    this.renderer3d = null;
    this.glInfo = 'not initialised';
    this.error = null;
    this.onStatus = opts.onStatus || (() => {});
    this.camera = { yaw: 0.62, pitch: 0.72, dist: 2.45, target: [0, 0.18, 0] };
    this._schedule = rafThrottle(() => this.draw());

    /*
     * Redraw when the LAYOUT BOX changes, not only when the window does.
     *
     * `resize()` assigns `canvas.width`/`canvas.height`, and doing that CLEARS the canvas --
     * assigning either property resets the bitmap. `draw()` is safe because it resizes and then
     * paints, but anything that changes the box without going through `draw()` leaves the canvas
     * at its old pixel size, clipped by the smaller box, showing nothing. Dragging the graph /
     * preview splitter was exactly that: the grid row changed, `window` did not resize, and the 2D
     * view disappeared.
     *
     * A ResizeObserver on the host covers every cause -- the splitter, a window resize, the
     * preview being hidden and shown again -- instead of the one that happened to be reported.
     */
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        this.resize();
        this._schedule();
      });
      this._ro.observe(this.host);
    }

    this.ctx = this.c2d.getContext('2d', { alpha: false });
    this._initGL();
    this._bindControls();

    /**
     * Mesh building (the one CPU-heavy step per field change) is offloaded when a
     * Worker can be created. `meshWorker.diagnostics()` explains the mode, because in
     * a non-secure context the Worker API does not exist at all and the difference is
     * otherwise invisible.
     *
     * `onMeshMode` fires whenever that mode or the last build time changes, so the UI
     * can keep a persistent readout in sync rather than relying on a toast that
     * disappears before it is read.
     */
    this.onMeshMode = opts.onMeshMode || null;
    this.meshWorker = new MeshWorkerController({
      onChange: (diag) => { if (this.onMeshMode) this.onMeshMode(diag); },
    });
    this.meshWorker.init().then((res) => {
      if (!res.ok) this.onStatus(`3D mesh building runs on the UI thread — ${res.reason}`);
      else this._schedule();
      if (this.onMeshMode) this.onMeshMode(this.meshWorker.diagnostics());
    }).catch(() => { /* inline fallback already in place */ });
  }

  /* ---------------------------------------------------------- GL setup */

  _initGL() {
    // three.js owns the render target and geometry; viewport.js keeps the camera
    // maths and the pointer handlers, whose conventions are pinned by tests.
    this.renderer3d = new Renderer3D(this.c3d);
    this.glInfo = this.renderer3d.info;
  }

  get available3D() { return !!(this.renderer3d && this.renderer3d.available); }
  get status() { return this.glInfo; }

  /* ---------------------------------------------------------- controls */

  /**
   * Orbit the camera from a pointer delta. Exported as a pure function so the sign
   * conventions are testable without a WebGL context.
   * @param {{yaw:number,pitch:number,dist:number,target:number[]}} cam
   * @param {number} dx horizontal delta in CSS pixels
   * @param {number} dy vertical delta in CSS pixels
   * @returns {typeof cam} the same object, mutated
   */
  static orbit(cam, dx, dy) {
    cam.yaw -= dx * 0.008;
    cam.pitch = Math.max(0.05, Math.min(1.52, cam.pitch + dy * 0.006));
    return cam;
  }

  /**
   * Pan the camera target from a pointer delta, as DIRECT MANIPULATION: the terrain
   * follows the cursor in both axes. Drag up (dy < 0) moves the terrain up the
   * screen; drag right (dx > 0) moves it right.
   *
   * The two axes need OPPOSITE operators, because the camera orbits the target and
   * the world axes project onto the screen basis with different signs. Derive both
   * with `python tools/derive_pan_sign.py` (vertical) and
   * `python tools/derive_pan_horizontal.py` (horizontal) rather than by hand.
   *
   * Vertical: raising target[1] moves the terrain DOWN the screen, so
   *   operator            drag up (dy<0)      drag down (dy>0)
   *   target[1] += dy*s   terrain up          terrain down     <- wanted
   *   target[1] -= dy*s   terrain down        terrain up
   * hence `+= dy * s`.
   *
   * Horizontal: screen-right is `normalize(fwd x world_up)`, and at the default
   * camera `dot(world +X, screen_right) = +0.8139`. Raising target[0] therefore
   * moves the terrain LEFT on screen, so following the cursor needs the opposite
   * sign:
   *   operator            drag right (dx>0)   drag left (dx<0)
   *   target[0] += dx*s   terrain left        terrain right
   *   target[0] -= dx*s   terrain right       terrain left      <- wanted
   * hence `-= dx * s`. (The earlier `+=` was asserted by hand and was wrong.)
   *
   * The depth axis (target[2]) is deliberately NOT touched. Coupling it to dy was
   * measured to inject sideways drift (`python tools/derive_pan_screen_vector.py`:
   * 0.28x sideways at yaw 0.62, up to 2.09x at yaw 2.40), turning an up/down drag
   * into near-horizontal sliding.
   *
   * @param {{yaw:number,pitch:number,dist:number,target:number[]}} cam
   * @param {number} dx horizontal delta in CSS pixels
   * @param {number} dy vertical delta in CSS pixels
   * @returns {typeof cam} the same object, mutated
   */
  static pan(cam, dx, dy) {
    const s = cam.dist * 0.0022;
    cam.target[0] -= dx * s;
    cam.target[1] += dy * s;
    return cam;
  }

  /** Zoom by one wheel step; direction sign is the wheel's own. */
  static zoom(cam, deltaY) {
    cam.dist = Math.max(0.75, Math.min(9, cam.dist * (1 + Math.sign(deltaY) * 0.09)));
    return cam;
  }

  _bindControls() {
    const c = this.c3d;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      if (this.mode !== '3d') return;
      c.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) Viewport.pan(this.camera, dx, dy);
      else Viewport.orbit(this.camera, dx, dy);
      this._schedule();
    });
    const end = (e) => {
      if (!drag) return;
      drag = null;
      try { c.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      if (this.mode !== '3d') return;
      e.preventDefault();
      Viewport.zoom(this.camera, e.deltaY);
      this._schedule();
    }, { passive: false });
    c.addEventListener('dblclick', () => {
      this.camera = { yaw: 0.62, pitch: 0.72, dist: 2.45, target: [0, 0.18, 0] };
      this._schedule();
    });
  }

  /* ---------------------------------------------------------- API */

  setMode(mode) {
    if (mode === '3d' && !this.available3D) {
      this.onStatus(`3D view unavailable — ${this.glInfo}. Showing the 2D heightmap.`);
      mode = '2d';
    }
    this.mode = mode;
    this.c2d.hidden = mode !== '2d';
    this.c3d.hidden = mode !== '3d';
    this.resize();
    this.draw();
  }

  // Invalidation is decided centrally by `_meshStale`, which compares the height
  // array, its shape and the exaggeration. Setting `mesh = null` here would discard
  // a usable mesh every time a ramp changed, so these only schedule a redraw.
  setRamp(ramp) { this.ramp = ramp; this.pendingFull = null; this._schedule(); }
  setExaggeration(x) { this.exaggeration = x; this._schedule(); }

  setField(field) {
    this.field = field;
    this.pendingFull = null;
    this.resize();
    this.draw();
  }

  resize() {
    // Read the LAYOUT BOX the canvases fill, never a hidden canvas individually: a
    // `display:none` canvas reports a zero rect, which would leave the 3D canvas at its
    // default size the first time it is shown.
    const host = this.host;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    for (const canvas of [this.c2d, this.c3d]) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    if (this.renderer3d && this.renderer3d.available) this.renderer3d.resize(w, h);
  }

  /**
   * Release what the host resize observer holds.
   *
   * `detachViewport` already called `dispose?.()` -- the optional call is why its absence was
   * invisible: it did nothing, and every `view` toggle would have left another observer watching a
   * detached node.
   */
  dispose() {
    this._ro?.disconnect?.();
    this._ro = null;
    this.renderer3d?.dispose?.();
    this.renderer3d = null;
    this.field = null;
    this.pendingFull = null;
  }

  draw() {
    if (!this.field) return;
    this.resize();
    if (this.mode === '3d' && this.available3D) this._draw3D();
    else this._draw2D();
  }

  /** Full-resolution ImageData of the current field (export source). */
  fullImageData() {
    if (this.pendingFull) return this.pendingFull;
    const s = this.field;
    const img = new ImageData(s.size, s.size);
    paintField({ size: s.size, channels: s.channels || 1, data: s.data }, img, {
      ramp: this.ramp, min: s.min, max: s.max,
    });
    this.pendingFull = img;
    return img;
  }

  /* ---------------------------------------------------------- 2D */

  _draw2D() {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.field;
    const cw = this.c2d.width, ch = this.c2d.height;
    const img = this.fullImageData();
    if (!this._scratch || this._scratch.width !== s.size) {
      this._scratch = document.createElement('canvas');
      this._scratch.width = s.size;
      this._scratch.height = s.size;
      this._scratchCtx = this._scratch.getContext('2d');
    }
    this._scratchCtx.putImageData(img, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, cw, ch);
    // Crisp upscale for magnification, smooth downscale for minification.
    const scale = Math.min(cw / s.size, ch / s.size);
    ctx.imageSmoothingEnabled = scale < 1;
    if (scale < 1) ctx.imageSmoothingQuality = 'high';
    const dw = Math.max(1, Math.round(s.size * scale));
    const dh = Math.max(1, Math.round(s.size * scale));
    const dx = Math.round((cw - dw) / 2);
    const dy = Math.round((ch - dh) / 2);
    ctx.drawImage(this._scratch, dx, dy, dw, dh);
    ctx.strokeStyle = 'rgba(120,140,165,.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
    this._drawLegend(ctx, dx, dy, dw, dh);
  }

  _drawLegend(ctx, dx, dy, dw, dh) {
    const w = Math.min(120, dw * 0.4), h = 6;
    const x = dx + 8, y = dy + dh - 16;
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    const stops = rampCSS(this.ramp);
    const matches = stops.match(/rgb\([^)]+\)\s+[\d.]+%/g) || [];
    for (const piece of matches) {
      const parts = piece.split(/\s+/);
      grad.addColorStop(parseFloat(parts[1]) / 100, parts[0]);
    }
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(215,228,242,.8)';
    ctx.font = `${Math.max(9, Math.round(10 * (window.devicePixelRatio || 1)))}px ui-monospace, monospace`;
    ctx.fillText(this.field.min.toFixed(2), x, y - 3);
    const hi = this.field.max.toFixed(2);
    ctx.fillText(hi, x + w - ctx.measureText(hi).width, y - 3);
    ctx.restore();
  }

  /* ---------------------------------------------------------- 3D */

  _draw3D() {
    const s = this.field;
    if (this._meshStale(s)) this._requestMesh(s);

    const r = this.renderer3d;
    if (!r || !r.available) return;

    // Nothing to draw until the first mesh arrives; the request is already in
    // flight and a cleared frame beats blocking the UI thread.
    if (!this.mesh) return;

    r.resize(this.c3d.width, this.c3d.height);
    r.setCamera(this.camera);
    r.setRamp(this.ramp);
    r.render({ r: 0.043, g: 0.058, b: 0.078, a: 1 });
  }


  /**
   * A mesh is reusable while the height data, its shape and the vertical stretch are
   * unchanged. Camera moves change none of these, so orbiting and panning never
   * rebuild — which is what keeps interaction smooth.
   */
  _meshStale(s) {
    const m = this.mesh;
    if (!m) return true;
    if (!s || !s.data) return false;
    return m.src !== s.data || m.size !== s.size || m.exag !== this.exaggeration;
  }

  /**
   * Ask for a mesh, either from the worker or inline. At most one request is in
   * flight; `_meshRequest` holds the token so a late reply for superseded data is
   * discarded.
   */
  _requestMesh(s) {
    if (this._meshPending) return;
    if (!s || !s.data) return;
    this._meshPending = true;
    const token = s;
    this.meshWorker.request({
      data: s.data,
      size: s.size,
      channels: s.channels || 1,
      min: s.min,
      max: s.max,
      exaggeration: this.exaggeration,
      token,
    }).then((res) => {
      this._meshPending = false;
      // Superseded, or the field moved on while this was building.
      if (!res) { this._schedule(); return; }
      if (res.token !== this.field) { this._schedule(); return; }
      this._uploadMesh(res);
      this._schedule();
    }).catch((err) => {
      this._meshPending = false;
      this.onStatus(`3D mesh build failed: ${err.message}`);
    });
  }

  /**
   * Upload a built mesh to the GPU. The vertex buffer is rewritten every time; the
   * index buffer only when the topology changed, since it depends solely on `n`.
   */
  _uploadMesh(res) {
    const r = this.renderer3d;
    if (!r || !r.available) return;
    r.setMesh(res);
    this.ibCount = res.idx.length;
    this.mesh = {
      src: res.token,
      size: res.token && res.token.size,
      exag: this.exaggeration,
      n: res.n,
      stride: res.stride,
      vertices: res.vertices,
      triangles: res.triangles,
      mode: res.mode,
      buildMs: res.buildMs,
    };
    this._uploadHeightTexture(res.n, res.stride);
  }

  /**
   * Upload the height field as a single-channel float texture so the fragment
   * shader can derive normals, occlusion and specular per pixel.
   *
   * Normalized to 0..1 (and widened when the field is flat) so the shader never
   * depends on reading a negative value out of a float texture.
   */
  _uploadHeightTexture(n, stride) {
    const r = this.renderer3d;
    const s = this.field;
    if (!r || !r.available || !s || !s.data) return;

    const size = s.size;
    const channels = s.channels || 1;
    const gridStep = n > 1 ? 1 / (n - 1) : 1;
    const width = (n - 1) * (stride * gridStep);
    this._meshWidth = width;

    const range = s.max - s.min;
    const wide = range > 1e-9;
    const inv = wide ? 1 / range : 1;

    const tex = new Float32Array(size * size);
    const data = s.data;
    if (wide) {
      for (let i = 0, p = 0; i < tex.length; i++, p += channels) {
        tex[i] = (data[p] - s.min) * inv;
      }
    } else {
      tex.fill(0.5);
    }

    r.setHeightTexture(tex, size, width);
    this._heightTexSize = size;
  }

  get meshInfo() { return this.mesh; }
}
