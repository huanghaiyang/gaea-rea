/**
 * generators.js — kernels that CREATE a field from nothing (no input ports).
 *
 * Every kernel has the signature (ctx) => Field where ctx is
 *   { size, params, input(i), seed, worldSize, size2 }
 * and params is a plain object keyed by the *exact* Gaea parameter names found in
 * data/nodes.json, so the parameter panel and the algorithm always agree.
 */

import {
  perlin2, value2, perlin3, value3, worley2, worleySurface, fractalSum,
} from '../kernel/noise.js';
import { hash2f, mix32, makeRng } from '../kernel/hash.js';
import {
  fnPerlinGrid, fnVoronoiGrid, fnCellular3, fnFractalPerlin,
  FN_FRACTAL, FN_CELLULAR_RETURN, FN_CELLULAR_DISTANCE,
} from '../kernel/fastnoise.js';
import {
  createField, clamp, clamp01, lerp, smoothstep, stats, radialFalloffMask, linearGradientMask,
} from '../kernel/field.js';
import { linearGradient, radialGradient, EDGE_MIRROR } from '../kernel/gaea-fields.js';
import { mapDrop, mapInvert } from '../kernel/gaea-filter.js';
import { exponentialCurveInPlace } from '../kernel/gaea-exact.js';
import { profileTerrace } from '../kernel/gaea-terrace.js';
import { sampleBilinear } from '../kernel/coords.js';
import { hydraulicDropletMultiscale } from './erosion.js';

const TAU = Math.PI * 2;

/** Read a param with a fallback; never returns NaN. */
function P(params, name, dflt) {
  const v = params ? params[name] : undefined;
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
  if (Array.isArray(v)) return v;
  if (typeof v === 'boolean') return v;
  return v;
}

/* ------------------------------------------------------------------ Constant */

/**
 * Constant — flat height or flat colour.
 * Gaea params: Output (Height|Color), Height, Color.
 */
export function constant(ctx) {
  const { size, params } = ctx;
  if (P(params, 'Output', 'Height') === 'Color') {
    const c = P(params, 'Color', [0, 0, 0, 1]);
    const arr = Array.isArray(c) ? c : [0, 0, 0, 1];
    const f = createField(size, 'color');
    for (let i = 0; i < size * size; i++) {
      f.data[i * 4] = arr[0] ?? 0;
      f.data[i * 4 + 1] = arr[1] ?? 0;
      f.data[i * 4 + 2] = arr[2] ?? 0;
      f.data[i * 4 + 3] = arr[3] ?? 1;
    }
    return f;
  }
  const h = clamp01(P(params, 'Height', 0.5));
  return createField(size, 'height', h);
}

/* ------------------------------------------------------------------ File (placeholder) */

/**
 * File — NOT IMPLEMENTED as a real decoder in this build.
 * Rationale (see IMPLEMENTATION-NOTES.md): decoding Gaea .terrain / 16-bit RAW requires
 * formats we cannot verify offline. We emit a deterministic placeholder wedge so the graph
 * still evaluates and the missing capability is visible rather than silently wrong.
 */
export function fileStub(ctx) {
  const { size, params } = ctx;
  const f = createField(size, 'height');
  const name = String(P(params, 'File', '') || '');
  const h = 0.35;
  if (name) {
    // Deterministic, low-frequency placeholder keyed off the requested filename.
    let s = 0;
    for (let i = 0; i < name.length; i++) s = (Math.imul(s, 31) + name.charCodeAt(i)) | 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        f.data[y * size + x] = h * (0.5 + 0.5 * Math.sin((u * 6.283 + s * 0.01)) * Math.cos(v * 3.1415));
      }
    }
    return f;
  }
  return createField(size, 'height', h);
}

/* ------------------------------------------------------------------ MultiFractal */

/**
 * MultiFractal — the workhorse fBm primitive.
 *
 * Mapping of Gaea's controls to the underlying fractal sum (arbitrated, see notes):
 *   Noise Type  FBM|Billowy|Ridged -> base octave operator
 *   Octaves     octave count (Auto Octaves derives it from Scale)
 *   Scale       -> lattice frequency = Scale * 4 / 100 (Scale is expressed in % of terrain)
 *   Roughness   -> 1/gain; gain = 1 - Roughness*0.6 (so higher roughness = flatter spectrum)
 *   Contrast    -> post gamma about 0.5
 *   Variation/Smoothness/Perturb/Iterations -> domain perturbation for SecondaryFractal
 */
