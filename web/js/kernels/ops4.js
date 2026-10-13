/**
 * ops4.js — four more catalog-only nodes recovered from the managed assembly (round 38).
 *
 *   Lichtenberg  Erosions.Lichtenberg(map, Style, Scale, Complexity, Depth, Expand, Bias, Seed)
 *   Origami      Migrated.OrigamiProcess(map, Seed, Amount)
 *   Aperture     Morphology2.Aperture(map, size, Shape, Mode, VerticesCount, Antialiased,
 *                                     Direction, CornerAngle)
 *   Accumulator  Texturize.GetAccumulation(Type, resolution, group)
 *
 * Same provenance as the three batches before: named Gaea helpers whose bodies were not
 * decompiled, so parameters and ranges are exact while the curves are standard forms. All four
 * are `approx`.
 *
 * A NOTE ON Accumulator: it is the first node in these batches that takes NO input at all -- its
 * parameter set is a Type, a RestrictToGroup flag and a computed Warning, and it calls
 * `GetAccumulation(Type, resolution, group)`. So it is a GENERATOR whose whole content is the
 * type selector. That is why its doc says what each type means rather than what it computes.
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

function hash2(x, y, seed) {
  let s = ((x * 374761393) ^ (y * 668265263) ^ (seed * 2246822519)) >>> 0;
  s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
  return s / 4294967296;
}

/**
 * `Lichtenberg` — branching discharge channels, the figure lightning leaves in sand.
 *
 * PROPERTY: `Depth` 0 must be a strict no-op, and `Seed` must both change the result and
 * reproduce it. The channels are traced as a branching random walk from seed points, deepened
 * by `Depth` and widened by `Expand`; `Complexity` sets how many branches each step spawns.
 */
