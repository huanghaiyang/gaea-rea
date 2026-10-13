/**
 * ops.js — five small catalog-only nodes recovered from the managed assembly.
 *
 * These were picked from `docs/node-worklist.json`, which ranks catalog-only nodes by the cost
 * of their `Build()` body. All five call a named Gaea helper whose semantics are fixed by the
 * node's own parameters, which is what makes them recoverable without reading the helper:
 *
 *   Threshold   AspectMaps.GetThreshold(map, Level)
 *   SoftClip    <helper>(map, resolutionX, ClipMode == AboveThreshold, Threshold, Softness, Clipping)
 *   Terraces    Profiles.Terrace(map, NumTerraces, Uniformity, Steepness, Intensity, Seed, flag)
 *   Pixelate    Others.PixelateHeightfield(map, <scale>(Size), Antialias)
 *   Curvature   AspectMaps.GetCurvature(map, Range.X, Range.Y, Falloff, Type)
 *
 * The parameter defaults and ranges come from the `[Parameter(...)]` attributes, which are what
 * the runtime reads and which the audit in round 22 confirmed against the catalogue.
 *
 * FIDELITY: all five are `approx`. The SHAPE of each operation is fixed by its parameters and
 * its name, but the helper bodies live in the managed assembly and were not decompiled, so the
 * exact easing curves — the soft clip's falloff, the terrace profile's blend, the curvature
 * normalisation — are standard-published forms rather than transcriptions. Where a node's
 * behaviour is fully determined by its parameters (Threshold, Pixelate) the label is still
 * `approx` because the clamp and rounding conventions are not read.
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

/**
 * `Threshold` — a binary split at `Level`.
 *
 * `GetThreshold` takes only the map and the level, so the operation is fully determined: cells
 * at or above the level become 1, the rest 0. Rendered as a mask, per `RenderAsMask` in the
 * managed code path.
 *
 * The comparison is `>=` rather than `>`: with the default level of 0.5 a field that is exactly
 * half lit should not come out entirely dark, and a strict test is the one that would do that.
 */
export function gaeaThreshold(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const level = Number(P(params, 'Level', 0.5));
  const out = createField(size, 'height');
  for (let i = 0; i < h.length; i++) out.data[i] = h[i] >= level ? 1 : 0;
  return out;
}

/**
 * `SoftClip` — clamp the field toward a threshold with a soft knee.
 *
 * The parameters fix the operation completely: a mode selecting which side is clipped, the
 * threshold, a softness width, and a clipping strength. `Softness` of 0 degenerates to a hard
 * clip, which is the property to check — a soft clip that stayed soft at zero would be using
 * the wrong easing.
 *
 * The knee is a smoothstep over `[Threshold - Softness, Threshold + Softness]`, which is the
 * standard form and is why the label is `approx`: the helper's own easing was not read.
 */
export function gaeaSoftClip(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const threshold = Number(P(params, 'Threshold', 0.5));
  const softness = Math.max(0, Number(P(params, 'Softness', 0.1)));
  const clipping = Math.max(0, Math.min(1, Number(P(params, 'Clipping', 1))));
  // ClipMode default is AboveThreshold: values above the threshold are the ones pulled down.
  const mode = P(params, 'ClipMode', 'AboveThreshold');
  const above = String(mode).toLowerCase().includes('above');

  const out = createField(size, 'height');
  for (let i = 0; i < h.length; i++) {
    const v = h[i];
    const d = above ? v - threshold : threshold - v;
    let k;
    if (softness <= 0) k = d > 0 ? 1 : 0;
    else {
      const t = Math.max(0, Math.min(1, (d + softness) / (2 * softness)));
      k = t * t * (3 - 2 * t);              // smoothstep
    }
    const pulled = v - (above ? d : -d) * k * clipping;
    out.data[i] = pulled < 0 ? 0 : pulled > 1 ? 1 : pulled;
  }
  return out;
}

/**
 * `Terraces` — quantise the field into `NumTerraces` bands.
 *
 * `Uniformity` trades evenly spaced steps against ones derived from the field's own
 * distribution; `Steepness` sharpens each terrace's edge; `Intensity` blends the result back
 * against the input. `Seed` drives the jitter `Uniformity` introduces.
 */
export function gaeaTerraces(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const n = Math.max(2, Math.round(Number(P(params, 'NumTerraces', 10))));
  const uniformity = Math.max(0, Math.min(1, Number(P(params, 'Uniformity', 0.6))));
  const steepness = Math.max(0, Math.min(1, Number(P(params, 'Steepness', 0.2))));
  const intensity = Math.max(0, Math.min(1, Number(P(params, 'Intensity', 1))));
  const seed = Number(P(params, 'Seed', 0)) | 0;

  // A small deterministic jitter, scaled by how uniform the caller wants the steps.
  const rand = (i) => {
    let s = (seed + i * 2654435761) >>> 0;
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };

  const out = createField(size, 'height');
  for (let i = 0; i < h.length; i++) {
    const v = Math.max(0, Math.min(1, h[i]));
    const jitter = (rand(i) - 0.5) * (1 - uniformity) * (1 / n);
    const t = Math.max(0, Math.min(1, v + jitter));
    // THE QUANTISATION MUST SURVIVE steepness = 0. The first version added the sharpened
    // fraction to the floored band, which with ex = 1 collapses to `t` exactly -- the identity,
    // so the node produced 256 distinct values on a 256-step ramp instead of `n` bands. The
    // exponent belongs on the INPUT curve, ahead of the floor, so the step edges sharpen while
    // the steps themselves remain steps.
    const shaped = steepness <= 0 ? t : Math.pow(t, 1 / (1 + steepness * 3));
    const terraced = Math.floor(shaped * n) / n;
    out.data[i] = v + (terraced - v) * intensity;
  }
  return out;
}

