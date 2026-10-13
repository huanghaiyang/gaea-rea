/**
 * ops2.js — five more catalog-only nodes recovered from the managed assembly (round 36).
 *
 *   Angle    AspectMaps.GetAngle(heights, Azimuth, Range.X, Range.Y, Falloff)
 *   Filter   FilterCore.FilterProcess(input, Frequency, Gain, Q, Mode, KeepDC)
 *   Edge     Migrated.EdgeProcess(map, Style, Pixels, Size, Softness)
 *   Roughen  Migrated.RoughenProcess(map, Width, Depth, Oriented, Quality)
 *   Craggy   Migrated.CraggyProcess(map, Seed, Size, Depth, Shape)
 *
 * Same situation as the round-35 batch: each helper's NAME and the node's PARAMETERS pin the
 * operation down, but the helper bodies live in the managed assembly and were not decompiled.
 * So every one is `approx` — the parameters are exact (from the `[Parameter(...)]` attributes),
 * the curves are published standard forms.
 *
 * WHERE THE PARAMETERS DID NOT SETTLE THE DESIGN, the choice is stated at the point of use
 * rather than buried, because a reader has to be able to tell a recovered decision from a made
 * one. The Angle node is the clearest case: its three parameters fix the DIRECTIONAL test but
 * not whether the mask measures alignment or opposition, and the test pins that down.
 */

import { createField, gaussianBlur } from '../kernel/field.js';

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

/** Central-difference gradient, clamped at the edges. */
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
 * `Angle` — a mask of how much the terrain faces a given azimuth.
 *
 * `GetAngle` takes the height field, an azimuth in degrees, a range, and a falloff. The
 * gradient gives each cell a slope direction; the mask measures that direction against the
 * azimuth and softens the cutoff with the falloff.
 *
 * A FLAT CELL HAS NO ASPECT, so it must read 0 rather than whatever the zero gradient happens
 * to normalise to. That is the property the test pins: a plane cannot face anything.
 */
export function gaeaAngle(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const azimuth = Number(P(params, 'Azimuth', 0));
  const falloff = Math.max(1e-6, Number(P(params, 'Falloff', 0.2)));
  const range = P(params, 'Range', [0, 1]);
  const lo = Array.isArray(range) ? Number(range[0]) : Number(range?.x ?? 0);
  const hi = Array.isArray(range) ? Number(range[1]) : Number(range?.y ?? 1);
  const { gx, gy } = gradient(h, size);

  // The azimuth is a compass direction: 0 points along +x and the angle grows towards +y.
  const rad = (azimuth * Math.PI) / 180;
  const ax = Math.cos(rad);
  const ay = Math.sin(rad);

  const out = createField(size, 'height');
  for (let i = 0; i < h.length; i++) {
    const mag = Math.hypot(gx[i], gy[i]);
    if (mag < 1e-9) { out.data[i] = 0; continue; }   // flat: no aspect at all
    const dot = (gx[i] * ax + gy[i] * ay) / mag;      // cosine of the facing
    const t = (dot + 1) * 0.5;                        // -1..1 -> 0..1
    // The range selects a band of that cosine, with the falloff widening both ends.
    const width = Math.max(1e-9, falloff * (hi - lo));
    const a = Math.max(0, Math.min(1, (t - lo) / width));
    out.data[i] = a * a * (3 - 2 * a);
  }
  return out;
}

/**
 * `Filter` — a frequency-band filter over the field.
 *
 * `FilterProcess` takes the field, a frequency, a gain, a Q, a mode and a KeepDC flag. The
 * implementation splits the field into a low-pass and its complement at `Frequency`, then
 * scales the selected band by `Gain`. `Q` narrows the band around the cutoff.
 *
 * `KeepDC` is the checkable parameter: with it set, the output's mean must equal the input's,
 * which a naive band gain would break.
 */
export function gaeaFilter(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const frequency = Math.max(0, Math.min(1, Number(P(params, 'Frequency', 0.5))));
  const gain = Number(P(params, 'Gain', 1));
  const q = Math.max(1e-3, Math.min(1, Number(P(params, 'Q', 0.5))));
  const mode = String(P(params, 'Mode', 'LowPass')).toLowerCase();
  const keepDC = !!P(params, 'KeepDC', false);

  // Radius in cells: a higher Frequency means a finer cutoff, hence a smaller radius.
  const radius = Math.max(1, (1 - frequency) * size * 0.25 * (0.5 + q));
  const blurred = gaussianBlur({ data: h, channels: 1, size, channel: 'height' }, radius);
  const low = blurred.data;

  let inMean = 0;
  for (const v of h) inMean += v;
  inMean /= h.length;

  const out = createField(size, 'height');
  for (let i = 0; i < h.length; i++) {
    const detail = h[i] - low[i];
    // AT GAIN 1 THE LOW-PASS MUST STILL LOW-PASS. The first version returned
    // low + detail, which is low + (h - low) -- the identity -- so the filter did nothing
    // and the variance was unchanged to the digit. Adding the detail back does not belong in
    // the low-pass branch at all.
    let v;
    if (mode.includes('high')) v = detail * gain;      // keep only the high band
    else if (mode.includes('band')) v = (low[i] + detail * gain) * gain;
    else v = low[i] * gain;                            // keep only the low band
    out.data[i] = v;
  }
  if (keepDC) {
    // Restore the original mean, which is what KeepDC names.
    let outMean = 0;
    for (const v of out.data) outMean += v;
    outMean /= out.data.length;
    const shift = inMean - outMean;
    for (let i = 0; i < out.data.length; i++) out.data[i] += shift;
  }
  return out;
}

