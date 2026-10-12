/**
 * features.js — terrain-feature kernels that are still being reconstructed.
 *
 * These fill in nodes beyond the "must have" list, using published/standard techniques.
 * Each one is explicitly marked in IMPLEMENTATION-NOTES.md as a REASONABLE APPROXIMATION
 * because Gaea's own parameter semantics for these nodes are not documented in the shipped
 * node dump beyond names and enum option lists.
 */

import {
  createField, cloneField, toScalar, stats, clamp01, clamp, lerp, smoothstep, safeDiv,
  gaussianBlur, slopeMagnitude, radialFalloffMask,
} from '../kernel/field.js';
import { perlin2, value2, worley2, fractalSum } from '../kernel/noise.js';

function P(params, name, dflt) {
  const v = params ? params[name] : undefined;
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
  return v;
}
function inOr(ctx, i, dflt = 0.5) {
  const f = ctx.input(i);
  return f || createField(ctx.size, 'height', dflt);
}
function invLerp(a, b, x) { return safeDiv(x - a, b - a, 0); }

/* ------------------------------------------------------------------ Levels / BCS */

/**
 * "Levels" semantics (used here for any node exposing Mid/Gamma style controls).
 * Gaea's Adjust node exposes no explicit Levels trio, but several Fx nodes do.
 */
export function levelsRange(ctx) {
  const { size, params } = ctx;
  const f = cloneField(inOr(ctx, 0));
  const mid = clamp(P(params, 'Mid', 0.5), 0.001, 0.999);
  const gamma = Math.max(0.01, P(params, 'Gamma', 1));
  const gain = P(params, 'Gain', 1);
  const d = f.data;
  const g = (Math.log(mid) / Math.log(0.5)) / gamma;
  for (let i = 0; i < d.length; i++) {
    let t = clamp01(d[i]);
    if (g !== 1) t = Math.pow(t, g);
    d[i] = clamp01(t * gain);
  }
  return f;
}

/* ------------------------------------------------------------------ Slope / AO */

/** Slope — gradient magnitude as a 0..1 mask, with height weighting. */
export function slope(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const strength = Math.max(0.01, P(params, 'Strength', 1));
  const scaleD = P(params, 'Scale', 1);
  const s = slopeMagnitude(src, Math.max(1e-4, 1 / Math.max(0.01, scaleD)));
  const d = s.data;
  for (let i = 0; i < d.length; i++) d[i] = clamp01(Math.pow(d[i] * strength, 0.75));
  s.channel = 'mask';
  return s;
}

/** Height — luminance/height key mask; remaps the input through a threshold pair. */
export function heightKey(ctx) {
  const f = cloneField(inOr(ctx, 0, 0.5));
  const low = P(ctx.params, 'Low', 0.35);
  const high = P(ctx.params, 'High', 0.65);
  const soft = clamp01(P(ctx.params, 'Falloff', 0.15));
  const d = f.data;
  const e0 = Math.min(low, high), e1 = Math.max(low, high);
  for (let i = 0; i < d.length; i++) {
    const t = smoothstep(e0 - soft, e0, d[i]) * (1 - smoothstep(e1, e1 + soft, d[i]));
    d[i] = clamp01(t);
  }
  f.channel = 'mask';
  return f;
}

/** Occlusion / AO — cheap ambient occlusion from local height minus a blurred neighbourhood. */
export function occlusion(ctx) {
  const { size, params } = ctx;
  const src = toScalar(inOr(ctx, 0, 0.5));
  const radius = Math.max(1, P(params, 'Radius', 16));
  const strength = Math.max(0.01, P(params, 'Strength', 1));
  const blurF = gaussianBlur(src, radius);
  const out = createField(size, 'mask');
  const d = out.data, a = src.data, b = blurF.data;
  let maxV = 1e-6;
  for (let i = 0; i < d.length; i++) { d[i] = b[i] - a[i]; if (d[i] > maxV) maxV = d[i]; }
  for (let i = 0; i < d.length; i++) d[i] = clamp01(d[i] / maxV * strength);
  return out;
}