export function multiFractal(ctx) {
  const { size, params, seed } = ctx;
  const scale = Math.max(0.5, P(params, 'Scale', 100));
  const auto = P(params, 'Auto Octaves', true);
  const rel = clamp01(P(params, 'Relative Feature Scale', 1));
  const rough = clamp01(P(params, 'Roughness', 0.5));
  const contrast = P(params, 'Contrast', 1);
  const smoothness = clamp01(P(params, 'Smoothness', 0));
  const variation = P(params, 'Variation', 0);
  const damping = clamp01(P(params, 'Damping', 0.5));
  const bias = P(params, 'Bias', 0);
  const rotation = P(params, 'Rotation', 0);
  const anisotropy = P(params, 'Anisotropy', 0);
  const offX = P(params, 'Offset X', 0);
  const offY = P(params, 'Offset Y', 0);
  const perturb = P(params, 'Perturb', 'None');
  const perturbStrength = P(params, 'Strength', 0.5);
  const perturbComplexity = Math.max(1, P(params, 'Complexity', 3) | 0);
  const perturbRoughness = clamp01(P(params, 'Roughness', 0.5));
  const perturbAtten = clamp01(P(params, 'Attenuation', 0.5));
  const splitMode = P(params, 'Type', 'SelfModulation');
  const secondaryAmt = clamp01(P(params, 'Variation', 0.5));
  const modSmooth = clamp01(P(params, 'Smoothness', 0.35));

  const type = P(params, 'Noise Type', 'FBM');
  const octaves = auto
    ? Math.max(1, Math.min(16, Math.round(Math.log2(Math.max(2, scale * (1 + rel)))) + 3))
    : Math.max(1, Math.min(24, P(params, 'Octaves', 8) | 0));

  // Roughness -> persistence. Gaea's "Roughness" reads as spectral roughness: 0.5 is neutral.
  const gain = Math.max(0.05, Math.min(0.95, 0.5 + (rough - 0.5) * 0.45 + damping * 0.05));
  const lacunarity = 2.0;

  // Scale in "percent of terrain" -> cycles across the field.
  const freq = Math.max(0.25, (scale / 100) * 4 * Math.max(0.05, rel));
  const period = Math.max(1, Math.round(freq));
  const rot = (rotation * Math.PI) / 180;
  const ca = Math.cos(rot), sa = Math.sin(rot);
  const anisoX = 1 + anisotropy, anisoY = 1 / (1 + anisotropy * 0.9);
  const fractalType = type === 'Billowy' ? 'Billow' : type === 'Ridged' ? 'Ridged' : 'Standard';

  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;

  // Perturbation basis (None | Simple | Complex) — a low-cost domain warp of the lattice.
  const pertFreq = freq * 0.5;
  const doPerturb = perturb !== 'None';
  const pertStrength = perturbStrength * perturbAtten * (perturb === 'Complex' ? 1 : 0.5);

  for (let y = 0; y < size; y++) {
    const v0 = (y + 0.5) * inv - 0.5 + offY * 0.01;
    for (let x = 0; x < size; x++) {
      const u0 = (x + 0.5) * inv - 0.5 + offX * 0.01;
      // anisotropy + rotation in centred space
      let u = (u0 * ca - v0 * sa) * anisoX;
      let v = (u0 * sa + v0 * ca) * anisoY;

      let nx = u * freq, ny = v * freq;

      if (doPerturb) {
        // two extra domains; "Complex" adds a third for more breakup
        const px = fractalSum(perlin2, u * pertFreq, v * pertFreq, seed ^ 0x5a5a, perturbComplexity, 2, perturbRoughness, 'Standard', period);
        const py = fractalSum(perlin2, u * pertFreq + 31.7, v * pertFreq - 17.3, seed ^ 0xa5a5, perturbComplexity, 2, perturbRoughness, 'Standard', period);
        nx += px * pertStrength * 2.2;
        ny += py * pertStrength * 2.2;
        if (perturb === 'Complex') {
          const pz = fractalSum(perlin2, u * pertFreq * 2.3 - 7.1, v * pertFreq * 2.3 + 3.9, seed ^ 0xc3c3, 2, 2, 0.6, 'Standard', period);
          nx += pz * pertStrength * 0.8;
        }
      }

      let value = fractalSum(perlin2, nx, ny, seed, octaves, lacunarity, gain, fractalType, period);

      if (splitMode === 'SecondaryFractal' && secondaryAmt > 0) {
        const sec = fractalSum(value2, nx * 0.5, ny * 0.5, seed ^ 0x1234, Math.max(2, octaves >> 1), 2, gain, 'Standard', 0);
        value = value + (sec * 2 - 1) * secondaryAmt * 0.5;
      }

      // smoothness: low-pass by blending toward a coarser sample
      if (smoothness > 0) {
        const coarse = fractalSum(perlin2, nx * 0.4, ny * 0.4, seed, Math.max(1, octaves - 3), lacunarity, gain, fractalType, period);
        value = lerp(value, coarse, smoothness);
      }

      // normalise [-1,1] -> [0,1]
      let out = value * 0.5 + 0.5;
      if (bias !== 0) out = clamp01(out + bias * 0.25);
      if (contrast !== 1) {
        const c = Math.max(0.05, contrast);
        out = Math.pow(clamp01(out), 1 / c);
      }
      d[y * size + x] = out;
    }
  }

  // Edge smoothing: feather the frame so the primitive does not end in a hard cut.
  const edge = clamp01(P(params, 'Edge smoothing', 0));
  if (edge > 0) {
    const m = radialFalloffMask(size, 0.55, 1.0, 'smooth');
    for (let i = 0; i < d.length; i++) d[i] = lerp(d[i], d[i] * m[i], edge);
  }
  return f;
}

/* ------------------------------------------------------------------ Perlin */

/**
 * Perlin — Gaea's Perlin node, backed by the recovered FastNoiseSIMD kernel.
 *
 * The parameter reading and coordinate frame follow `RawNoise.Perlin` in the shipped
 * assembly: Scale is 0..1 (the binary inverts it), the lattice is
 * `((i,y) * 1/size - 0.5) * size`, and Frequency is `(1-Scale)*0.01*(512/size)`.
 * WarpType None is bit-exact against Gaea to float32 rounding (see
 * web/tests/gaea-fastnoise-test.mjs); Simple/Complex use a structural port that is not
 * yet numerically validated.
 */
export function perlinNode(ctx) {
  const { size, params, seed } = ctx;
  const type = P(params, 'Type', 'FBM');
  const scale = P(params, 'Scale', 0.5);
  const octaves = Math.max(1, Math.min(14, P(params, 'Octaves', 10) | 0));
  const gain = Math.max(0, Math.min(1, P(params, 'Gain', 0.5)));
  const height = P(params, 'Height', 1);
  const warp = P(params, 'Warp', 'Complex');
  const frequency = P(params, 'Frequency', 0.05);
  const amplitude = P(params, 'Amplitude', 0.5);
  const warpOctaves = Math.max(1, P(params, 'Warp Octaves', 10) | 0);
  const sx = P(params, 'Scale X', 1), sy = P(params, 'Scale Y', 1);
  const x = P(params, 'X', 0), y = P(params, 'Y', 0);

  const fractalType = type === 'Ridged' ? FN_FRACTAL.RIDGED
    : type === 'Billowy' ? FN_FRACTAL.BILLOW : FN_FRACTAL.FBM;
  const seedParam = P(params, 'Seed', seed ?? 0) | 0;

  const raw = fnPerlinGrid({
    size,
    scale,
    octaves,
    gain,
    fractalType,
    seed: seedParam,
    warp,
    frequency,
    amplitude,
    warpOctaves,
    scaleX: sx,
    scaleY: sy,
    // Gaea's node passes `new Vector2(X, Y)` into RawNoise.Perlin, where the offset is in
    // noise-space units (it is multiplied by the wavelength and then by the frequency).
    offsetX: x,
    offsetY: y,
  });

  const f = createField(size, 'height');
  const d = f.data;
  for (let i = 0; i < d.length; i++) d[i] = clamp01((raw[i] * 0.5 + 0.5) * height);
  return f;
}

/* ------------------------------------------------------------------ Ridge */