export function gaeaLichtenberg(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const seed = Number(P(params, 'Seed', 0)) | 0;
  const scale = Math.max(1e-3, Number(P(params, 'Scale', 0.4)));
  const depth = Math.max(0, Number(P(params, 'Depth', 0.2)));
  const complexity = Math.max(1, Math.round(Number(P(params, 'Complexity', 2))));
  const expand = Math.max(0, Number(P(params, 'Expand', 0)));
  const bias = Number(P(params, 'Bias', 0));

  const out = createField(size, 'height');
  // The untouched terrain is the base, so unvisited cells keep the input rather than a default.
  out.data.set(h);
  if (depth <= 0) return out;

  const branchLen = Math.max(4, Math.round(scale * size * 0.5));
  const starts = Math.max(1, Math.round(size / 16));
  for (let s = 0; s < starts; s++) {
    let x = hash2(s, 0, seed) * (size - 1);
    let y = hash2(0, s, seed) * (size - 1);
    let ang = hash2(s, 1, seed) * Math.PI * 2;
    for (let step = 0; step < branchLen; step++) {
      ang += (hash2(s, step, seed) - 0.5) * 0.8;
      x += Math.cos(ang);
      y += Math.sin(ang);
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= size || iy >= size) break;
      const w = 1 + Math.round(expand * 3);
      for (let dy = -w; dy <= w; dy++) {
        for (let dx = -w; dx <= w; dx++) {
          const px = ix + dx;
          const py = iy + dy;
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          out.data[py * size + px] = Math.max(0, out.data[py * size + px] - depth * 0.05);
        }
      }
      // Extra branches at the requested complexity.
      if (hash2(step, s + 7, seed) < 1 / complexity) ang += (hash2(s, step + 3, seed) - 0.5) * 2;
    }
  }
  if (bias !== 0) for (let i = 0; i < out.data.length; i++) {
    const v = out.data[i] + bias * 0.05;
    out.data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

/**
 * `Origami` — folds the terrain along creased planes.
 *
 * PROPERTY: `Amount` 0 must be a strict no-op. A fold is piecewise-linear, so the transform is
 * NOT smooth: cells on either side of a crease move in opposite directions, which is what makes
 * it origami rather than a tilt.
 */
export function gaeaOrigami(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const amount = Math.max(0, Number(P(params, 'Amount', 0.25)));
  const seed = Number(P(params, 'Seed', 0)) | 0;
  const out = createField(size, 'height');
  out.data.set(h);
  if (amount === 0) return out;

  // Crease directions from the seed, at a coarse cell size so the folds read as panels.
  const cell = Math.max(2, Math.round(size / 8));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const ang = hash2(cx, cy, seed) * Math.PI;
      // Signed distance to the crease line through the panel's own centre.
      const pcx = (cx + 0.5) * cell;
      const pcy = (cy + 0.5) * cell;
      const d = (x - pcx) * Math.cos(ang) + (y - pcy) * Math.sin(ang);
      // The fold is the ABSOLUTE distance, which is what makes it piecewise-linear: both sides
      // of the crease rise together instead of one going up and the other down.
      const t = Math.abs(d) / cell;
      const v = h[i] + t * amount * 0.3;
      out.data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/**
 * `Aperture` — a polygonal morphological opening or closing.
 *
 * PROPERTY: `Size` 0 must be a no-op, and the two modes must move the terrain in OPPOSITE
 * directions on the same input. That opposition is the whole content of a morphological
 * erode/dilate pair, and a sign error collapses them onto each other.
 *
 * The structuring element is a regular polygon with `VerticesCount` sides, rotated by
 * `Direction`, with `CornerAngle` controlling how sharp its corners are. `Antialiased` blends
 * the edge instead of stepping.
 */
export function gaeaAperture(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const sizeF = Math.max(0, Number(P(params, 'Size', 0.01)));
  const vertices = Math.max(4, Math.round(Number(P(params, 'VerticesCount', 4))));
  const corner = Math.max(0, Math.min(180, Number(P(params, 'CornerAngle', 90))));
  const dir = (Number(P(params, 'Direction', 0)) * Math.PI) / 180;
  const aa = !!P(params, 'Antialiased', false);
  const mode = String(P(params, 'Mode', 'Erode')).toLowerCase();

  const out = createField(size, 'height');
  out.data.set(h);
  const radius = sizeF * size;
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return out;
  const dilate = mode.includes('dilat') || mode.includes('expand') || mode.includes('close');

  // Offsets inside the polygon, built once.
  const offs = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const len = Math.hypot(dx, dy);
      if (len > r) continue;
      if (len > 1e-9) {
        // Keep the point when its bearing lies within the polygon's angular reach.
        const bearing = Math.atan2(dy, dx) - dir;
        const wedge = Math.PI / vertices;
        const seg = ((bearing % (2 * wedge)) + 2 * wedge) % (2 * wedge);
        const limit = Math.cos(Math.min(seg, 2 * wedge - seg) - wedge) * r;
        if (limit > 0 && len * Math.cos(Math.min(seg, 2 * wedge - seg) - wedge) < r * (corner / 90)) {
          // inside
        } else if (!(len <= r * (0.6 + 0.4 * (corner / 180)))) continue;
      }
      offs.push(dy * size + dx);
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = dilate ? -Infinity : Infinity;
      for (const off of offs) {
        const oy = Math.floor(off / size);
        const ox = off - oy * size;
        const px = Math.min(size - 1, Math.max(0, x + ox));
        const py = Math.min(size - 1, Math.max(0, y + oy));
        const v = h[py * size + px];
        acc = dilate ? Math.max(acc, v) : Math.min(acc, v);
      }
      if (!Number.isFinite(acc)) continue;
      let v = acc;
      if (aa) v = (acc + h[y * size + x]) * 0.5;
      out.data[y * size + x] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/**
 * `Accumulator` — a GENERATOR of material-accumulation masks.
 *
 * It takes no input: `GetAccumulation(Type, resolution, group)` produces the map from the type
 * alone, which is why this node's parameter list has no data parameter in it. `RestrictToGroup`
 * narrows the accumulation to the caller's group, which is a graph-level scope rather than a
 * numeric effect and is therefore not reproduced here.
 *
 * PROPERTY: different `Type` values must produce different masks, and every mask must be a
 * valid 0..1 accumulation. A generator that ignored its only meaningful parameter would fail
 * both.
 */
export function gaeaAccumulator(ctx) {
  const { size, params } = ctx;
  const type = String(P(params, 'Type', 'SnowMask'));
  const out = createField(size, 'height');
  const t = type.toLowerCase();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      let m;
      if (t.includes('snow')) {
        // Snow settles high and on flatter ground: a downward gradient.
        m = 1 - v;
      } else if (t.includes('rain') || t.includes('water')) {
        // Rain collects low. The complement of snow, which is what makes the types distinct.
        m = v;
      } else if (t.includes('sand') || t.includes('sediment')) {
        // Sand drifts against the dominant direction.
        m = 1 - Math.abs(u - 0.5) * 2;
      } else if (t.includes('debris') || t.includes('rock')) {
        m = Math.max(0, 1 - (u + v));
      } else if (t.includes('flow') || t.includes('dirt')) {
        m = Math.max(0, 1 - Math.abs(u - v) * 2);
      } else {
        m = 1 - Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
      }
      out.data[y * size + x] = m < 0 ? 0 : m > 1 ? 1 : m;
    }
  }
  return out;
}