/* ------------------------------------------------------------------ Distance */

/**
 * Distance — distance from the "solid" region (input value >= threshold).
 * Uses an exact two-pass chamfer (8-neighbour) distance transform.
 */
export function distanceTransform(ctx) {
  const { size, params } = ctx;
  const src = toScalar(inOr(ctx, 0, 0));
  const threshold = P(params, 'Threshold', 0.5);
  const invert = P(params, 'Invert', false);
  const useGradient = P(params, 'Use Gradient', false);
  const out = createField(size, 'mask');
  const d = out.data;
  const INF = 1e12;
  for (let i = 0; i < size * size; i++) {
    const v = src.data[i];
    const solid = invert ? v < threshold : v >= threshold;
    d[i] = solid ? 0 : INF;
  }
  const D1 = 0.95509, D2 = 1.36930; // 8-neighbour chamfer weights
  // forward pass
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + D1);
      if (y > 0) v = Math.min(v, d[i - size] + D1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - size - 1] + D2);
      if (x < size - 1 && y > 0) v = Math.min(v, d[i - size + 1] + D2);
      d[i] = v;
    }
  }
  // backward pass
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      let v = d[i];
      if (x < size - 1) v = Math.min(v, d[i + 1] + D1);
      if (y < size - 1) v = Math.min(v, d[i + size] + D1);
      if (x < size - 1 && y < size - 1) v = Math.min(v, d[i + size + 1] + D2);
      if (x > 0 && y < size - 1) v = Math.min(v, d[i + size - 1] + D2);
      d[i] = v;
    }
  }
  let maxD = 1e-6;
  for (let i = 0; i < d.length; i++) if (d[i] < INF && d[i] > maxD) maxD = d[i];
  for (let i = 0; i < d.length; i++) {
    const t = d[i] >= INF ? 1 : d[i] / maxD;
    d[i] = clamp01(useGradient ? t : 1 - t);
  }
  return out;
}

/* ------------------------------------------------------------------ FractalTerraces */

/**
 * FractalTerraces — stepped/terraced height with optional fractal edge noise and tilt.
 * The "Fractal" character comes from perturbing the step boundary with a self-similar
 * noise field, which is the standard way to make terraces look geological.
 */
export function fractalTerraces(ctx) {
  const { size, params, seed } = ctx;
  const f = cloneField(inOr(ctx, 0, 0.5));
  const steps = clamp(P(params, 'Steps', 8), 1, 512);
  const sharpness = clamp(P(params, 'Sharpness', 0.5), 0, 1);
  const seedAmt = clamp01(P(params, 'Seed', 0));
  const tilt = P(params, 'Tilt', 0);
  const tiltAngle = P(params, 'Tilt Angle', 0);
  const fractal = clamp01(P(params, 'Fractal', 0.35));
  const d = f.data;
  const inv = 1 / size;
  const ang = (tiltAngle / 360) * Math.PI * 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv - 0.5;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv - 0.5;
      const i = y * size + x;
      let h = d[i];
      if (tilt !== 0) h += (u * ca + v * sa) * tilt * 0.25;
      // fractal perturbation of the terrace coordinate
      if (fractal > 0) {
        const n = fractalSum(perlin2, u * 8, v * 8, seed, 4, 2, 0.5, 'Standard', 8);
        h += n * fractal * 0.08;
      }
      const t = h * steps;
      const k = Math.floor(t);
      let frac = t - k;
      // sharpness 0 -> smooth ramp (no terrace), 1 -> hard step
      const w = Math.pow(clamp01(frac), lerp(3, 0.35, sharpness));
      const shaped = k + w;
      d[i] = clamp01(lerp(h * steps, shaped, 0.25 + sharpness * 0.7) / steps);
    }
  }
  return f;
}

