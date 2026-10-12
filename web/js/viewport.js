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
import { buildMesh } from './mesh-build.js';

/* ------------------------------------------------------------------ GLSL */

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aHeight;
uniform mat4 uProj;
uniform mat4 uView;
out vec3 vNormal;
out float vHeight;
out vec2 vGrid;
out vec3 vWorld;
void main() {
  vNormal = aNormal;
  vHeight = aHeight;
  // Grid position in 0..1. The mesh spans exactly one texture width, so this is also
  // the height-texture coordinate used for per-pixel normals.
  vGrid = aPos.xz + 0.5;
  vWorld = aPos;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vHeight;
in vec2 vGrid;
in vec3 vWorld;
out vec4 outColor;
uniform int uRamp;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uExposure;
uniform sampler2D uHeight;
uniform float uNormalRes;    // 0 disables texture normals (texture unavailable)
uniform vec2 uNormalScale;   // height units -> world slope
uniform vec2 uTexel;         // 1 / field size
uniform vec2 uDetail;        // fine detail normal strength
uniform vec3 uSky;
uniform vec3 uAOI;           // x: strength, y: reach in texels, z: floor
uniform vec3 uSpec;          // x: strength, y: shininess
uniform vec3 uEye;           // camera position in world space

vec3 toSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

vec3 rampTerrain(float x) {
  vec3 c0 = vec3(0.020, 0.055, 0.098);
  vec3 c1 = vec3(0.055, 0.153, 0.196);
  vec3 c2 = vec3(0.145, 0.278, 0.180);
  vec3 c3 = vec3(0.310, 0.400, 0.196);
  vec3 c4 = vec3(0.482, 0.443, 0.259);
  vec3 c5 = vec3(0.600, 0.520, 0.365);
  vec3 c6 = vec3(0.678, 0.612, 0.510);
  vec3 c7 = vec3(0.760, 0.735, 0.690);
  vec3 c8 = vec3(0.870, 0.880, 0.880);
  vec3 c9 = vec3(0.980, 0.990, 1.000);
  float t = clamp(x, 0.0, 1.0) * 9.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  if (t < 4.0) return mix(c3, c4, t - 3.0);
  if (t < 5.0) return mix(c4, c5, t - 4.0);
  if (t < 6.0) return mix(c5, c6, t - 5.0);
  if (t < 7.0) return mix(c6, c7, t - 6.0);
  if (t < 8.0) return mix(c7, c8, t - 7.0);
  return mix(c8, c9, t - 8.0);
}

vec3 rampFlow(float x) {
  float t = clamp(x, 0.0, 1.0);
  vec3 a = vec3(0.010, 0.030, 0.075);
  vec3 b = vec3(0.030, 0.140, 0.290);
  vec3 c = vec3(0.060, 0.360, 0.520);
  vec3 d = vec3(0.320, 0.680, 0.700);
  vec3 e = vec3(0.880, 0.980, 0.960);
  if (t < 0.35) return mix(a, b, t / 0.35);
  if (t < 0.65) return mix(b, c, (t - 0.35) / 0.30);
  if (t < 0.85) return mix(c, d, (t - 0.65) / 0.20);
  return mix(d, e, (t - 0.85) / 0.15);
}

vec3 rampHeat(float x) {
  float t = clamp(x, 0.0, 1.0);
  vec3 a = vec3(0.020, 0.000, 0.090);
  vec3 b = vec3(0.290, 0.000, 0.380);
  vec3 c = vec3(0.800, 0.130, 0.180);
  vec3 d = vec3(0.980, 0.600, 0.060);
  vec3 e = vec3(1.000, 1.000, 0.780);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.50) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.50) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}