/** Ridge — ridged noise with a "Definition" exponent and axis scaling. */
export function ridgeNode(ctx) {
  const { size, params, seed } = ctx;
  const scale = Math.max(0.5, P(params, 'Scale', 100));
  const height = P(params, 'Height', 1);
  const def = Math.max(0.1, P(params, 'Definition', 1));
  const sx = P(params, 'Scale X', 1), sy = P(params, 'Scale Y', 1);
  const freq = Math.max(0.25, (scale / 100) * 4);
  const octaves = Math.max(3, Math.min(20, Math.round(Math.log2(freq * 8)) + 4));
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const period = Math.max(1, Math.round(freq));
  for (let y = 0; y < size; y++) {
    const v = ((y + 0.5) * inv - 0.5) * sy;
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) * inv - 0.5) * sx;
      let sum = 0, norm = 0, amp = 1, fr = freq;
      for (let o = 0; o < octaves; o++) {
        const n = 1 - Math.abs(perlin2(u * fr, v * fr, seed + o * 131, Math.max(1, Math.round(period * Math.pow(2, o)))));
        sum += Math.pow(Math.max(0, n), def) * amp;
        norm += amp;
        amp *= 0.5; fr *= 2;
      }
      d[y * size + x] = clamp01((norm > 0 ? sum / norm : 0) * height);
    }
  }
  return f;
}

/* ------------------------------------------------------------------ Cellular (Worley, 2D) */

/**
 * Cellular — 2D Worley with Gaea's Distance Metric / Distance Function vocabularies.
 * Distance functions: Hash (per-cell identity), DistanceInv (1/(1+d1)), Distance2Inv (1/(1+d2)),
 * DistanceDiff (d2-d1), DistanceToEdge (d1).
 * Metric Morph blends the selected metric toward Euclidean.
 */
export function cellular(ctx) {
  const { size, params, seed } = ctx;
  const scale = Math.max(0.5, P(params, 'Size', 50));
  const density = Math.max(1, P(params, 'Density', 1) | 0);
  const jitter = clamp01(P(params, 'Jitter', 1));
  const morph = clamp01(P(params, 'Metric Morph', 0));
  const metricName = P(params, 'Distance Metric', 'Euclidian_Manhattan');
  const caj = clamp01(P(params, 'Coordinate Axes Jitter', 0));
  const caClustering = clamp01(P(params, 'CAJ Clustering', 0));
  const aniso = P(params, 'Anisotropy', 0);
  const fnName = P(params, 'Distance Function', 'DistanceToEdge');

  const metric = metricName === 'Euclidian_Chebyshev' ? 'chebyshev'
    : metricName === 'Minkowski' ? 'minkowski' : 'manhattan';
  // Gaea's "Size" is like MultiFractal Scale: percent of terrain.
  const freq = Math.max(0.5, (scale / 100) * 6) * density;

  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const angle = caj * Math.PI;

  for (let y = 0; y < size; y++) {
    const v = ((y + 0.5) * inv - 0.5) * freq;
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) * inv - 0.5) * freq;
      const w = worley2(u, v, seed, {
        jitter: Math.max(0.05, jitter), metric, morph, density: 1,
        p: 4 + caClustering * 6, anisotropy: aniso, angle,
      });
      let out;
      switch (fnName) {
        case 'Hash': {
          // flat per-cell value: quantised feature identity
          out = ((w.id >>> 8) & 0xffff) / 65535;
          break;
        }
        case 'DistanceInv': out = 1 / (1 + w.f1 * w.f1 * 6); break;
        case 'Distance2Inv': out = 1 / (1 + w.f2 * w.f2 * 6); break;
        case 'DistanceDiff': out = clamp01((w.f2 - w.f1) * 1.6); break;
        case 'DistanceToEdge': default: out = clamp01(w.f1 * 1.35); break;
      }
      d[y * size + x] = clamp01(out);
    }
  }
  return f;
}

/* ------------------------------------------------------------------ Cellular3D */

/** Cellular3D — volumetric Worley evaluated on a Z sweep derived from the Y axis. */
export function cellular3d(ctx) {
  const { size, params, seed } = ctx;
  const scale = Math.max(0.5, P(params, 'Size', 50));
  const gap = clamp01(P(params, 'Gap', 0));
  const jx = P(params, 'Jitter X', 1), jy = P(params, 'Jitter Y', 1), jz = P(params, 'Jitter Z', 1);
  const sx = P(params, 'Scale X', 1), sy = P(params, 'Scale Y', 1), sz = P(params, 'Scale Z', 1);
  const normalize = P(params, 'Normalize Input', false);
  const freq = Math.max(0.5, (scale / 100) * 5);

  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const lo = normalize ? 0.15 : 0;

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const px = u * freq * sx, py = v * freq * sy, pz = (v * 0.5 + lo) * freq * sz;
      // 3x3x3 volumetric feature search
      const xi = Math.floor(px), yi = Math.floor(py), zi = Math.floor(pz);
      let f1 = Infinity, f2 = Infinity;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const cx = xi + dx, cy = yi + dy, cz = zi + dz;
            const h1 = hash2f(cx * 73856093 ^ cy, cy * 19349663 ^ cz, seed);
            const h2 = hash2f(cy * 83492791 ^ cz, cz * 2654435761 ^ cx, seed + 17);
            const h3 = hash2f(cz * 15485863 ^ cx, cx * 32452843 ^ cy, seed + 91);
            const fx = cx + 0.5 + (h1 - 0.5) * jx * (1 - gap);
            const fy = cy + 0.5 + (h2 - 0.5) * jy * (1 - gap);
            const fz = cz + 0.5 + (h3 - 0.5) * jz * (1 - gap);
            const ddx = fx - px, ddy = fy - py, ddz = fz - pz;
            const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            if (dist < f1) { f2 = f1; f1 = dist; } else if (dist < f2) { f2 = dist; }
          }
        }
      }
      d[y * size + x] = clamp01(Number.isFinite(f1) ? f1 : 0);
    }
  }
  return f;
}

/* ------------------------------------------------------------------ Voronoi */

/**
 * Voronoi — the Gaea node wraps RawNoise.Voronoi, i.e. FastNoiseSIMD cellular noise.
 *
 * The node's Build call is
 *   Noises.Voronoi(res, Scale, Function, Form, Gain, (int)WarpType, Frequency, Amplitude,
 *                  WarpOctaves, Seed, 1 - X, Y, ScaleX, ScaleY, Jitter)
 * so:
 *   - Scale is the raw 0..1 control (not a percentage); freq = Scale*0.01*(512/size);
 *   - X is inverted for the offset, Y is not;
 *   - ScaleX/ScaleY are axis scales (SetAxisScales), not extra frequency;
 *   - Gain is accepted by the wrapper but never reaches RawNoise (no effect), and Clamp
 *     simply multiplies the result when below 1.
 *
 * Form maps to FastNoise cellular return types (see fnCellular3). Warp uses FastNoise's
 * perturbation; its structure is ported but not numerically validated.
 */