/** Steps — hard quantisation into N discrete height bands. */
export function stepsNode(ctx) {
  const { size, params } = ctx;
  const f = cloneField(inOr(ctx, 0, 0.5));
  const steps = clamp(P(params, 'Steps', 8), 1, 1024);
  const smoothness = clamp01(P(params, 'Smoothness', 0));
  const d = f.data;
  for (let i = 0; i < d.length; i++) {
    const t = d[i] * steps;
    const k = Math.floor(t);
    const frac = t - k;
    const w = smoothness > 0 ? smoothstep(0.5 - smoothness * 0.5, 0.5 + smoothness * 0.5, frac) : (frac >= 0.5 ? 1 : 0);
    d[i] = clamp01((k + w) / steps);
  }
  return f;
}

/* ------------------------------------------------------------------ Select families */

/** HeightSelect — route between two inputs by a height band (Select family). */
export function heightSelect(ctx) {
  const { size, params } = ctx;
  const a = inOr(ctx, 0, 0.5);
  const b = inOr(ctx, 1, 0.0);
  const ctrl = ctx.input(2);
  const low = P(params, 'Low', 0.4);
  const high = P(params, 'High', 1);
  const falloff = Math.max(1e-4, P(params, 'Falloff', 0.1));
  const invert = P(params, 'Invert', false);
  const driver = ctrl ? toScalar(ctrl).data : toScalar(a).data;
  const stride = a.channels;
  const out = createField(size, a.channel);
  const o = out.data, da = a.data, db = b.data;
  for (let i = 0; i < size * size; i++) {
    let w = smoothstep(low - falloff, low, driver[i]) * (1 - smoothstep(high, high + falloff, driver[i]));
    if (invert) w = 1 - w;
    for (let c = 0; c < stride; c++) o[i * stride + c] = lerp(db[i * stride + c], da[i * stride + c], w);
  }
  return out;
}

/** SlopeSelect — route between two inputs by slope. */
export function slopeSelect(ctx) {
  const { size, params } = ctx;
  const a = inOr(ctx, 0, 0.5);
  const b = inOr(ctx, 1, 0.0);
  const ctrl = ctx.input(2) || a;
  const minS = P(params, 'Min', 0.1);
  const maxS = P(params, 'Max', 1);
  const falloff = Math.max(1e-4, P(params, 'Falloff', 0.1));
  const invert = P(params, 'Invert', false);
  const sl = slopeMagnitude(ctrl).data;
  const stride = a.channels;
  const out = createField(size, a.channel);
  const o = out.data, da = a.data, db = b.data;
  for (let i = 0; i < size * size; i++) {
    let w = smoothstep(minS - falloff, minS, sl[i]) * (1 - smoothstep(maxS, maxS + falloff, sl[i]));
    if (invert) w = 1 - w;
    for (let c = 0; c < stride; c++) o[i * stride + c] = lerp(db[i * stride + c], da[i * stride + c], w);
  }
  return out;
}

/** MaskSelect — route between two inputs by a mask on port 2. */
export function maskSelect(ctx) {
  const { size, params } = ctx;
  const a = inOr(ctx, 0, 0.5);
  const b = inOr(ctx, 1, 0.0);
  const mF = ctx.input(2);
  const threshold = P(params, 'Threshold', 0.5);
  const falloff = Math.max(1e-4, P(params, 'Falloff', 0.1));
  const invert = P(params, 'Invert', false);
  const m = mF ? toScalar(mF).data : null;
  const stride = a.channels;
  const out = createField(size, a.channel);
  const o = out.data, da = a.data, db = b.data;
  for (let i = 0; i < size * size; i++) {
    let w = m ? smoothstep(threshold - falloff, threshold + falloff, m[i]) : 1;
    if (invert) w = 1 - w;
    for (let c = 0; c < stride; c++) o[i * stride + c] = lerp(db[i * stride + c], da[i * stride + c], w);
  }
  return out;
}

