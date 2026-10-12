/**
 * render3d.js — the 3D preview, rendered with three.js.
 *
 * Scope: three.js owns the scene graph, the render target, the depth state and the
 * geometry buffers. The camera *math* stays in viewport.js (`Viewport.orbit/pan/zoom`)
 * because those sign conventions were derived from the projection, confirmed against
 * the running app by the user, and are pinned by tests/camera-controls-test.mjs.
 * Handing camera control to OrbitControls would silently change behaviour the user
 * already signed off on, so it is deliberately not done here.
 *
 * GLSL is written in the ES 1.00 style (`attribute`/`varying`/`gl_FragColor`) rather
 * than GLSL3. three.js prepends its own preamble and translates for WebGL2, and using
 * its expected dialect avoids fighting over `#version`, `precision` and the fragment
 * output name.
 *
 * Shading is per pixel from the height texture, not per vertex: see the note on
 * normal derivation in the fragment shader.
 */

/**
 * A RELATIVE path, not the bare `'three'` specifier: this module is imported by the
 * Node test suite as well as the browser, and Node has no import map. Vendored files
 * that insist on a bare specifier (OrbitControls) are resolved by the map in
 * index.html instead — see web/vendor/README.md.
 */
import * as THREE from '../vendor/three/three.module.js';

const VERT = `
attribute vec3 aNormal;
attribute float aHeight;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vGrid;
varying vec3 vWorld;

void main() {
  vNormal = aNormal;
  vHeight = aHeight;
  // The mesh spans exactly one texture width, so position.xz + 0.5 is the texture UV.
  vGrid = position.xz + 0.5;
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = `
uniform int uRamp;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uExposure;
uniform sampler2D uHeight;
uniform float uNormalRes;
uniform vec2 uNormalScale;
uniform vec2 uTexel;
uniform vec2 uDetail;
uniform vec3 uSky;
uniform vec3 uAOI;
uniform vec3 uSpec;
uniform vec3 uEye;

varying vec3 vNormal;
varying float vHeight;
varying vec2 vGrid;
varying vec3 vWorld;

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
  vec3 e = vec3(1.000, 1.000, 0.780);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.50) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.50) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}

vec3 rampHeat(float x) {
  float t = clamp(x, 0.0, 1.0);
  vec3 a = vec3(0.020, 0.008, 0.050);
  vec3 b = vec3(0.320, 0.030, 0.260);
  vec3 c = vec3(0.760, 0.130, 0.140);
  vec3 d = vec3(0.960, 0.560, 0.100);
  vec3 e = vec3(1.000, 0.960, 0.700);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.50) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.50) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}