export function voronoi(ctx) {
  const { size, params, seed } = ctx;
  const rawScale = P(params, 'Scale', 0.5);
  const scale = rawScale > 1 ? rawScale / 100 : rawScale; // tolerate pre-0.5.0 project values
  const jitter = clamp01(P(params, 'Jitter', 0.45));
  const fnName = P(params, 'Function', 'Euclidean');
  const form = P(params, 'Form', 'P');
  const warp = P(params, 'Type', 'Complex');
  const frequency = P(params, 'Frequency', 0.05);
  const amplitude = clamp01(P(params, 'Amplitude', 0.5));
  const warpOctaves = Math.max(1, P(params, 'Octaves', 14) | 0);
  const scaleX = P(params, 'Scale X', 1), scaleY = P(params, 'Scale Y', 1);
  const ox = 1 - P(params, 'X', 0.5), oy = P(params, 'Y', 0.5);
  const clampV = P(params, 'Clamp', 1);

  const distanceFunction = fnName === 'Manhattan' ? FN_CELLULAR_DISTANCE.MANHATTAN
    : fnName === 'Natural' ? FN_CELLULAR_DISTANCE.NATURAL
      : FN_CELLULAR_DISTANCE.EUCLIDEAN;
  const returnType = FORM_RETURN[form] ?? FN_CELLULAR_RETURN.DISTANCE2;

  const grid = fnVoronoiGrid({
    size, scale, jitter, distanceFunction, returnType, seed,
    warp, frequency, amplitude, warpOctaves,
    scaleX, scaleY, offsetX: ox, offsetY: oy,
  });

  const f = createField(size, 'height');
  const d = f.data;

  // Gaea's node normalises the sampler output before touching Clamp:
  //   Noises.Voronoi(...).<normalise>().<normalise>();
  //   if (Clamp < 1) map *= Clamp;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < d.length; i++) { const v = grid[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;
  const mul = (clampV < 1 ? clampV : 1) / (span > 0 ? span : 1);
  for (let i = 0; i < d.length; i++) d[i] = (grid[i] - lo) * mul;
  return f;
}

const FORM_RETURN = {
  C: FN_CELLULAR_RETURN.CELL,
  N: FN_CELLULAR_RETURN.NOISE,
  R: FN_CELLULAR_RETURN.DISTANCE,
  P: FN_CELLULAR_RETURN.DISTANCE2,
  A: FN_CELLULAR_RETURN.ADD,
  S: FN_CELLULAR_RETURN.SUB,
  M: FN_CELLULAR_RETURN.MUL,
  D: FN_CELLULAR_RETURN.DIV,
};

/* ------------------------------------------------------------------ DotNoise */

/**
 * DotNoise — layered speckle. Each iteration places one dot per cell of a jittered lattice
 * and accumulates a radial/Square falloff. Output is a mask-like height in [0,1].
 */
export function dotNoise(ctx) {
  const { size, params, seed } = ctx;
  const style = P(params, 'Style', 'Dot');
  const iterations = Math.max(1, Math.min(24, P(params, 'Iterations', 6) | 0));
  const multiplier = P(params, 'Multiplier', 1);
  const sz = P(params, 'Size', [1, 1]);
  const height = P(params, 'Height', 1);
  const seedV = seed;

  const sx = Math.max(0.05, Array.isArray(sz) ? sz[0] : 1);
  const sy = Math.max(0.05, Array.isArray(sz) ? sz[1] : 1);
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;

  for (let it = 0; it < iterations; it++) {
    // feature count grows with iteration; each layer keeps its own lattice.
    // Cap the lattice so a large Iterations value (Gaea allows up to 500) cannot make the
    // per-layer loop quadratic-explode into billions of cells.
    const cells = Math.max(1, Math.min(64, Math.round(2 * Math.pow(1.6, it))));
    const amp = Math.pow(multiplier, it) / iterations;
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const h1 = hash2f(cx, cy, seedV + it * 7919);
        const h2 = hash2f(cy + 1013, cx - 777, seedV + it * 7919);
        const px = (cx + h1) / cells;
        const py = (cy + h2) / cells;
        const radius = 0.5 / cells * (0.35 + 0.65 * hash2f(cx * 3 + 1, cy * 5 + 2, seedV + it));
        // bounding box in pixels
        const rx = radius * sx, ry = radius * sy;
        const x0 = Math.max(0, Math.floor((px - rx) * size));
        const x1 = Math.min(size - 1, Math.ceil((px + rx) * size));
        const y0 = Math.max(0, Math.floor((py - ry) * size));
        const y1 = Math.min(size - 1, Math.ceil((py + ry) * size));
        for (let y = y0; y <= y1; y++) {
          const v = (y + 0.5) * inv;
          for (let x = x0; x <= x1; x++) {
            const u = (x + 0.5) * inv;
            const du = (u - px) / (rx || 1e-6);
            const dv = (v - py) / (ry || 1e-6);
            let t;
            if (style === 'Square') {
              t = Math.max(Math.abs(du), Math.abs(dv));
            } else {
              t = Math.sqrt(du * du + dv * dv);
            }
            if (t >= 1) continue;
            const fall = 1 - t;
            const contrib = fall * fall * amp * height;
            const i = y * size + x;
            if (contrib > d[i]) d[i] = contrib;
          }
        }
      }
    }
  }
  // normalize into [0,1] robustly
  const s = stats(f);
  const span = s.max - s.min;
  if (span > 1e-9) {
    for (let i = 0; i < d.length; i++) d[i] = (d[i] - s.min) / span;
  }
  return f;
}

/* ------------------------------------------------------------------ Crater */

/**
 * ThermalShaper 的近似：原生 `ErosionWrapperTS.ErodeTerrain` 未移植，这里用一次
 * 带各向异性的 talus 松弛代替。参数与 remaining.js 里 ThermalShaper 节点的近似一致。
 */