/** AngleSelect — route by directional/faceted slope alignment. */
export function angleSelect(ctx) {
  const { size, params } = ctx;
  const a = inOr(ctx, 0, 0.5);
  const b = inOr(ctx, 1, 0.0);
  const ctrl = ctx.input(2) || a;
  const dir = P(params, 'Direction', 0);
  const falloff = Math.max(1e-3, P(params, 'Falloff', 0.2));
  const invert = P(params, 'Invert', false);
  const src = toScalar(ctrl).data;
  const stride = a.channels;
  const out = createField(size, a.channel);
  const o = out.data, da = a.data, db = b.data;
  const ang = (dir / 360) * Math.PI * 2;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  for (let y = 0; y < size; y++) {
    const ym = y < 1 ? 0 : y - 1, yp = y > size - 2 ? size - 1 : y + 1;
    for (let x = 0; x < size; x++) {
      const xm = x < 1 ? 0 : x - 1, xp = x > size - 2 ? size - 1 : x + 1;
      const gx = src[y * size + xp] - src[y * size + xm];
      const gy = src[yp * size + x] - src[ym * size + x];
      // alignment of the downhill direction with the requested direction, 0..1
      const len = Math.sqrt(gx * gx + gy * gy) || 1;
      const align = clamp01((-(gx / len) * dx - (gy / len) * dy) * 0.5 + 0.5);
      let w = smoothstep(0.5 - falloff, 0.5 + falloff, align) * clamp01(len * size * 0.5);
      if (invert) w = 1 - w;
      const i = y * size + x;
      for (let c = 0; c < stride; c++) o[i * stride + c] = lerp(db[i * stride + c], da[i * stride + c], w);
    }
  }
  return out;
}

/** DataSelect — route by a scalar parameter (a simple, predictable selector). */
export function dataSelect(ctx) {
  const { size, params } = ctx;
  const a = inOr(ctx, 0, 0.5);
  const b = inOr(ctx, 1, 0.0);
  const idx = P(params, 'Index', 0);
  const stride = a.channels;
  const out = createField(size, a.channel);
  const o = out.data, da = a.data, db = b.data;
  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < stride; c++) o[i * stride + c] = lerp(db[i * stride + c], da[i * stride + c], clamp01(idx));
  }
  return out;
}

/* ------------------------------------------------------------------ Sea level */

/**
 * Sea — flood everything below a level, producing a flat water surface plus a shore mask.
 * Gaea's Sea node has an extensive panel; this implements the physically meaningful core
 * (level, depth, shore falloff) and ignores the rendering-only controls.
 */
export function seaLevel(ctx) {
  const { size, params } = ctx;
  const f = cloneField(inOr(ctx, 0, 0.5));
  const level = P(params, 'Level', 0.4);
  const depth = P(params, 'Depth', 0.5);
  const shore = Math.max(1e-4, P(params, 'Shore', 0.05));
  const d = f.data;
  for (let i = 0; i < d.length; i++) {
    const h = d[i];
    if (h < level) {
      // flatten water and apply a small depth gradient near the shore
      const t = clamp01((level - h) / shore);
      d[i] = lerp(h, level - depth * 0.05 * (1 - t), t);
    }
  }
  return f;
}

/* ------------------------------------------------------------------ Snow */

/**
 * Snow — accumulate snow by altitude and slope, with a melt control.
 * Physical model: snow accumulates above a snowline and on shallow slopes, melted back by
 * altitude-dependent melt. Gaea's Snow node is artwork-driven; this is a physics approximation.
 */