void main() {
  vec3 n;
  // Ambient occlusion: 1 means fully lit, lower means sheltered by nearby terrain.
  float ao = 1.0;

  if (uNormalRes > 0.0) {
    // Per-pixel normal from the height texture, so shading detail is limited by the
    // FIELD resolution rather than by how many vertices the mesh has. The old path
    // interpolated vertex normals across each triangle, which is what flattened
    // ridges into soft blobs.
    float h = vHeight;
    float hl = texture(uHeight, vGrid - vec2(uTexel.x, 0.0)).r;
    float hr = texture(uHeight, vGrid + vec2(uTexel.x, 0.0)).r;
    float hd = texture(uHeight, vGrid - vec2(0.0, uTexel.y)).r;
    float hu = texture(uHeight, vGrid + vec2(0.0, uTexel.y)).r;
    n = normalize(vec3((hl - hr) * uNormalScale.x, 1.0, (hd - hu) * uNormalScale.y));

    // Two extra octaves of slope detail give the crisp drainage texture that a
    // single-texel difference cannot express.
    float h2l = texture(uHeight, vGrid - vec2(uTexel.x * 2.0, 0.0)).r;
    float h2r = texture(uHeight, vGrid + vec2(uTexel.x * 2.0, 0.0)).r;
    float h2d = texture(uHeight, vGrid - vec2(0.0, uTexel.y * 2.0)).r;
    float h2u = texture(uHeight, vGrid + vec2(0.0, uTexel.y * 2.0)).r;
    n = normalize(n + vec3((h2l - h2r) * uDetail.x, 0.0, (h2d - h2u) * uDetail.y));

    float h4l = texture(uHeight, vGrid - vec2(uTexel.x * 4.0, 0.0)).r;
    float h4r = texture(uHeight, vGrid + vec2(uTexel.x * 4.0, 0.0)).r;
    float h4d = texture(uHeight, vGrid - vec2(0.0, uTexel.y * 4.0)).r;
    float h4u = texture(uHeight, vGrid + vec2(0.0, uTexel.y * 4.0)).r;
    n = normalize(n + vec3((h4l - h4r) * uDetail.x * 0.5, 0.0, (h4d - h4u) * uDetail.y * 0.5));

    // Sky occlusion: how much higher the surrounding terrain sits. This is what puts
    // dark creases in valleys and under cliffs, which flat diffuse lighting misses.
    float m = uAOI.y;
    float occ = 0.0;
    occ += clamp((texture(uHeight, vGrid + vec2( uTexel.x * m, 0.0)).r - h) * uAOI.x, 0.0, 1.0);
    occ += clamp((texture(uHeight, vGrid + vec2(-uTexel.x * m, 0.0)).r - h) * uAOI.x, 0.0, 1.0);
    occ += clamp((texture(uHeight, vGrid + vec2(0.0,  uTexel.y * m)).r - h) * uAOI.x, 0.0, 1.0);
    occ += clamp((texture(uHeight, vGrid + vec2(0.0, -uTexel.y * m)).r - h) * uAOI.x, 0.0, 1.0);
    occ *= 0.25;
    // Weight by facing-up-ness: a vertical wall is not sheltered from the sky above.
    ao = mix(1.0, uAOI.z, occ * clamp(n.y, 0.0, 1.0));
  } else {
    n = normalize(vNormal);
  }

  // The ramp is driven by the interpolated height only, so a colour always means the
  // same elevation. Occlusion is kept out of it and applied to the lighting instead.
  float t = clamp(vHeight, 0.0, 1.0);
  vec3 base;
  if (uRamp == 1) base = vec3(t);
  else if (uRamp == 2) base = rampFlow(t);
  else if (uRamp == 3) base = rampHeat(t);
  else base = rampTerrain(t);

  vec3 l = normalize(uLightDir);
  float diff = max(dot(n, l), 0.0);
  // Sky/ground hemisphere ambient: upward faces catch sky, downward faces go dark.
  float hemi = mix(uAmbient * 0.35, uAmbient * 1.15, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  float fill = max(dot(n, normalize(vec3(-0.55, 0.5, 0.35))), 0.0) * 0.18;
  vec3 lit = base * (diff * 1.02 + hemi + fill) * ao;
  lit += uSky * diff * 0.10 * ao;

  // Blinn-Phong highlight, which is what makes ridge crests read as rock rather than
  // as flat paint. vWorld is the interpolated vertex position; GLSL ES 3.0 has no
  // built-in cameraPosition in the fragment stage.
  vec3 v = normalize(uEye - vWorld);
  float spec = pow(max(dot(n, normalize(l + v)), 0.0), uSpec.y) * uSpec.x;
  lit += vec3(spec) * ao;

  outColor = vec4(toSrgb(lit * uExposure), 1.0);
}`;

/* ------------------------------------------------------------------ matrices */

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
  return out;
}

function lookAt(out, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
  return out;
}

/* ------------------------------------------------------------------ viewport */

/**
 * Shader sources, exported so the static GLSL checks in tests/shader-src-test.mjs can
 * inspect them. A browser is the only real compiler, but most mistakes that make a
 * shader fail to compile are structural and catchable without one.
 */
export const SHADER_VERT = VERT;
export const SHADER_FRAG = FRAG;

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
    this.gl = null;
    this.glInfo = 'not initialised';
    this.error = null;
    this.onStatus = opts.onStatus || (() => {});
    this.camera = { yaw: 0.62, pitch: 0.72, dist: 2.45, target: [0, 0.18, 0] };
    this._schedule = rafThrottle(() => this.draw());

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
    if (typeof WebGL2RenderingContext === 'undefined') {
      this.glInfo = 'WebGL2 is not exposed by this browser';
      return;
    }
    const gl = this.c3d.getContext('webgl2', {
      alpha: false, antialias: true, depth: true, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) { this.glInfo = 'WebGL2 context creation returned null'; return; }
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link failed');
      gl.deleteShader(vs); gl.deleteShader(fs);
      this.prog = prog;
      this.loc = {
        proj: gl.getUniformLocation(prog, 'uProj'),
        view: gl.getUniformLocation(prog, 'uView'),
        ramp: gl.getUniformLocation(prog, 'uRamp'),
        light: gl.getUniformLocation(prog, 'uLightDir'),
        ambient: gl.getUniformLocation(prog, 'uAmbient'),
        exposure: gl.getUniformLocation(prog, 'uExposure'),
        // Per-pixel shading state. `height` may stay -1 when the texture cannot be
        // created, in which case `normalRes` is 0 and the fragment shader falls back
        // to the interpolated vertex normal.
        height: gl.getUniformLocation(prog, 'uHeight'),
        normalRes: gl.getUniformLocation(prog, 'uNormalRes'),
        normalScale: gl.getUniformLocation(prog, 'uNormalScale'),
        texel: gl.getUniformLocation(prog, 'uTexel'),
        detail: gl.getUniformLocation(prog, 'uDetail'),
        sky: gl.getUniformLocation(prog, 'uSky'),
        aoi: gl.getUniformLocation(prog, 'uAOI'),
        spec: gl.getUniformLocation(prog, 'uSpec'),
        eye: gl.getUniformLocation(prog, 'uEye'),
      };
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.ibo = gl.createBuffer();

      // Height texture: the full field goes in as normalized single-channel float, so
      // normals are derived per pixel at field resolution instead of being
      // interpolated between mesh vertices.
      this.heightTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // 1x1 transparent placeholder keeps the sampler complete before the first field.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      // 7 floats per vertex: px py pz nx ny nz height
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      this.proj = new Float32Array(16);
      this.view = new Float32Array(16);
      this.gl = gl;
      this.glInfo = 'WebGL2 ready';
    } catch (err) {
      this.glInfo = `shader failure: ${err.message}`;
      this.gl = null;
    }
  }

  get available3D() { return !!this.gl; }
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
    if (mode === '3d' && !this.gl) {
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
  }

  draw() {
    if (!this.field) return;
    this.resize();
    if (this.mode === '3d' && this.gl) this._draw3D();
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
    const gl = this.gl;
    const s = this.field;
    if (this._meshStale(s)) this._requestMesh(s);

    gl.viewport(0, 0, this.c3d.width, this.c3d.height);
    gl.clearColor(0.043, 0.058, 0.078, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);

    const aspect = this.c3d.width / Math.max(1, this.c3d.height);
    perspective(this.proj, (48 * Math.PI) / 180, aspect, 0.05, 40);
    const { yaw, pitch, dist, target } = this.camera;
    const ex = target[0] + dist * Math.cos(pitch) * Math.sin(yaw);
    const ey = target[1] + dist * Math.sin(pitch);
    const ez = target[2] + dist * Math.cos(pitch) * Math.cos(yaw);
    lookAt(this.view, ex, ey, ez, target[0], target[1], target[2], 0, 1, 0);

    gl.uniformMatrix4fv(this.loc.proj, false, this.proj);
    gl.uniformMatrix4fv(this.loc.view, false, this.view);
    gl.uniform1i(this.loc.ramp, ({ terrain: 0, gray: 1, flow: 2, heat: 3 })[this.ramp] ?? 0);
    gl.uniform3f(this.loc.light, 0.45, 0.82, 0.34);
    gl.uniform1f(this.loc.ambient, 0.155);
    gl.uniform1f(this.loc.exposure, 1.03);
    gl.uniform3f(this.loc.eye, ex, ey, ez);
    gl.uniform3f(this.loc.sky, 0.36, 0.52, 0.78);
    gl.uniform3f(this.loc.spec, 0.055, 42.0, 0.0);
    // AOI: strength, reach in texels, floor. Calibrated so a 9-texel drop of 0.05
    // normalized height occludes about 20%, which darkens ravines without greying
    // gentle slopes.
    gl.uniform3f(this.loc.aoi, 4.0, 9.0, 0.42);

    // Per-pixel shading needs the field as a texture. `_heightTexSize` is only set
    // once a field has been uploaded, so before that the shader falls back to the
    // interpolated vertex normal rather than sampling a placeholder.
    const field = this.field;
    const haveTex = !!(field && field.data && this._heightTexSize);
    if (haveTex) {
      const size = field.size;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
      gl.uniform1i(this.loc.height, 0);
      gl.uniform2f(this.loc.texel, 1 / size, 1 / size);
      // Slope sensitivity, calibrated against the geometry rather than guessed. The
      // value k maps a normalized height difference between neighbouring texels to a
      // surface angle of atan(k * dh / 2). At k = 4.5 a typical 0.10 step read as 13
      // degrees, which visibly flattened the relief; k = 11 puts it near 29 degrees,
      // in the range real terrain uses. The wider taps use a larger k because a
      // 2-texel and 4-texel difference is proportionally smaller.
      gl.uniform2f(this.loc.normalScale, this._meshWidth * 11.0, this._meshWidth * 11.0);
      gl.uniform2f(this.loc.detail, this._meshWidth * 20.0, this._meshWidth * 20.0);
      gl.uniform1f(this.loc.normalRes, 1);
    } else {
      gl.uniform1f(this.loc.normalRes, 0);
    }

    // Nothing to draw until the first mesh arrives. The request is already in
    // flight, and the cleared frame is preferable to blocking the UI thread.
    if (!this.mesh) return;

    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.ibCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /* --------------------------------------------------- mesh cache + worker */

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
    const gl = this.gl;
    if (!gl) return;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, res.verts, gl.DYNAMIC_DRAW);
    if (this._iboN !== res.n) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, res.idx, gl.STATIC_DRAW);
      this._iboN = res.n;
    }
    gl.bindVertexArray(null);
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
   * Upload the height field as a single-channel float texture so the fragment shader
   * can derive normals, ambient occlusion and specular per pixel.
   *
   * The field is normalized to 0..1 (and widened if it is flat) to avoid relying on
   * `texture()` being able to return negative values. `this._heightScale` maps that
   * back to the band the geometry uses.
   */
  _uploadHeightTexture(n, stride) {
    const gl = this.gl;
    const s = this.field;
    if (!gl || !this.heightTex || !s || !s.data) return;

    const size = s.size;
    const channels = s.channels || 1;
    const gridStep = n > 1 ? 1 / (n - 1) : 1;
    const width = (n - 1) * (stride * gridStep);
    const exag = Math.max(0.02, Math.min(0.55, 0.34 * this.exaggeration));
    // Geometry: y = (t - 0.5) * exag, with t the normalized height.
    this._heightScale = exag;
    this._heightBias = -0.5 * exag;
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

    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, size, size, 0, gl.RED, gl.FLOAT, tex);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this._heightTexSize = size;
    this._heightTexRange = wide ? range : 1;
  }

  /**
   * Build the height mesh on the calling thread.
   *
   * Retained for the inline path and for tests. The shared implementation lives in
   * mesh-build.js so the worker copy and this one can be compared directly; see
   * web/tests/mesh-worker-parity-test.mjs.
   */
  _buildMesh(s, token) {
    const res = buildMesh({
      data: s.data,
      size: s.size,
      channels: s.channels || 1,
      min: s.min,
      max: s.max,
      exaggeration: this.exaggeration,
      token,
    });
    this._uploadMesh(res);
    return this.mesh;
  }

  get meshInfo() { return this.mesh; }
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(log || 'shader compile failed');
  }
  return sh;
}