function thermalRelax(data, size, steps, talus, anisotropy = 0, angleDeg = 0) {
  const h = Float32Array.from(data);
  const delta = new Float32Array(h.length);
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DD = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];
  const a = (angleDeg * Math.PI) / 180;
  const ax = Math.cos(a), ay = Math.sin(a);
  for (let it = 0; it < steps; it++) {
    delta.fill(0);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        const hc = h[i];
        let total = 0;
        const moves = [];
        for (let k = 0; k < 8; k++) {
          const j = (y + DY[k]) * size + (x + DX[k]);
          const diff = hc - h[j];
          if (diff <= 0) continue;
          const slope = diff / DD[k];
          if (slope <= talus) continue;
          let w = 1;
          if (anisotropy > 0) {
            const kx = DX[k] / DD[k], ky = DY[k] / DD[k];
            w = Math.max(0.02, 1 + anisotropy * (kx * ax + ky * ay) * 0.9);
          }
          const excess = (slope - talus) * DD[k] * 0.25;
          moves.push([j, excess * w]);
          total += excess * w;
        }
        if (total <= 0) continue;
        let lowest = Infinity;
        for (const m of moves) if (h[m[0]] < lowest) lowest = h[m[0]];
        const budget = Math.min(total, Math.max(0, (hc - lowest) * 0.5));
        if (budget <= 0) continue;
        for (const m of moves) delta[m[0]] += budget * (m[1] / total);
        delta[i] -= budget;
      }
    }
    for (let i = 0; i < h.length; i++) {
      const v = h[i] + delta[i];
      h[i] = Number.isFinite(v) ? (v < 0 ? 0 : v) : h[i];
    }
  }
  return h;
}

/**
 * Crater — 按反编译 `Crater.Build()` 的两条分支移植。
 *
 * Style = New（默认）：走 `Landscapes.Crater` → `CraterfieldGenerator`，该原生生成器未移植，
 * 这里保留经典的撞击坑剖面（坑缘 + 坑底 + 溅射）作为近似。
 *
 * Style = Classic：精确复刻非 New 分支：
 *   RadialGradient(N, N*X, N*Y, N*Scale*2)
 *   → Sine/Triangle(Formation.lerp(0, 0.75))      // Rim Soft=Sine, Sharp=Triangle
 *   → ThermalShaper(1, Shape)                     // 原生核未移植，用 talus 松弛近似
 *   → Drop → ×Height
 * 注意 Sine/Triangle 的 symmetric 参数在原版是 `false`（`(byte)0 != 0`），不是 true。
 */
export function crater(ctx) {
  const { size, params, seed } = ctx;
  const style = P(params, 'Style', 'New');
  const scale = clamp(P(params, 'Scale', 0.3), 0.0001, 1);
  const formation = clamp01(P(params, 'Formation', 0.65));
  const height = clamp(P(params, 'Height', 0.65), 0, 1);
  const rimSharp = P(params, 'Rim', 'Soft') === 'Sharp';
  const shape = clamp(P(params, 'Shape', -0.5), -1, 1);
  const cx = clamp01(P(params, 'X', 0.5));
  const cy = clamp01(P(params, 'Y', 0.5));

  if (style === 'New') {
    const f = createField(size, 'height');
    const d = f.data;
    const inv = 1 / size;
    const radius = Math.max(0.02, scale);
    for (let y = 0; y < size; y++) {
      const v = (y + 0.5) * inv - cy;
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) * inv - cx;
        const r = Math.sqrt(u * u + v * v) / radius;
        // 坑缘：r=1 附近的高斯带，Sharp 更窄
        const rimW = rimSharp ? 0.10 : 0.30 + (1 - clamp01(shape)) * 0.2;
        const rim = Math.exp(-Math.pow((r - 1) / rimW, 2));
        // 坑底：r<1 的碗形，Formation 越深
        const floor = r < 1 ? -Math.pow(1 - r * r, 1 + formation * 2) : 0;
        // 溅射：向外衰减
        const ejecta = r > 1 ? Math.exp(-(r - 1) * (2.5 + clamp01(shape) * 3)) * (1 - formation) * 0.55 : 0;
        const out = floor * 0.9 + rim * (rimSharp ? 1 : 0.75) + ejecta;
        const brk = (value2(u * 14 + 5, v * 14 - 3, seed) - 0.5) * 0.06 * (1 - Math.min(1, r));
        d[y * size + x] = clamp01(0.5 + (out + brk) * 0.5 * height * 1.5);
      }
    }
    return f;
  }

  // Classic：径向渐变 → 折叠剖面 → 热力整形 → Drop → ×Height
  const grad = radialGradient(size, cx * size, cy * size, size * scale * 2, 1);
  const folds = formation * 0.75; // Formation.\ue05d\uedfb\ue0c7(0, 0.75)
  const prof = new Float32Array(size * size);
  for (let i = 0; i < prof.length; i++) {
    const a = grad[i];
    if (!rimSharp) {
      prof[i] = 0.5 + 0.5 * Math.sin(a * folds * TAU);
    } else {
      let t = a * folds + 0.25;
      t -= Math.floor(t);
      prof[i] = 1 - Math.abs(t * 2 - 1);
    }
  }
  // ThermalShaper(map, 1, Shape)：原生核未移植，用同样的 talus 近似
  // （Influence=1 → 12 步、talus 0.02，与 remaining.js 的 ThermalShaper 节点同参数化）
  const shaped = thermalRelax(prof, size, 12, 0.02, Math.abs(shape) * 0.5, shape * 90);
  const dropped = mapDrop(shaped);
  const f = createField(size, 'height');
  for (let i = 0; i < f.data.length; i++) f.data[i] = clamp01(dropped[i] * height);
  return f;
}

/* ------------------------------------------------------------------ Mountain */

/**
 * Mountain — peak generator using ridged Voronoi (Gaea describes it as a "modulated Voronoi
 * pattern"). The real node is a hand-tuned multi-primitive stack; this is a reasonable
 * reconstruction driven by the same exposed controls.
 */