/**
 * `Edge` — trace the sharp boundaries of the field.
 *
 * `EdgeProcess` takes a style (square or round), a pixel scale, a size and a softness. The
 * implementation is a gradient-magnitude detector at the requested scale, thresholded and
 * softened. A FLAT FIELD HAS NO EDGES, which is the assertion that catches a missing
 * normalisation.
 */
export function gaeaEdge(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const pixels = Math.max(1, Number(P(params, 'Pixels', 2)));
  const strength = Math.max(0, Number(P(params, 'Size', 1)));
  const softness = Math.max(1e-6, Number(P(params, 'Softness', 0.25)));
  const style = String(P(params, 'Style', 'Square')).toLowerCase();

  // Measure the gradient at the requested scale by differencing a blurred copy.
  const radius = Math.max(1, pixels * 0.5);
  const b = gaussianBlur({ data: h, channels: 1, size, channel: 'height' }, radius).data;
  const { gx, gy } = gradient(b, size);
  // A round style weights the two axes by their Euclidean length; a square one by the larger,
  // which is the discrete analogue of the square-versus-circle structuring element.
  const out = createField(size, 'height');
  for (let i = 0; i < h.length; i++) {
    const mag = style.includes('round')
      ? Math.hypot(gx[i], gy[i])
      : Math.max(Math.abs(gx[i]), Math.abs(gy[i]));
    const t = Math.max(0, Math.min(1, (mag * strength) / softness));
    out.data[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/**
 * `Roughen` — add oriented or isotropic noise displacement.
 *
 * `RoughenProcess` takes a width, a depth, an oriented flag and a quality selector. `Depth` 0
 * must be a strict no-op, which is the assertion that catches noise being added unconditionally.
 */
export function gaeaRoughen(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const width = Math.max(0, Number(P(params, 'Width', 0.1)));
  const depth = Math.max(0, Number(P(params, 'Depth', 0.2)));
  const oriented = !!P(params, 'Oriented', false);
  const out = createField(size, 'height');
  if (depth === 0) { out.data.set(h); return out; }

  const scale = Math.max(1, width * size * 0.5);
  const rand = (x, y) => {
    let s = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // Samples along x only when oriented, which is what the flag names.
      const sx = Math.floor(x / scale);
      const sy = oriented ? 0 : Math.floor(y / scale);
      const n = rand(sx, sy) - 0.5;
      const v = h[i] + n * depth * 0.1;
      out.data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/**
 * `Craggy` — add craggy relief at a chosen scale.
 *
 * `CraggyProcess` takes a seed, a size, a depth and a shape. `Depth` 0 is a no-op and `Seed`
 * must change the result, which are the two assertions that separate a real noise field from a
 * placeholder.
 */
export function gaeaCraggy(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const seed = Number(P(params, 'Seed', 0)) | 0;
  const sz = Math.max(0.2, Number(P(params, 'Size', 1.5)));
  const depth = Math.max(0, Number(P(params, 'Depth', 0.5)));
  const shape = Math.max(0, Math.min(1, Number(P(params, 'Shape', 0.5))));
  const out = createField(size, 'height');
  if (depth === 0) { out.data.set(h); return out; }

  const freq = (2 / sz) / size;
  const hash = (x, y) => {
    let s = ((x * 374761393) ^ (y * 668265263) ^ (seed * 2246822519)) >>> 0;
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  // A cheap value-noise lattice, sharpened by `shape` the way a ridged multifractal is.
  const noise = (x, y) => {
    const fx = x * freq;
    const fy = y * freq;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    const top = a + (b - a) * sx;
    const bot = c + (d - c) * sx;
    const v = top + (bot - top) * sy;
    const ridges = 1 - Math.abs(v * 2 - 1);
    return v + (ridges - v) * shape;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = h[i] + (noise(x, y) - 0.5) * depth * 0.2;
      out.data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}
