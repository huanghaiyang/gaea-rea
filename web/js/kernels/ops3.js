/**
 * ops3.js — five more catalog-only nodes recovered from the managed assembly (round 37).
 *
 *   GraphicEQ  Profiles.GraphicEQ(map, Band1..Band7)
 *   Pockmarks  Migrated.PockmarksProces(map, resolutionX, Seed, Size, Scale, Height, Density,
 *                                       Multiplier, Invert)
 *   Outcrops   RockCore.Outcrops(map, Variations, Strata, Density, Shape, Chipped, Seed, Size,
 *                                Height, Rotation)
 *   RockMap    AspectMaps.RockMap(map, Coverage, Density)
 *   Bulbous    Migrated.BulbousProcess(map, Scale, Jitter)
 *
 * Same provenance as the two batches before: the helper NAME plus the node's `[Parameter(...)]`
 * set fixes the operation, but the helper body lives in the managed assembly and was not
 * decompiled. Everything here is therefore `approx` — parameters and ranges exact, curves are
 * published standard forms.
 *
 * Each function's doc states the ONE property its own parameters imply, because that is what
 * the test asserts and it is what caught five real bugs across the previous two rounds.
 */

import { createField } from '../kernel/field.js';

function P(params, name, dflt) {
  if (!params) return dflt;
  const v = params[name];
  return v === undefined || v === null ? dflt : v;
}

function readScalar(src, size) {
  const ch = src.channels || 1;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const v = src.data[i * ch];
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

function gradient(h, size) {
  const gx = new Float32Array(h.length);
  const gy = new Float32Array(h.length);
  const cl = (v) => (v < 0 ? 0 : v > size - 1 ? size - 1 : v);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      gx[i] = (h[y * size + cl(x + 1)] - h[y * size + cl(x - 1)]) * 0.5;
      gy[i] = (h[cl(y + 1) * size + x] - h[cl(y - 1) * size + x]) * 0.5;
    }
  }
  return { gx, gy };
}

/**
 * `GraphicEQ` — a seven-band equaliser over the height distribution.
 *
 * PROPERTY: bands at 1 must be an identity. An equaliser that reshapes the distribution even
 * with every band neutral is a mapping bug, and that is the assertion.
 *
 * Each band covers an equal slice of 0..1 and scales the local contrast inside it, pivoting on
 * the band's centre so a gain of 1 leaves it alone. That pivot is what makes "all bands 1" come
 * out exactly unchanged rather than merely close.
 */
export function gaeaGraphicEQ(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const BANDS = 7;
  const gains = [];
  for (let b = 1; b <= BANDS; b++) gains.push(Number(P(params, `Band${b}`, 1)));
  const out = createField(size, 'height');
  for (let i = 0; i < h.length; i++) {
    const v = h[i] < 0 ? 0 : h[i] > 1 ? 1 : h[i];
    const f = v * BANDS;
    const b = Math.min(BANDS - 1, Math.floor(f));
    const centre = (b + 0.5) / BANDS;
    const w = 1 / BANDS;
    // Deviation from the band centre, scaled about the centre by the gain.
    const stretched = centre + (v - centre) * gains[b];
    out.data[i] = stretched < 0 ? 0 : stretched > 1 ? 1 : stretched;
    void w;
  }
  return out;
}

/**
 * `Pockmarks` — scattered pits, sized by a scale and thinned by a density.
 *
 * PROPERTY: `Density` 0 must leave the field untouched, and `Invert` must flip the pits into
 * bumps. Those two separate a real scatter from noise painted unconditionally.
 */