export function mountain(ctx) {
  const { size, params, seed } = ctx;
  const scale = Math.max(1, P(params, 'Scale', 40));
  const height = P(params, 'Height', 1);
  const style = P(params, 'Style', 'Basic');
  const bulk = P(params, 'Bulk', 'Medium');
  const reduce = P(params, 'Reduce Details', false);
  const cxp = P(params, 'X', 0), cyp = P(params, 'Y', 0);

  const freq = Math.max(0.75, (scale / 100) * 6);
  const octaves = reduce ? 5 : 9;
  const bulkK = bulk === 'Low' ? 1.35 : bulk === 'High' ? 0.72 : 1.0;
  const styleK = style === 'Alpine' ? 1.25 : style === 'Old' ? 0.75 : style === 'Eroded' ? 0.9 : 1.0;

  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;

  for (let y = 0; y < size; y++) {
    const v0 = (y + 0.5) * inv - 0.5 - cyp * 0.01;
    for (let x = 0; x < size; x++) {
      const u0 = (x + 0.5) * inv - 0.5 - cxp * 0.01;
      // ridged Voronoi: crest = distance to cell edge, ridged and summed over octaves
      let sum = 0, norm = 0, amp = 1, fr = freq;
      for (let o = 0; o < octaves; o++) {
        const w = worley2(u0 * fr, v0 * fr, seed + o * 977, { jitter: 0.85, metric: 'euclid', morph: 0 });
        const crest = 1 - clamp01((w.f2 - w.f1) * 1.25);
        sum += crest * crest * amp;
        norm += amp;
        amp *= 0.52; fr *= 2.05;
      }
      let m = norm > 0 ? sum / norm : 0;
      m = Math.pow(m, 1.35 * bulkK / styleK);
      // central massif: soft radial envelope so the range reads as a mountain, not a texture
      const r = Math.sqrt(u0 * u0 + v0 * v0);
      const env = 1 - smoothstep(0.12, 0.95, r);
      m *= 0.25 + 0.75 * env;
      if (style === 'Strata') {
        m += Math.sin(m * 22) * 0.03;
      }
      d[y * size + x] = clamp01(m * height * 1.15);
    }
  }
  return f;
}

/* ------------------------------------------------------------------ Canyon */

/**
 * `Landscapes.Canyon` 的结构移植（Gaea.Nodes 反编译 1533-1595）。
 *
 * 真实管线并不是"噪声切槽"，而是一条被两次 Voronoi 扭曲的中部折脊：
 *
 *   LinearGradient(竖向 0..1) → Min(自身, 反相) → 指数曲线(Slot)
 *     → FractalWarp(size = 0.4*Scale,  VoronoiR, 迭代 6) → 指数曲线(Valley)
 *     → FractalWarp(size = 0.6*Scale,  VoronoiR, 迭代 2) → 指数曲线(Surrounding)
 *     → 1 - map*Depth
 *     → Style: PE 侵蚀 / 分层阶地
 *     → 输出 0: Drop(map)；输出 1: 归一化(map)（InvertNormalize 之后再反相）
 *
 * 与原实现的差别是可见结构（中部折脊 + 蜿蜒槽谷）而不是参数；这也是之前"渲染差别很大"
 * 的根因：旧实现是独立的 Worley 沟槽网络，几何完全不同。
 *
 * 仍标 `model` 的部分：PE 侵蚀用本仓库的 droplet 多尺度解算器代替 SYCL 内核，
 * Strata 的三级 `Profiles.FractalTerrace` 用 `Profiles.Terrace` 近似。
 */

/**
 * `WarpNoiseType.VoronoiR` = FNSIMD 的 CellularReturnType.Distance（最近点距离），
 * jitter 0.45、Euclidean。注意 `SetNoiseType(7)` 是 FastNoiseSIMD 的 **Cellular**（非分形），
 * 所以 `SetFractalOctaves(12)` / `SetFractalGain(0.5)` / `SetFractalType(1)` 对它全部无效——
 * 这里是单帧 Cellular，不是 12 阶 FBM。只有 PerlinFBM 那条路（NoiseType 3 = PerlinFractal）
 * 才会用到 octaves/gain。
 */
function voronoiDistance(seed, x, y, jitter) {
  return fnCellular3(seed, x, y, 0, {
    jitter, distanceFunction: 0, returnType: FN_CELLULAR_RETURN.DISTANCE,
  });
}

/** `Warps.FractalWarp` 的 Virtual 模式（iterativeWarpMode = 1）。 */
function canyonWarp(src, size, o) {
  const scale = Math.max(1e-4, o.size);
  const strength = o.strength;
  const octaves = o.octaves | 0;
  const roughness = o.roughness === undefined ? 0.5 : o.roughness;
  const perturb = o.perturbation || 0;
  const voronoi = o.noise !== 'perlin';
  const jitter = o.jitter === undefined ? 0.45 : o.jitter;
  // 非 Perlin 噪声且 perturbation > 0 时，最后追加一次 PerlinFractal 的细节扰动。
  const extra = voronoi && perturb > 0;
  const iterations = (o.iterations | 0) + (extra ? 1 : 0);
  const warp = strength * size * scale;
  const freq = 1 / (scale * size);

  const vx = new Float32Array(size * size);
  const vy = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      vx[y * size + x] = x;
      vy[y * size + x] = y;
    }
  }

  let seed = o.seed | 0;
  for (let it = 0; it < iterations; it++) {
    const sign = (it & 1) ? -1 : 1;
    const last = extra && it === iterations - 1;
    const f = last ? freq * 4 : freq;
    const amp = last ? perturb * size * scale * 0.25 : warp;
    const seedX = seed++;
    const seedY = seed++;
    const nvx = new Float32Array(size * size);
    const nvy = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = x * f, py = y * f;
        let nx, ny;
        if (last || !voronoi) {
          // FastNoise 的 Perlin 是双极性的，扰动迭代用原始值
          nx = fnFractalPerlin(seedX, px, py, 0, { octaves, gain: roughness, fractalType: 0 });
          ny = fnFractalPerlin(seedY, px, py, 0, { octaves, gain: roughness, fractalType: 0 });
        } else {
          nx = voronoiDistance(seedX, px, py, jitter);
          ny = voronoiDistance(seedY, px, py, jitter);
        }
        nx *= sign;
        ny *= sign;
        const i = y * size + x;
        nvx[i] = sampleBilinear(vx, size, x + nx * amp, y + ny * amp);
        nvy[i] = sampleBilinear(vy, size, x + nx * amp, y + ny * amp);
      }
    }
    vx.set(nvx);
    vy.set(nvy);
  }

  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = sampleBilinear(src, size, vx[i], vy[i]);
  return out;
}

/** `Erosions.PE` 的调用包装：把 Canyon 的固定实参送进 droplet 多尺度解算器。 */
function canyonErode(data, size, seed, { duration, erosionScale, depositionBoost, extraBoost }) {
  const src = createField(size, 'height');
  src.data.set(data);
  const out = hydraulicDropletMultiscale({
    size,
    seed,
    params: {
      Duration: duration,
      Downcutting: 0.4,
      'Erosion Scale': erosionScale,
      'Suspended Load': 1,
      'Bed Load': 0.6,
      'Coarse Sediments': 0.4,
      Shape: 0.5,
      'Shape Sharpness': 0.5,
      'Shape Detail Scale': 0.5,
      DepositionBoost: depositionBoost,
      ExtraDepositionBoost: extraBoost,
      NoErosion: false,
    },
    input: () => src,
  });
  return out && out.data ? out.data : null;
}

