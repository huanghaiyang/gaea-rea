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
void main() {
  vNormal = aNormal;
  vHeight = aHeight;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vHeight;
out vec4 outColor;
uniform int uRamp;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uExposure;

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
  float t = clamp(vHeight, 0.0, 1.0);
  vec3 base;
  if (uRamp == 1) base = vec3(t);
  else if (uRamp == 2) base = rampFlow(t);
  else if (uRamp == 3) base = rampHeat(t);
  else base = rampTerrain(t);

  vec3 n = normalize(vNormal);
  vec3 l = normalize(uLightDir);
  float diff = max(dot(n, l), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.55, 0.5, 0.35))), 0.0) * 0.20;
  float rim = pow(1.0 - max(n.z, 0.0), 2.0) * 0.05;
  vec3 lit = base * (diff * 0.98 + fill + rim + uAmbient);
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
      };
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.ibo = gl.createBuffer();
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
   * Pan the camera target from a pointer delta.
   *
   * Convention: the terrain moves OPPOSITE to the cursor, as in map navigation —
   * dragging up (dy < 0) walks the view north across the terrain, so the terrain
   * appears to slide DOWN the screen. This is the inverse-drag convention, not
   * direct manipulation; it is deliberate and was confirmed by the user.
   *
   * Sign derivation — numerically projected, not reasoned by hand, because the
   * sign here is easy to get backwards. The camera sits above the target and looks
   * down:
   *   ey = target[1] + dist * sin(pitch)
   * Projecting a fixed terrain point with the real look-at matrix shows that
   * RAISING target[1] moves the terrain DOWN the screen (ndc_y goes from -0.127 to
   * -0.193 for target[1] += 0.10):
   *
   *   operator            drag up (dy<0)      drag down (dy>0)
   *   target[1] += dy*s   terrain up          terrain down     <- follows cursor
   *   target[1] -= dy*s   terrain down        terrain up       <- inverse (wanted)
   *
   * The required behaviour is the inverse of the cursor, so `-= dy`. Reproduce with
   * `python tools/derive_pan_sign.py`.
   *
   * The horizontal axis already follows the same inverse convention and is
   * unchanged: dragging right (dx > 0) lowers target[0], moving the terrain left.
   * That axis maps to target[0], which is perpendicular to the view, so it needs no
   * other component.
   *
   * The depth axis (target[2]) is deliberately NOT touched by the vertical drag.
   * Coupling it to dy was tried and measured to inject sideways drift: projected at
   * yaw 0.62 a vertical drag moved the terrain 0.28x sideways, at yaw 1.20 0.60x,
   * and at yaw 2.40 2.09x — i.e. near-horizontal sliding instead of up/down. See
   * `python tools/derive_pan_screen_vector.py`.
   *
   * @param {{yaw:number,pitch:number,dist:number,target:number[]}} cam
   * @param {number} dx horizontal delta in CSS pixels
   * @param {number} dy vertical delta in CSS pixels
   * @returns {typeof cam} the same object, mutated
   */
  static pan(cam, dx, dy) {
    const s = cam.dist * 0.0022;
    cam.target[0] -= dx * s;
    cam.target[1] -= dy * s;
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

  setRamp(ramp) { this.ramp = ramp; this.pendingFull = null; this.mesh = null; this._schedule(); }
  setExaggeration(x) { this.exaggeration = x; this.mesh = null; this._schedule(); }

  setField(field) {
    this.field = field;
    this.pendingFull = null;
    this.mesh = null;
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
    if (!this.mesh || this.mesh.token !== s || this.mesh.exag !== this.exaggeration) {
      this._buildMesh(s, s);
    }
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
    gl.uniform3f(this.loc.light, 0.52, 0.80, 0.40);
    gl.uniform1f(this.loc.ambient, 0.15);
    gl.uniform1f(this.loc.exposure, 1.03);

    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.ibCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /**
   * Build the height mesh. Sampling is capped so even a 1024px field produces a bounded
   * triangle count; normals are central differences on the sample grid.
   */
  _buildMesh(s, token) {
    const gl = this.gl;
    const size = s.size;
    const stride = Math.max(1, Math.ceil(size / 384));
    const n = Math.floor((size - 1) / stride) + 1;
    const channels = s.channels || 1;
    const vrange = s.max - s.min > 1e-9 ? s.max - s.min : 1;
    const stretch = Math.max(0.02, Math.min(0.55, 0.34 * this.exaggeration));
    const get = (i, j) => {
      const xi = Math.min(size - 1, Math.max(0, i * stride));
      const yi = Math.min(size - 1, Math.max(0, j * stride));
      return s.data[(yi * size + xi) * channels];
    };

    const verts = new Float32Array(n * n * 7);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = get(i, j);
        const t = (h - s.min) / vrange;
        const hl = get(Math.max(0, i - 1), j);
        const hr = get(Math.min(n - 1, i + 1), j);
        const hd = get(i, Math.max(0, j - 1));
        const hu = get(i, Math.min(n - 1, j + 1));
        const dx = ((hr - hl) / vrange) * stretch * n * 0.5;
        const dz = ((hu - hd) / vrange) * stretch * n * 0.5;
        let nx = -dx, ny = 1, nz = -dz;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        const o = (j * n + i) * 7;
        verts[o] = i / (n - 1) - 0.5;
        verts[o + 1] = t * stretch - stretch * 0.5;
        verts[o + 2] = j / (n - 1) - 0.5;
        verts[o + 3] = nx; verts[o + 4] = ny; verts[o + 5] = nz;
        verts[o + 6] = t;
      }
    }

    const quads = (n - 1) * (n - 1);
    const idx = new Uint32Array(quads * 6);
    let k = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.ibCount = idx.length;
    this.mesh = { token, exag: this.exaggeration, vertices: n * n, triangles: quads * 2, stride };
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