void main() {
  vec3 n;
  float ao = 1.0;

  if (uNormalRes > 0.0) {
    // Per-pixel normal from the height texture. Deriving it per pixel rather than
    // interpolating vertex normals is what keeps ridges and gullies crisp: a vertex
    // normal is only correct AT the vertex, so everything finer than one triangle used
    // to dissolve into a smooth blob.
    float h = vHeight;
    float hl = texture2D(uHeight, vGrid - vec2(uTexel.x, 0.0)).r;
    float hr = texture2D(uHeight, vGrid + vec2(uTexel.x, 0.0)).r;
    float hd = texture2D(uHeight, vGrid - vec2(0.0, uTexel.y)).r;
    float hu = texture2D(uHeight, vGrid + vec2(0.0, uTexel.y)).r;
    n = normalize(vec3((hl - hr) * uNormalScale.x, 1.0, (hd - hu) * uNormalScale.y));

    // Two coarser slope octaves add the fine drainage texture a single-texel
    // difference cannot express.
    float h2l = texture2D(uHeight, vGrid - vec2(uTexel.x * 2.0, 0.0)).r;
    float h2r = texture2D(uHeight, vGrid + vec2(uTexel.x * 2.0, 0.0)).r;
    float h2d = texture2D(uHeight, vGrid - vec2(0.0, uTexel.y * 2.0)).r;
    float h2u = texture2D(uHeight, vGrid + vec2(0.0, uTexel.y * 2.0)).r;
    n = normalize(n + vec3((h2l - h2r) * uDetail.x, 0.0, (h2d - h2u) * uDetail.y));

    float h4l = texture2D(uHeight, vGrid - vec2(uTexel.x * 4.0, 0.0)).r;
    float h4r = texture2D(uHeight, vGrid + vec2(uTexel.x * 4.0, 0.0)).r;
    float h4d = texture2D(uHeight, vGrid - vec2(0.0, uTexel.y * 4.0)).r;
    float h4u = texture2D(uHeight, vGrid + vec2(0.0, uTexel.y * 4.0)).r;
    n = normalize(n + vec3((h4l - h4r) * uDetail.x * 0.5, 0.0, (h4d - h4u) * uDetail.y * 0.5));

    float m = uAOI.y;
    float occ = 0.0;
    occ += clamp((texture2D(uHeight, vGrid + vec2( uTexel.x * m, 0.0)).r - h) * uAOI.x, 0.0, 1.0);
    occ += clamp((texture2D(uHeight, vGrid + vec2(-uTexel.x * m, 0.0)).r - h) * uAOI.x, 0.0, 1.0);
    occ += clamp((texture2D(uHeight, vGrid + vec2(0.0,  uTexel.y * m)).r - h) * uAOI.x, 0.0, 1.0);
    occ += clamp((texture2D(uHeight, vGrid + vec2(0.0, -uTexel.y * m)).r - h) * uAOI.x, 0.0, 1.0);
    occ *= 0.25;
    ao = mix(1.0, uAOI.z, occ * clamp(n.y, 0.0, 1.0));
  } else {
    // No texture: fall back to the interpolated vertex normal so the view still draws.
    n = normalize(vNormal);
  }

  // The ramp reads the interpolated height only, so a colour always means the same
  // elevation; occlusion multiplies the lighting instead.
  float t = clamp(vHeight, 0.0, 1.0);
  vec3 base;
  if (uRamp == 1) base = vec3(t);
  else if (uRamp == 2) base = rampFlow(t);
  else if (uRamp == 3) base = rampHeat(t);
  else base = rampTerrain(t);

  vec3 l = normalize(uLightDir);
  float diff = max(dot(n, l), 0.0);
  float hemi = mix(uAmbient * 0.35, uAmbient * 1.15, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  float fill = max(dot(n, normalize(vec3(-0.55, 0.5, 0.35))), 0.0) * 0.18;
  vec3 lit = base * (diff * 1.02 + hemi + fill) * ao;
  lit += uSky * diff * 0.10 * ao;

  vec3 v = normalize(uEye - vWorld);
  float spec = pow(max(dot(n, normalize(l + v)), 0.0), uSpec.y) * uSpec.x;
  lit += vec3(spec) * ao;

  gl_FragColor = vec4(toSrgb(lit * uExposure), 1.0);
}`;

const RAMP_INDEX = { terrain: 0, gray: 1, flow: 2, heat: 3 };

export class Renderer3D {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.info = 'not initialised';
    this.meshVersion = 0;
    this._texSize = 0;
    this._meshWidth = 1;

    try {
      // Pre-flight the context before handing the canvas to three.js. WebGLRenderer
      // logs `console.error` itself when context creation fails, before it throws, so
      // catching its exception is not enough to keep the no-WebGL2 path quiet — and a
      // noisy console on a supported degradation is misleading. Creating the context
      // here and passing it in also guarantees three.js uses exactly this one.
      if (typeof WebGL2RenderingContext === 'undefined') {
        this.info = 'WebGL2 is not exposed by this browser';
        return;
      }
      const context = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        depth: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
      if (!context) {
        this.info = 'WebGL2 context creation returned null';
        return;
      }

      this.renderer = new THREE.WebGLRenderer({
        canvas,
        context,
        alpha: false,
        antialias: true,
      });
      // The canvas already has a device-pixel-sized backing store managed by
      // viewport.resize(); three.js must not resize it behind our back.
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0x0b0f14, 1);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(48, 1.6, 0.05, 40);

      this.uniforms = {
        uRamp: { value: 0 },
        uLightDir: { value: new THREE.Vector3(0.45, 0.82, 0.34) },
        uAmbient: { value: 0.155 },
        uExposure: { value: 1.03 },
        uHeight: { value: null },
        uNormalRes: { value: 0 },
        uNormalScale: { value: new THREE.Vector2(11, 11) },
        uTexel: { value: new THREE.Vector2(1 / 256, 1 / 256) },
        uDetail: { value: new THREE.Vector2(20, 20) },
        uSky: { value: new THREE.Vector3(0.36, 0.52, 0.78) },
        uAOI: { value: new THREE.Vector3(4.0, 9.0, 0.42) },
        uSpec: { value: new THREE.Vector3(0.055, 42.0, 0.0) },
        uEye: { value: new THREE.Vector3() },
      };

      this.material = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.FrontSide,
      });

      this.geometry = new THREE.BufferGeometry();
      this.mesh = new THREE.Mesh(this.geometry, this.material);
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);

      // A 1x1 placeholder keeps the sampler complete before the first field arrives.
      const placeholder = new THREE.DataTexture(
        new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType,
      );
      placeholder.needsUpdate = true;
      this.texture = placeholder;
      this.uniforms.uHeight.value = placeholder;

      this.ok = true;
      this.info = 'three.js ready';
    } catch (err) {
      this.info = `three.js failure: ${(err && err.message) || err}`;
      this.ok = false;
    }
  }

  get available() { return this.ok; }

  /**
   * Replace the mesh. The worker hands back an interleaved buffer
   * (px py pz nx ny nz height) and a Uint32 index buffer, which three.js can consume
   * without a copy via InterleavedBufferAttribute.
   *
   * @param {{verts: Float32Array, idx: Uint32Array, n: number}} res
   */
  setMesh(res) {
    if (!this.ok || !res) return;
    const ib = new THREE.InterleavedBuffer(res.verts, 7);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    geo.setAttribute('aNormal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    geo.setAttribute('aHeight', new THREE.InterleavedBufferAttribute(ib, 1, 6));
    geo.setIndex(new THREE.BufferAttribute(res.idx, 1));

    this.geometry.dispose();
    this.geometry = geo;
    this.mesh.geometry = geo;
    this.meshVersion++;
  }

  /**
   * Upload the height field so the fragment shader can derive normals per pixel.
   * Normalized to 0..1 by the caller, which avoids depending on negative float
   * texture reads.
   *
   * @param {Float32Array} tex normalized size*size
   * @param {number} size
   * @param {number} meshWidth world width the mesh spans
   */
  setHeightTexture(tex, size, meshWidth) {
    if (!this.ok) return;
    if (this._texSize !== size || !this.texture || this.texture.image.width !== size) {
      const t = new THREE.DataTexture(tex, size, size, THREE.RedFormat, THREE.FloatType);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      if (this.texture) this.texture.dispose();
      this.texture = t;
      this.uniforms.uHeight.value = t;
      this._texSize = size;
    } else {
      this.texture.image.data = tex;
      this.texture.needsUpdate = true;
    }
    this._meshWidth = meshWidth;
    this.uniforms.uTexel.value.set(1 / size, 1 / size);
    this.uniforms.uNormalScale.value.set(meshWidth * 11, meshWidth * 11);
    this.uniforms.uDetail.value.set(meshWidth * 20, meshWidth * 20);
    this.uniforms.uNormalRes.value = 1;
  }

  /** Place the camera from viewport.js's own camera state. */
  setCamera(cam) {
    if (!this.ok) return;
    const { yaw, pitch, dist, target } = cam;
    const ex = target[0] + dist * Math.cos(pitch) * Math.sin(yaw);
    const ey = target[1] + dist * Math.sin(pitch);
    const ez = target[2] + dist * Math.cos(pitch) * Math.cos(yaw);
    this.camera.position.set(ex, ey, ez);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target[0], target[1], target[2]);
    this.uniforms.uEye.value.set(ex, ey, ez);
  }

  setRamp(name) {
    if (this.ok) this.uniforms.uRamp.value = RAMP_INDEX[name] ?? 0;
  }

  resize(width, height) {
    if (!this.ok) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** @param {{r:number,g:number,b:number,a:number}} clear */
  render(clear) {
    if (!this.ok) return;
    if (clear) this.renderer.setClearColor(clear.r, clear.g, clear.b, clear.a ?? 1);
    this.renderer.render(this.scene, this.camera);
  }

  get drawCalls() {
    return this.ok && this.renderer.info ? this.renderer.info.render.calls : 0;
  }

  dispose() {
    if (!this.ok) return;
    try {
      this.geometry.dispose();
      this.material.dispose();
      if (this.texture) this.texture.dispose();
      this.renderer.dispose();
    } catch { /* ignore */ }
    this.ok = false;
  }
}

export const SHADER_VERT_3D = VERT;
export const SHADER_FRAG_3D = FRAG;