export function canyon(ctx) {
  const { size, params, seed: baseSeed } = ctx;
  const style = P(params, 'Style', 'Eroded');
  const scaleP = clamp01(P(params, 'Scale', 0.35));
  // 反编译里的 `Slot.\ue05d\uedfb\ue0c7(-1f, 1f)` 是「把 0..1 的滑杆线性重映射到 [-1,1]」：
  //   `a + v*(b-a)`，不是 clamp（Slot 的 ParameterRange 本来就是 0..1，clamp 没有意义）。
  // 漏掉这一步会让三条指数曲线全部反号，峡谷从"窄槽+宽台地"变成"宽槽+薄边缘"，这正是
  // 之前渲染和 Gaea 完全不像的第二个原因。
  const bipolar = (v) => v * 2 - 1;
  const slot = bipolar(clamp01(P(params, 'Slot', 0.2)));
  const valley = bipolar(clamp01(P(params, 'Valley', 0.4)));
  const surrounding = bipolar(clamp01(P(params, 'Surrounding', 0.6)));
  const depth = Math.max(0, P(params, 'Depth', 0.5));
  const structWarp = clamp01(P(params, 'Structual Warp', 0.5));
  const detailWarp = clamp01(P(params, 'Detail Warp', 0.5));
  const alternate = !!P(params, 'Alternate Style', false);
  const seed = (baseSeed + (P(params, 'Seed', 0) | 0)) | 0;

  // 1) 线性渐变（edge = Mirror）与自身的**反相**取 Min → 一条居中的对称折脊。
  //    反编译里是 `map2 = map.Copy(); map2.\ueb77\uf21d\ue95d();`
  //    而 `\ueb77\uf21d\ue95d()` 的定义是 `Vector<float>.One - v`（反相），不是水平镜像：
  //    GradientCore 在 azimuth 0 时与 x 无关，镜像会是恒等运算，Min 也就成了空操作。
  let map = linearGradient(size, size / 2, size / 2, size, 0, EDGE_MIRROR);
  const inverted = mapInvert(map);
  for (let i = 0; i < map.length; i++) if (inverted[i] < map[i]) map[i] = inverted[i];

  // 2) Slot 曲线（单参指数曲线 = curve * -10）
  exponentialCurveInPlace(map, slot * -10);

  // 3) 第一次结构扭曲：默认 = VoronoiR(size 0.4*Scale)；Alternate Style 开 = PerlinFBM(size 0.8*StructWarp)
  //    反编译里 `voronoi` 实参是 `!AlternateStyle`。
  map = canyonWarp(map, size, {
    size: alternate ? Math.max(1e-4, 0.8 * structWarp) : 0.4 * scaleP,
    strength: 0.35,
    noise: alternate ? 'perlin' : 'voronoi',
    perturbation: structWarp,
    octaves: 12,
    roughness: 0.5,
    iterations: 6,
    seed: seed + 1,
    jitter: 0.45,
  });
  exponentialCurveInPlace(map, valley * -10);

  // 4) 第二次细节扭曲：VoronoiR、2 次迭代
  map = canyonWarp(map, size, {
    size: Math.max(1e-4, 0.6 * scaleP),
    strength: 0.7,
    noise: 'voronoi',
    perturbation: detailWarp,
    octaves: 12,
    roughness: 0.5,
    iterations: 2,
    seed: seed + 2,
    jitter: 0.45,
  });
  exponentialCurveInPlace(map, surrounding * -10);

  // 5) 1 - map*Depth（Subtract(常量 1, map, Depth)）
  for (let i = 0; i < map.length; i++) map[i] = 1 - map[i] * depth;

  // 6) Style：Eroded / Both → PE(50)；Eroded2 → PE(20, scale 700, 沉积加成)；Strata / Both → 三级阶地
  if (style === 'Eroded' || style === 'Both') {
    const pe = canyonErode(map, size, seed, {
      duration: 50, erosionScale: 1000, depositionBoost: 0, extraBoost: 0,
    });
    if (pe) for (let i = 0; i < map.length; i++) if (pe[i] < map[i]) map[i] = pe[i];
  } else if (style === 'Eroded2') {
    const pe = canyonErode(map, size, seed + 5, {
      duration: 20, erosionScale: 700, depositionBoost: 1, extraBoost: 1,
    });
    if (pe) for (let i = 0; i < map.length; i++) if (pe[i] < map[i]) map[i] = pe[i];
  }
  if (style === 'Strata' || style === 'Both') {
    // 三级 `Profiles.FractalTerrace` 的近似：逐级更细的阶地，再与上一级取 Min。
    // FractalTerrace 的 `spacing` 是"归一化高度上的阶地间距"，条数 = 1/spacing：
    //   第 1 级 0.05 → 20 条；第 2 级 0.1 → 10 条；第 3 级 0.01 → 100 条（intensity 均为 0.5）。
    const base = map;
    const t1 = profileTerrace(base, 21, 0.5, 0.5, 0.5, seed + 1, false);
    const m1 = new Float32Array(map.length);
    for (let i = 0; i < m1.length; i++) m1[i] = Math.min(base[i], t1[i]);
    const t2 = profileTerrace(m1, 11, 0.5, 0.5, 0.5, seed + 2, false);
    const m2 = new Float32Array(map.length);
    for (let i = 0; i < m2.length; i++) m2[i] = Math.min(t1[i], t2[i]);
    const t3 = profileTerrace(m2, 101, 0.5, 0.5, 0.5, seed + 3, false);
    const m3 = new Float32Array(map.length);
    for (let i = 0; i < m3.length; i++) m3[i] = Math.min(t2[i], t3[i]);
    const pe = canyonErode(m3, size, seed, {
      duration: 10, erosionScale: 1000, depositionBoost: 0, extraBoost: 0,
    });
    if (pe) for (let i = 0; i < m3.length; i++) if (pe[i] < m3[i]) m3[i] = pe[i];
    // Mask(base, terraced, GetHeightNormalized(base, 0, 0.65, 0.1)) 的精确移植：
    // GetHeightNormalized 先做反相归一化（min→1、max→0），再把落在 [min,max] 的像素置 1，
    // 越界 0.1 的范围内线性衰减到 0。也就是"高度不低于 35% 的区域用阶地，25% 以下保持原样"。
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < base.length; i++) { if (base[i] < mn) mn = base[i]; if (base[i] > mx) mx = base[i]; }
    const span = mx - mn || 1;
    const hi = 0.65, falloff = 0.1;
    for (let i = 0; i < map.length; i++) {
      const inv = 1 - (base[i] - mn) / span;
      let mask;
      if (inv <= hi) mask = 1;
      else if (inv >= hi + falloff) mask = 0;
      else mask = 1 - (inv - hi) / falloff;
      map[i] = base[i] * (1 - mask) + m3[i] * mask;
    }
  }

  // 7) 输出：0 = Drop(map)；1 = 归一化(map)。
  //    反编译是 `map10.ue961(); map10.ue95d();`——先反相归一化再反相，两次正好还原成普通归一化。
  const out0 = mapDrop(map);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < map.length; i++) { if (map[i] < mn) mn = map[i]; if (map[i] > mx) mx = map[i]; }
  const span = mx - mn || 1;
  const out1 = new Float32Array(map.length);
  for (let i = 0; i < out1.length; i++) out1[i] = (map[i] - mn) / span;

  const f0 = createField(size, 'height');
  f0.data.set(out0);
  const f1 = createField(size, 'height');
  f1.data.set(out1);
  return [f0, f1];
}