/**
 * `Pixelate` — block-average the field to a coarser cell grid, then expand.
 *
 * `Size` is the block size as a fraction of the grid. `Autosize` replaces it with a fixed
 * scale. `Antialias` controls whether the block edges are blended or left hard; a hard edge is
 * what makes a pixelated heightfield look blocky, so the flag is what a test can pin.
 */
export function gaeaPixelate(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  // Autosize substitutes its own constant, so Size is ignored when it is set.
  const autosize = !!P(params, 'Autosize', false);
  const sizeFrac = autosize ? 0.02 : Math.max(0, Number(P(params, 'Size', 0.15)));
  const antialias = !!P(params, 'Antialias', true);
  const block = Math.max(1, Math.round(sizeFrac * size));

  const out = createField(size, 'height');
  const bw = Math.ceil(size / block);
  const blocks = new Float32Array(bw * bw);
  for (let by = 0; by < bw; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      let count = 0;
      for (let y = by * block; y < Math.min(size, (by + 1) * block); y++) {
        for (let x = bx * block; x < Math.min(size, (bx + 1) * block); x++) {
          sum += h[y * size + x];
          count++;
        }
      }
      blocks[by * bw + bx] = count ? sum / count : 0;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!antialias) {
        // Hard blocks: every cell takes its block's mean, so the edges stay square.
        out.data[y * size + x] = blocks[Math.floor(y / block) * bw + Math.floor(x / block)];
      } else {
        // Bilinear blend across block centres, which softens the steps.
        const fx = (x + 0.5) / block - 0.5;
        const fy = (y + 0.5) / block - 0.5;
        const x0 = Math.max(0, Math.min(bw - 1, Math.floor(fx)));
        const y0 = Math.max(0, Math.min(bw - 1, Math.floor(fy)));
        const x1 = Math.max(0, Math.min(bw - 1, x0 + 1));
        const y1 = Math.max(0, Math.min(bw - 1, y0 + 1));
        const tx = Math.max(0, Math.min(1, fx - x0));
        const ty = Math.max(0, Math.min(1, fy - y0));
        const top = blocks[y0 * bw + x0] + (blocks[y0 * bw + x1] - blocks[y0 * bw + x0]) * tx;
        const bot = blocks[y1 * bw + x0] + (blocks[y1 * bw + x1] - blocks[y1 * bw + x0]) * tx;
        out.data[y * size + x] = top + (bot - top) * ty;
      }
    }
  }
  return out;
}

/**
 * `Curvature` — how much the field bends, as a mask in `Range`.
 *
 * `GetCurvature` takes the map, a range, a falloff and a type selector. The curvature is the
 * discrete Laplacian — a cell's value against its neighbours' mean — and the range selects
 * which magnitudes survive, with `Falloff` softening the cutoff.
 *
 * Rendered as a mask, so the output is 0..1 rather than a height.
 */
export function gaeaCurvature(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const h = readScalar(src, size);
  const range = P(params, 'Range', [0, 1]);
  const falloff = Math.max(1e-6, Number(P(params, 'Falloff', 0.2)));
  const lo = Array.isArray(range) ? Number(range[0]) : Number(range?.x ?? 0);
  const hi = Array.isArray(range) ? Number(range[1]) : Number(range?.y ?? 1);
  const type = P(params, 'Type', 'Convex');

  const out = createField(size, 'height');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cl = (v, m) => (v < 0 ? 0 : v > m - 1 ? m - 1 : v);
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          sum += h[cl(y + dy, size) * size + cl(x + dx, size)];
        }
      }
      const lap = sum / 8 - h[y * size + x];
      // THE SELECTOR MUST PICK A SIGN, NOT A NEGATION. The first version negated `lap` for the
      // concave case and then took the absolute value, which cancels -- both types returned the
      // same mask. Convex lights cells where the Laplacian is positive (a peak above its
      // neighbours) and Concave lights where it is negative (a pit), so the negative branch must
      // be CLAMPED to zero, not folded.
      // THE SIGN, settled by measurement. Under lap = neighbourMean - centre a RAISED cell has
      // NEGATIVE lap, because its neighbours average below it -- the opposite of the continuous
      // convention. The first version of this branch lit PITS for the convex case, which the test
      // caught as a ridge reading 0. Convex is therefore -lap and concave is +lap.
      const concave = String(type).toLowerCase().includes('concave');
      const m = concave ? Math.max(0, lap) : Math.max(0, -lap);
      // THE WINDOW MUST BE ZERO AT ZERO CURVATURE. The first version centred a smoothstep on
      // `lo`, so a plane -- curvature exactly 0 with the default Range starting at 0 -- came out
      // at 0.5, i.e. half-lit everywhere. A ramp that rises FROM `lo` over `falloff` and reaches
      // 1 at `hi` is what makes flat ground read as flat.
      const width = Math.max(1e-9, falloff * (hi - lo));
      const a = Math.max(0, Math.min(1, (m - lo) / width));
      out.data[y * size + x] = a * a * (3 - 2 * a);
    }
  }
  return out;
}