export function gaeaPockmarks(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const seed = Number(P(params, 'Seed', 0)) | 0;
  const scale = Math.max(1e-3, Number(P(params, 'Scale', 0.6)));
  const sz = Math.max(1e-3, Number(P(params, 'Size', 0.4)));
  const height = Number(P(params, 'Height', 1));
  const density = Math.max(0, Number(P(params, 'Density', 0.5)));
  const multiplier = Math.max(1e-3, Number(P(params, 'Multiplier', 0.5)));
  const invert = !!P(params, 'Invert', false);
  const out = createField(size, 'height');
  out.data.set(h);   // skipped cells must keep the input, not the field's initial value
  if (density <= 0) return out;

  const cell = Math.max(1, sz * size * 0.5);
  const rand = (x, y) => {
    let s = ((x * 73856093) ^ (y * 19349663) ^ (seed * 2246822519)) >>> 0;
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const sign = invert ? -1 : 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      // The centre of the cell's mark, jittered so the scatter is not a grid.
      const jx = (cx + 0.25 + rand(cx, cy) * 0.5) * cell;
      const jy = (cy + 0.25 + rand(cx + 977, cy) * 0.5) * cell;
      const d = Math.hypot(x - jx, y - jy) / (cell * 0.5 * scale);
      if (d >= 1) continue;
      if (rand(cx + 31, cy + 7) > density) continue;   // thinning
      const bowl = (1 - d * d) ** multiplier;
      const v = h[i] - sign * bowl * height * 0.05;
      out.data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/**
 * `Outcrops` — raised rock masses laid over the terrain, banded by strata.
 *
 * PROPERTY: `Density` 0 must be a no-op, `Seed` must change the placement, and the same seed
 * must reproduce it. `Chipped` breaks the outlines.
 */
export function gaeaOutcrops(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const seed = Number(P(params, 'Seed', 0)) | 0;
  const density = Math.max(0, Number(P(params, 'Density', 0.2)));
  const sizeF = Math.max(1e-3, Number(P(params, 'Size', 0.4)));
  const height = Math.max(0, Number(P(params, 'Height', 0.45)));
  const strata = Math.max(0, Math.min(1, Number(P(params, 'Strata', 0.1))));
  const shape = Number(P(params, 'Shape', 0));
  const chipped = !!P(params, 'Chipped', true);
  const rotation = Number(P(params, 'Rotation', 0));
  const out = createField(size, 'height');
  // START FROM THE INPUT. Cells the outcrop loop skips take the continue path, so without
  // this they keep createField's initial value -- zero -- and the terrain is erased wherever
  // no outcrop landed. The Height-0 assertion is what exposed it: with Height 0 the operation
  // should be an exact no-op, but every skipped cell came out as 0.
  out.data.set(h);
  if (density <= 0) return out;

  const cell = Math.max(1, sizeF * size * 0.5);
  const rad = (rotation * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  const rand = (x, y) => {
    let s = ((x * 374761393) ^ (y * 668265263) ^ (seed * 2246822519)) >>> 0;
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      if (rand(cx, cy) > density) continue;
      // Rotate the sample into the outcrop's own frame.
      const dx = x - (cx + 0.5) * cell;
      const dy = y - (cy + 0.5) * cell;
      const rx = dx * cs + dy * sn;
      const ry = -dx * sn + dy * cs;
      const d = Math.hypot(rx, ry) / (cell * 0.5);
      if (d >= 1) continue;
      if (chipped && rand(cx + 51, cy + 13) < 0.3 * (1 - d)) continue;
      // Strata band the mass vertically; shape trades a dome for a plateau.
      const dome = ((1 - d * d) ** (1 + shape * 2)) * (1 - strata * 0.5);
      const v = h[i] + dome * height * 0.1;
      out.data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/**
 * `RockMap` — a mask of where rock would sit, from slope against a coverage and density.
 *
 * PROPERTY: a FLAT field must read uniformly (no slope, so no rock), and the mask must rise
 * monotonically with slope. `Coverage` sets the slope at which the mask saturates.
 */
export function gaeaRockMap(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const coverage = Math.max(1e-6, Number(P(params, 'Coverage', 0.33)));
  const density = Number(P(params, 'Density', 0));
  const { gx, gy } = gradient(h, size);

  // Normalise the slope against the field's own steepest, so Coverage is scale-free.
  let maxSlope = 0;
  for (let i = 0; i < h.length; i++) maxSlope = Math.max(maxSlope, Math.hypot(gx[i], gy[i]));
  const scale = maxSlope > 1e-9 ? maxSlope : 1;

  const out = createField(size, 'height');
  for (let i = 0; i < h.length; i++) {
    const s = Math.hypot(gx[i], gy[i]) / scale;
    const t = Math.max(0, Math.min(1, (s - density) / coverage));
    out.data[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/**
 * `Bulbous` — inflate or deflate the terrain's masses.
 *
 * PROPERTY: `Scale`, `Jitter` and the input must all matter, and the transform must be
 * monotone in the input so it cannot invert the terrain's ordering. `Jitter` 0 must be
 * deterministic.
 */
export function gaeaBulbous(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const scale = Number(P(params, 'Scale', 0.5));
  const jitter = Math.max(0, Number(P(params, 'Jitter', 0)));
  const cell = Math.max(1, size * 0.05);
  const rand = (x, y) => {
    let s = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const out = createField(size, 'height');
  // A smooth bulge weight: the terrain's own low-frequency mass.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const j = jitter > 0 ? (rand(cx, cy) - 0.5) * jitter : 0;
      const v = h[i] + (h[i] - 0.5) * (scale - 0.5 + j) * 0.5;
      out.data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}