export function snow(ctx) {
  const { size, params } = ctx;
  const src = toScalar(inOr(ctx, 0, 0.5));
  const snowline = P(params, 'Snowline', 0.6);
  const transition = Math.max(1e-4, P(params, 'Transition', 0.15));
  const slopeLimit = P(params, 'Slope Limit', 0.5);
  const slopeFalloff = Math.max(1e-4, P(params, 'Slope Falloff', 0.25));
  const melt = clamp01(P(params, 'Melt', 0));
  const meltAngle = P(params, 'Melt Angle', 0);

  const sl = slopeMagnitude(src).data;
  const out = createField(size, 'mask');
  const d = out.data;
  const ang = (meltAngle / 360) * Math.PI * 2;
  for (let i = 0; i < d.length; i++) {
    const alt = smoothstep(snowline - transition, snowline + transition, src.data[i]);
    const flt = 1 - smoothstep(slopeLimit - slopeFalloff, slopeLimit + slopeFalloff, sl[i] * size * 0.25);
    let v = alt * flt;
    if (melt > 0) {
      // melt is stronger at lower altitude, modulated by the melt direction
      const m = melt * (1 - alt) * (0.5 + 0.5 * Math.sin(ang));
      v = clamp01(v * (1 - m));
    }
    d[i] = clamp01(v);
  }
  return out;
}

/* ------------------------------------------------------------------ Cracks */

/**
 * Cracks — Voronoi-edge fracture mask, optionally warped.
 * Gaea's Cracks advanced settings control stratification and joint sets; here we build the
 * canonical fractured-rock mask: distance-to-cell-edge thresholded into thin lines.
 */
export function cracks(ctx) {
  const { size, params, seed } = ctx;
  const scale = Math.max(0.5, P(params, 'Scale', 50));
  const width = Math.max(1e-4, P(params, 'Width', 0.06));
  const depth = clamp01(P(params, 'Depth', 0.5));
  const warpAmt = clamp01(P(params, 'Warp', 0));
  const freq = Math.max(0.5, (scale / 100) * 5);
  const period = Math.max(1, Math.round(freq));
  const out = createField(size, 'mask');
  const d = out.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v0 = (y + 0.5) * inv - 0.5;
    for (let x = 0; x < size; x++) {
      const u0 = (x + 0.5) * inv - 0.5;
      let u = u0, v = v0;
      if (warpAmt > 0) {
        u += fractalSum(perlin2, u0 * freq * 0.5, v0 * freq * 0.5, seed ^ 0x11, 4, 2, 0.5, 'Standard', period) * warpAmt * 0.08;
        v += fractalSum(perlin2, u0 * freq * 0.5 + 11.3, v0 * freq * 0.5 - 7.9, seed ^ 0x22, 4, 2, 0.5, 'Standard', period) * warpAmt * 0.08;
      }
      const w = worley2(u * freq, v * freq, seed, { jitter: 0.9, metric: 'euclid', morph: 0 });
      const edge = (w.f2 - w.f1) * 1.3;
      d[y * size + x] = clamp01(1 - smoothstep(0, width, edge)) * depth;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Shear / Shift / Transform */

/** Shift — translate the field with wrap or clamp. */
export function shift(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const dx = P(params, 'X', 0.1);
  const dy = P(params, 'Y', 0.1);
  const scale = P(params, 'Scale', 1);
  const stride = src.channels;
  const out = createField(size, src.channel);
  const o = out.data, s = src.data;
  const ox = Math.round(dx * (scale - 1) * size * 0.5 + dx * size);
  const oy = Math.round(dy * (scale - 1) * size * 0.5 + dy * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sx = x - ox, sy = y - oy;
      sx = ((sx % size) + size) % size;
      sy = ((sy % size) + size) % size;
      for (let c = 0; c < stride; c++) o[(y * size + x) * stride + c] = s[(sy * size + sx) * stride + c];
    }
  }
  return out;
}

/** Shear — horizontal offset proportional to Y (or vertical proportional to X). */
export function shear(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const amount = P(params, 'Amount', 0.2);
  const vertical = P(params, 'Vertical', false);
  const stride = src.channels;
  const out = createField(size, src.channel);
  const o = out.data, s = src.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = vertical ? x / size : y / size;
      const shiftBy = Math.round((t - 0.5) * amount * size);
      let sx = vertical ? x : x + shiftBy;
      let sy = vertical ? y + shiftBy : y;
      sx = ((sx % size) + size) % size;
      sy = ((sy % size) + size) % size;
      for (let c = 0; c < stride; c++) o[(y * size + x) * stride + c] = s[(sy * size + sx) * stride + c];
    }
  }
  return out;
}