/* ------------------------------------------------------------------ Glacier */

/**
 * Glacier — ice accumulation on high ground, flowing downhill with breakage.
 * Simplified: a downhill-biased smoothed accumulation, breaking along directional cracks.
 */
export function glacier(ctx) {
  const { size, params, seed } = ctx;
  const scale = Math.max(0.5, P(params, 'Scale', 50));
  const thickness = clamp01(P(params, 'Thickness', 0.5));
  const height = P(params, 'Height', 0.5);
  const direction = P(params, 'Direction', 0);
  const breakage = clamp01(P(params, 'Breakage', 0.3));
  const rough = P(params, 'Rough Edges', false);
  const smooth = P(params, 'Smooth', false);
  const breakupCount = Math.max(1, Math.min(64, P(params, 'Breakage Count', 6) | 0));
  const flowDepth = clamp01(P(params, 'Flow Breakage Depth', 0.4));

  const freq = Math.max(0.4, (scale / 100) * 3);
  const period = Math.max(1, Math.round(freq));
  const ang = (direction / 16) * TAU;
  const ca = Math.cos(ang), sa = Math.sin(ang);

  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const lobes = smooth ? 2 : 5;

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv - 0.5;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv - 0.5;
      // downhill coordinate along the flow direction
      const t = (u * ca + v * sa) * freq;
      const n = (u * -sa + v * ca) * freq;
      let acc = fractalSum(value2, t * 0.9, n * 2.4, seed, lobes, 2.1, 0.55, 'Standard', period) * 0.5 + 0.5;
      acc = Math.pow(clamp01(acc), 0.7);
      // tongue: strong along-flow banding
      let ice = acc * (0.45 + thickness);
      // breakage: directional cracks
      if (breakage > 0) {
        const crack = fractalSum(perlin2, n * breakupCount * 0.6, t * 3.1, seed ^ 0x99, 3, 2, 0.5, 'Standard', 0) * 0.5 + 0.5;
        ice *= 1 - Math.pow(1 - crack, 4) * breakage;
        if (flowDepth > 0) ice -= Math.pow(clamp01(crack), 8) * flowDepth * 0.35;
      }
      if (rough) ice += (value2(u * 90, v * 90, seed ^ 0xd1) - 0.5) * 0.06;
      d[y * size + x] = clamp01(ice * height * 1.6);
    }
  }
  return f;
}

/* ------------------------------------------------------------------ Gradient / Mask helpers */

/** Linear gradient generator backing a few mask-like primitives. */
export function gradientMask(ctx) {
  const { size, params, seed } = ctx;
  const angle = (P(params, 'Angle', 0) / 360) * TAU;
  const center = P(params, 'Center', 0.5);
  const width = P(params, 'Width', 1);
  const f = createField(size, 'mask');
  f.data.set(linearGradientMask(size, angle, center - 0.5, width));
  return f;
}

/** Radial mask generator. */
export function radialMask(ctx) {
  const { size, params } = ctx;
  const start = clamp01(P(params, 'Start', 0.7));
  const end = clamp01(P(params, 'End', 1));
  const f = createField(size, 'mask');
  f.data.set(radialFalloffMask(size, start, Math.max(start + 1e-3, end), 'smooth'));
  return f;
}

/* ------------------------------------------------------------------ FlowMap */

/**
 * FlowMap — D8 flow accumulation over a height input.
 * Gaea's FlowMap produces a rendered flow/velocity map; we compute the standard
 * D8 accumulation + flow direction magnitude, which is the physical quantity underneath.
 */
export function flowMap(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  const flowLength = clamp01(P(params, 'Flow Length', 0.5));
  const flowVolume = clamp01(P(params, 'Flow Volume', 0.5));
  const out = createField(size, 'flow');

  if (!src) {
    return out;
  }
  const h = src.channels === 1 ? src.data : src.data;
  const stride = src.channels;
  const acc = new Float32Array(size * size).fill(1);
  const order = new Uint32Array(size * size);
  for (let i = 0; i < order.length; i++) order[i] = i;

  // Sort by descending height: process high ground first.
  const heights = new Float32Array(size * size);
  for (let i = 0; i < heights.length; i++) heights[i] = h[i * stride];
  const sorted = Array.from(order).sort((a, b) => heights[b] - heights[a]);

  const dirs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (let k = 0; k < sorted.length; k++) {
    const i = sorted[k];
    const x = i % size, y = (i / size) | 0;
    const hc = heights[i];
    let bestSlope = 0, bx = -1, by = -1;
    for (let dd = 0; dd < 8; dd++) {
      const nx = x + dirs[dd][0], ny = y + dirs[dd][1];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nh = heights[ny * size + nx];
      const dist = dirs[dd][0] !== 0 && dirs[dd][1] !== 0 ? Math.SQRT2 : 1;
      const slope = (hc - nh) / dist;
      if (slope > bestSlope) { bestSlope = slope; bx = nx; by = ny; }
    }
    if (bx >= 0) acc[by * size + bx] += acc[i];
  }

  // log-compress accumulation, then apply the two exposed modifiers
  let maxAcc = 1;
  for (let i = 0; i < acc.length; i++) if (acc[i] > maxAcc) maxAcc = acc[i];
  const logMax = Math.log1p(maxAcc);
  for (let i = 0; i < acc.length; i++) {
    const t = Math.log1p(acc[i]) / (logMax || 1);
    out.data[i] = clamp01(Math.pow(t, 1 + (1 - flowVolume) * 2) * (0.35 + flowLength * 0.65));
  }
  return out;
}
