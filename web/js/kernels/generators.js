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
  createField, clamp01, lerp, smoothstep, stats, radialFalloffMask, linearGradientMask,
} from '../kernel/field.js';

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

/** Perlin — straightforward fBm/ridged/billowy with explicit Gain and Height. */
export function perlinNode(ctx) {
  const { size, params, seed } = ctx;
  const type = P(params, 'Type', 'FBM');
  const scale = Math.max(0.5, P(params, 'Scale', 100));
  const octaves = Math.max(1, Math.min(24, P(params, 'Octaves', 6) | 0));
  const gain = Math.max(0.05, Math.min(0.95, P(params, 'Gain', 0.5)));
  const height = P(params, 'Height', 1);
  const warpType = P(params, 'Type', 'None'); // duplicate label: second block = warp Type
  const freqW = P(params, 'Frequency', 1);
  const ampW = P(params, 'Amplitude', 0);
  const warpOct = Math.max(1, P(params, 'Octaves', 3) | 0);
  const sx = P(params, 'Scale X', 1), sy = P(params, 'Scale Y', 1);
  const ox = P(params, 'X', 0), oy = P(params, 'Y', 0);

  // NOTE: nodes.json contains two params literally named "Type" and two named "Octaves" for
  // Perlin (a vendor flattening artefact). The catalog keeps both; last-write-wins here, which
  // matches how the flattening lost the section context. Documented in IMPLEMENTATION-NOTES.md.
  const fractalType = type === 'Ridged' ? 'Ridged' : type === 'Billowy' ? 'Billow' : 'Standard';
  const freq = Math.max(0.25, (scale / 100) * 4);
  const period = Math.max(1, Math.round(freq));
  const doWarp = ampW > 0 && (warpType === 'Simple' || warpType === 'Complex');

  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = ((y + 0.5) * inv - 0.5 + oy * 0.01) * sy;
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) * inv - 0.5 + ox * 0.01) * sx;
      let nx = u * freq, ny = v * freq;
      if (doWarp) {
        const wx = fractalSum(perlin2, u * freq * freqW, v * freq * freqW, seed ^ 0x77, warpOct, 2, 0.5, 'Standard', period);
        const wy = fractalSum(perlin2, u * freq * freqW + 13.3, v * freq * freqW - 7.7, seed ^ 0x88, warpOct, 2, 0.5, 'Standard', period);
        nx += wx * ampW; ny += wy * ampW;
      }
      const val = fractalSum(perlin2, nx, ny, seed, octaves, 2, gain, fractalType, period);
      d[y * size + x] = clamp01((val * 0.5 + 0.5) * height);
    }
  }
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
 * Voronoi — cell noise with 8 output forms (C N R P A S M D) plus optional simple/complex warp.
 * The Form semantics are Gaea-internal and undocumented; the mapping implemented here is a
 * REASONABLE APPROXIMATION (documented in IMPLEMENTATION-NOTES.md):
 *   C = flat cell colour, N = F1 distance, R = F2-F1 edge distance, P = 1/(1+F1^2),
 *   A = F1*F2, S = smoothed cell (cellular F1 processed by Gain), M = max(F1, F2),
 *   D = per-cell random with "Clamp" as the density control.
 */
export function voronoi(ctx) {
  const { size, params, seed } = ctx;
  const scale = Math.max(0.5, P(params, 'Scale', 50));
  const jitter = clamp01(P(params, 'Jitter', 1));
  const fn = P(params, 'Function', 'Euclidean');
  const form = P(params, 'Form', 'C');
  const gain = P(params, 'Gain', 1);
  const clampV = clamp01(P(params, 'Clamp', 0.5));
  const warpType = P(params, 'Type', 'None');
  const wfreq = P(params, 'Frequency', 1);
  const wamp = clamp01(P(params, 'Amplitude', 0));
  const woct = Math.max(1, P(params, 'Octaves', 2) | 0);
  const sx = P(params, 'Scale X', 1), sy = P(params, 'Scale Y', 1);
  const ox = P(params, 'X', 0), oy = P(params, 'Y', 0);

  const freq = Math.max(0.5, (scale / 100) * 6);
  const period = Math.max(1, Math.round(freq));
  const metric = fn === 'Manhattan' ? 'manhattan' : 'euclid';
  const doWarp = wamp > 0 && warpType !== 'None';

  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;

  for (let y = 0; y < size; y++) {
    const v0 = ((y + 0.5) * inv - 0.5 + oy * 0.01) * sy;
    for (let x = 0; x < size; x++) {
      const u0 = ((x + 0.5) * inv - 0.5 + ox * 0.01) * sx;
      let u = u0, v = v0;
      if (doWarp) {
        const wx = fractalSum(perlin2, u0 * freq * wfreq, v0 * freq * wfreq, seed ^ 0x31, woct, 2, 0.5, 'Standard', period);
        const wy = fractalSum(perlin2, u0 * freq * wfreq + 21.1, v0 * freq * wfreq - 9.4, seed ^ 0x32, woct, 2, 0.5, 'Standard', period);
        u += wx * wamp * 0.25;
        v += wy * wamp * 0.25;
      }
      const w = worley2(u * freq, v * freq, seed, { jitter, metric, morph: 0 });
      let out;
      switch (form) {
        case 'N': out = clamp01(w.f1); break;
        case 'R': out = clamp01((w.f2 - w.f1) * 1.5); break;
        case 'P': out = 1 / (1 + w.f1 * w.f1 * 6); break;
        case 'A': out = clamp01(w.f1 * w.f2 * 4); break;
        case 'S': out = clamp01(Math.pow(clamp01(w.f1), 1 + gain) * 1.3); break;
        case 'M': out = clamp01(Math.max(w.f1, w.f2) * 1.1); break;
        case 'D': out = clamp01(((w.id >>> 8) & 0xffff) / 65535 * (1 - clampV) + clampV * 0.5); break;
        case 'C': default: out = ((w.id >>> 12) & 0xff) / 255; break;
      }
      d[y * size + x] = clamp01(out);
    }
  }
  return f;
}

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
    // feature count grows with iteration; each layer keeps its own lattice
    const cells = Math.max(1, Math.round(2 * Math.pow(1.6, it)));
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
 * Crater — radial impact form with rim, floor and optional noise breakup.
 * Not a transcription of Gaea's crater generator (undocumented); this is a classical
 * impact-crater profile: raised rim + depressed floor + ejecta falloff.
 */