/** Transform — scale/rotate/translate resample of the whole field. */
export function transformField(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const sx = P(params, 'Scale X', P(params, 'Scale', 1));
  const sy = P(params, 'Scale Y', P(params, 'Scale', 1));
  const rot = P(params, 'Rotation', 0);
  const ox = P(params, 'X', 0);
  const oy = P(params, 'Y', 0);
  const stride = src.channels;
  const out = createField(size, src.channel);
  const o = out.data, s = src.data;
  const ang = (rot / 360) * Math.PI * 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const invSx = 1 / (Math.abs(sx) < 1e-4 ? 1e-4 : sx);
  const invSy = 1 / (Math.abs(sy) < 1e-4 ? 1e-4 : sy);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size - 0.5 - oy * 0.01;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5 - ox * 0.01;
      const ru = (u * ca + v * sa) * invSx;
      const rv = (-u * sa + v * ca) * invSy;
      const fx = (ru + 0.5) * size - 0.5;
      const fy = (rv + 0.5) * size - 0.5;
      let x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      let x1 = x0 + 1, y1 = y0 + 1;
      const cl = (v2) => v2 < 0 ? 0 : v2 > size - 1 ? size - 1 : v2;
      x0 = cl(x0); x1 = cl(x1); y0 = cl(y0); y1 = cl(y1);
      for (let c = 0; c < stride; c++) {
        const a = s[(y0 * size + x0) * stride + c], b = s[(y0 * size + x1) * stride + c];
        const cc = s[(y1 * size + x0) * stride + c], dd = s[(y1 * size + x1) * stride + c];
        const top = a + (b - a) * tx, bot = cc + (dd - cc) * tx;
        o[(y * size + x) * stride + c] = top + (bot - top) * ty;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Recurve / Postprocess */

/** Recurve — remap through a user curve supplied as control points (same math as Curve). */
export function recurve(ctx) {
  const { params } = ctx;
  const f = cloneField(inOr(ctx, 0, 0.5));
  const pts = P(params, 'Curve', null);
  const d = f.data;
  // lazily reuse the PCHIP evaluator from filters.js through a local implementation
  const lut = buildLut(pts);
  for (let i = 0; i < d.length; i++) d[i] = lut[clamp01(d[i])];
  return f;
}

function buildLut(points) {
  const pts = (points && points.length >= 2 ? points : [[0, 0], [1, 1]]).slice().sort((a, b) => a[0] - b[0]);
  const bins = 1024;
  const lut = new Float32Array(bins + 1);
  const xs = pts.map((p) => clamp01(p[0])), ys = pts.map((p) => p[1]);
  for (let i = 0; i <= bins; i++) {
    const x = i / bins;
    // piecewise-monotone cubic, kept local to avoid a circular import
    let k = 0;
    while (k < xs.length - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k] || 1e-9;
    const t = clamp01((x - xs[k]) / h);
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const m0 = k === 0 ? 0 : (ys[k + 1] - ys[k - 1]) / (xs[k + 1] - xs[k - 1] || 1e-9) * h;
    const m1 = k + 2 >= xs.length ? 0 : (ys[k + 2] - ys[k]) / (xs[k + 2] - xs[k] || 1e-9) * h;
    lut[i] = h00 * ys[k] + h10 * m0 + h01 * ys[k + 1] + h11 * m1;
  }
  return lut;
}