export function crater(ctx) {
  const { size, params, seed } = ctx;
  const style = P(params, 'Style', 'New');
  const scale = Math.max(1, P(params, 'Scale', 30));
  const formation = clamp01(P(params, 'Formation', 0.5));
  const height = P(params, 'Height', 1);
  const rimSharp = P(params, 'Rim', 'Soft') === 'Sharp';
  const shape = clamp01(P(params, 'Shape', 0.5));
  const cxp = P(params, 'X', 0);
  const cyp = P(params, 'Y', 0);

  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const radius = Math.max(0.02, (scale / 100) * 0.9);
  const cx = 0.5 + cxp * 0.01;
  const cy = 0.5 + cyp * 0.01;

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv - cy;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv - cx;
      const r = Math.sqrt(u * u + v * v) / radius;
      // rim: gaussian band at r=1, sharper when Rim=Sharp
      const rimW = rimSharp ? 0.10 : 0.30 + (1 - shape) * 0.2;
      const rim = Math.exp(-Math.pow((r - 1) / rimW, 2));
      // floor: bowl inside r<1, deepened by Formation
      const floor = r < 1 ? -Math.pow(1 - r * r, 1 + formation * 2) : 0;
      // ejecta: gentle outward ramp
      const ejecta = r > 1 ? Math.exp(-(r - 1) * (2.5 + shape * 3)) * (1 - formation) * 0.55 : 0;
      let out = floor * 0.9 + rim * (rimSharp ? 1 : 0.75) + ejecta;
      if (style === 'Classic') out = floor * 1.15 + rim * (rimSharp ? 1 : 0.6) + ejecta * 0.6;
      // small deterministic surface breakup so it does not look synthetic
      const brk = (value2(u * 14 + 5, v * 14 - 3, seed) - 0.5) * 0.06 * (1 - Math.min(1, r));
      d[y * size + x] = clamp01(0.5 + (out + brk) * 0.5 * height);
    }
  }
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
 * Canyon — drainage-based canyon primitive. "Classic" carves a meandering slot along a
 * warped ridge network; other styles add strata / erosion flavouring.
 */
export function canyon(ctx) {
  const { size, params, seed } = ctx;
  const style = P(params, 'Style', 'Classic');
  const scale = Math.max(1, P(params, 'Scale', 50));
  const slot = clamp01(P(params, 'Slot', 0.5));
  const valley = clamp01(P(params, 'Valley', 0.5));
  const surrounding = clamp01(P(params, 'Surrounding', 0.5));
  const depth = P(params, 'Depth', 1);
  const structWarp = clamp01(P(params, 'Structual Warp', 0.35));
  const detailWarp = clamp01(P(params, 'Detail Warp', 0.35));

  const freq = Math.max(0.5, (scale / 100) * 3.5);
  const period = Math.max(1, Math.round(freq));
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv - 0.5;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv - 0.5;
      // warped space -> meandering drainage
      const wx = fractalSum(perlin2, u * freq * 0.7, v * freq * 0.7, seed ^ 0x11, 4, 2, 0.5, 'Standard', period);
      const wy = fractalSum(perlin2, u * freq * 0.7 + 41.7, v * freq * 0.7 - 23.4, seed ^ 0x22, 4, 2, 0.5, 'Standard', period);
      const mu = u + wx * structWarp * 0.22 + fractalSum(perlin2, u * freq * 4, v * freq * 4, seed ^ 0x33, 3, 2, 0.5, 'Standard', period) * detailWarp * 0.04;
      const mv = v + wy * structWarp * 0.22 + fractalSum(perlin2, u * freq * 4 + 9, v * freq * 4 - 5, seed ^ 0x44, 3, 2, 0.5, 'Standard', period) * detailWarp * 0.04;

      // ridge network: distance to a warped Voronoi edge set
      const w = worley2(mu * freq, mv * freq, seed, { jitter: 0.9, metric: 'euclid', morph: 0 });
      const edge = clamp01((w.f2 - w.f1) * 1.3);
      // slot profile: narrow deep trench where edge is small
      const slit = Math.pow(1 - edge, 1 + (1 - slot) * 5);
      const plateau = fractalSum(perlin2, mu * freq * 0.6, mv * freq * 0.6, seed ^ 0x55, 5, 2, 0.55, 'Standard', period) * 0.5 + 0.5;
      const surroundH = (1 - surrounding) * 0.5 + surrounding * plateau;
      let h = surroundH * (1 - slit * (0.4 + depth * 0.6)) + slit * (1 - valley) * 0.15;
      if (style === 'Strata' || style === 'Both') {
        h += Math.sin(h * 30 + (1 - edge) * 6) * 0.025;
      }
      if (style === 'Eroded' || style === 'Eroded2' || style === 'Both') {
        const e = fractalSum(perlin2, mu * freq * 8, mv * freq * 8, seed ^ 0x66, 4, 2, 0.5, 'Standard', period);
        h += e * (style === 'Eroded2' ? 0.05 : 0.025) * (1 - slit * 0.6);
      }
      d[y * size + x] = clamp01(h);
    }
  }
  return f;
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
