#!/usr/bin/env python3
"""Insert the Laplacian-pyramid multiscale erosion solver into erosion.js.

Kept as a script rather than a hand edit because the block is large and the file is
edited concurrently by nothing else, so a single verified insertion with a
parse check afterwards is safer than several tool round-trips.

Idempotent: skips if `hydraulicDropletMultiscale` is already present.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
TARGET = WS / "web" / "js" / "kernels" / "erosion.js"

ANCHOR = '/** Deposit with an optional wider footprint ("Coarse Sediments"). */'

BLOCK = r'''/* ------------------------------------------------- Laplacian pyramid (multiscale) */

/**
 * 2x2 box reduction. Averaging rather than decimation is what makes the pyramid
 * invertible: it removes exactly the high-frequency content the Laplacian stores.
 */
function downsample2(a, n) {
  const m = n >> 1;
  const out = new Float32Array(m * m);
  for (let y = 0; y < m; y++) {
    const r0 = (y * 2) * n;
    const r1 = r0 + n;
    const ro = y * m;
    for (let x = 0; x < m; x++) {
      const x0 = x * 2;
      out[ro + x] = (a[r0 + x0] + a[r0 + x0 + 1] + a[r1 + x0] + a[r1 + x0 + 1]) * 0.25;
    }
  }
  return out;
}

/** Bilinear expansion of an m x m level to n x n. */
function upsample2(a, m, n) {
  const out = new Float32Array(n * n);
  if (m === 1) { out.fill(a[0]); return out; }
  const sc = (m - 1) / (n - 1);
  for (let y = 0; y < n; y++) {
    const fy = y * sc;
    const y0 = Math.min(m - 1, Math.floor(fy));
    const y1 = Math.min(m - 1, y0 + 1);
    const ty = fy - y0;
    const r0 = y0 * m;
    const r1 = y1 * m;
    const ro = y * n;
    for (let x = 0; x < n; x++) {
      const fx = x * sc;
      const x0 = Math.min(m - 1, Math.floor(fx));
      const x1 = Math.min(m - 1, x0 + 1);
      const tx = fx - x0;
      const top = a[r0 + x0] + (a[r0 + x1] - a[r0 + x0]) * tx;
      const bot = a[r1 + x0] + (a[r1 + x1] - a[r1 + x0]) * tx;
      out[ro + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

/**
 * Decompose a height grid into a Gaussian pyramid plus its Laplacian bands.
 *
 * `fine[0]` is the input, `fine[k]` is the 2x2 reduction of `fine[k-1]`, and
 * `lap[k] = fine[k] - upsample(fine[k+1])` is the detail the reduction dropped.
 * Reconstruction is `fine[k] = upsample(fine[k+1]) + lap[k]`, which is exact, so a level
 * can be modified and re-expanded without losing the bands below it.
 *
 * @param {Float32Array} h
 * @param {number} size
 * @param {number} maxLevels
 * @returns {{fine: Float32Array[], sizes: number[], lap: Float32Array[]}}
 */
function buildPyramid(h, size, maxLevels) {
  const fine = [h];
  const sizes = [size];
  for (let k = 1; k < maxLevels; k++) {
    const pn = sizes[k - 1];
    if (pn < 16) break;                 // below this a level stops describing relief
    fine.push(downsample2(fine[k - 1], pn));
    sizes.push(pn >> 1);
  }
  const lap = [];
  for (let k = 0; k < fine.length - 1; k++) {
    const up = upsample2(fine[k + 1], sizes[k + 1], sizes[k]);
    const d = new Float32Array(sizes[k] * sizes[k]);
    const src = fine[k];
    for (let i = 0; i < d.length; i++) d[i] = src[i] - up[i];
    lap.push(d);
  }
  return { fine, sizes, lap };
}

/**
 * How many pyramid levels to use at a given resolution.
 *
 * The coarsest level stays near 32 cells. Below that a droplet step spans so much
 * ground that the level stops describing measurable relief. Derived rather than exposed
 * as a node parameter, because Gaea's Erosion2 does not expose one either: its
 * `LaplacianLevel` is an internal enum.
 */
export function pyramidLevelsFor(size) {
  if (size < 32) return 1;
  let levels = 1;
  let s = size;
  while (s >= 64 && levels < 6) { s >>= 1; levels++; }
  return levels;
}

/**
 * Shared post-shaping: valley sharpening plus detail emphasis, driven by Shape, Shape
 * Sharpness and Shape Detail Scale. Operates in metres.
 */
function applyShaping(h, size, shape, shapeSharp, shapeDetail) {
  let out = h;
  if (shape > 0) {
    const s = stats({ data: h, channels: 1, size });
    const span = s.max - s.min;
    if (span > 1e-9) {
      const k = 1 + shapeSharp * 3;
      out = new Float32Array(h.length);
      for (let i = 0; i < h.length; i++) {
        const t = clamp01((h[i] - s.min) / span);
        out[i] = (Math.pow(t, k) * shape + t * (1 - shape)) * span + s.min;
      }
    }
  }
  if (shapeDetail > 0 && shapeDetail !== 0.5) {
    const blurred = gaussianBlur(
      { data: out, channels: 1, size, channel: 'height' },
      Math.max(1, shapeDetail * size * 0.02),
    );
    const d = 1 + (0.5 - shapeDetail) * 0.8;
    for (let i = 0; i < out.length; i++) out[i] += (out[i] - blurred.data[i]) * d;
  }
  return out;
}

/** metres -> normalized height field */
function metresToField(h, size) {
  const final = createField(size, 'height');
  for (let i = 0; i < h.length; i++) final.data[i] = h[i] / TERRAIN_HEIGHT_M;
  return final;
}

/** input field -> metres, with a NaN guard */
function fieldToMetres(src, size) {
  const h = new Float32Array(size * size);
  const stride = src.channels;
  for (let i = 0; i < h.length; i++) {
    const v = src.data[i * stride];
    h[i] = (Number.isFinite(v) ? v : 0) * TERRAIN_HEIGHT_M;
  }
  return h;
}

/**
 * Multiscale particle erosion — the model behind Gaea's Erosion2 / EasyErosion.
 *
 * Gaea's `ParallelErosion` runs droplets through `flow(...)` on a `LaplacianLevel`
 * pyramid (`erode_level`, `reconstruct_previous_level`). This reproduces that structure:
 *
 *   1. Decompose the height field into a Laplacian pyramid.
 *   2. Erode the COARSEST level first. One droplet step there spans many fine cells, so
 *      droplets travel a long way in terrain terms and carve long, connected valleys —
 *      which a single-scale solver cannot do, because its droplets die after a few dozen
 *      cells and only manage short scratches.
 *   3. Walk finer: rebuild each level from the ERODED coarser level plus its own stored
 *      Laplacian band, then erode it. Detail comes back, and each level refines the
 *      drainage instead of inventing new large-scale structure.
 *
 * Droplet density falls towards the fine levels (0.3 at the finest, 1.0 at the coarsest)
 * because the coarse levels have already established the network and the fine levels only
 * add texture. That also keeps total cost near the single-scale solver's despite visiting
 * every level.
 *
 * Still labelled `model`, not `exact`: the pyramid structure and coarse-to-fine ordering
 * follow Gaea, but the per-level droplet arithmetic is the published Hansson formulation,
 * not a transcription of Gaea's SYCL kernels, which are compiled native code and were not
 * decompiled.
 */
export function hydraulicDropletMultiscale(ctx) {
  const { size, params, input, seed } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height', 0.5);

  const duration = Math.max(0, P(params, 'Duration', 0.5));
  const downcutting = clamp01(P(params, 'Downcutting', 0.5));
  const erosionScale = clamp01(P(params, 'Erosion Scale', 0.5));
  const noErosion = !!P(params, 'NoErosion', false);
  const suspended = clamp01(P(params, 'Suspended Load', 0.5));
  const bedLoad = clamp01(P(params, 'Bed Load', 0.35));
  const coarse = clamp01(P(params, 'Coarse Sediments', 0.35));
  const depBoost = P(params, 'DepositionBoost', 0);
  const extraBoost = P(params, 'ExtraDepositionBoost', 0);
  const shape = clamp01(P(params, 'Shape', 0.4));
  const shapeSharp = clamp01(P(params, 'Shape Sharpness', 0.4));
  const shapeDetail = clamp01(P(params, 'Shape Detail Scale', 0.5));
  const enable = P(params, 'Enable', true);

  const h = fieldToMetres(src, size);
  if (!enable || noErosion || duration <= 0) return metresToField(h, size);

  const rng = makeRng(seed);
  const levels = pyramidLevelsFor(size);
  const { fine, sizes, lap } = buildPyramid(h, size, levels);

  const inertia = 0.05;
  const capacityFactor = 1.0 + suspended * 4.0;
  const minCapacity = 0.01;
  const erodeRate = 0.1 + downcutting * 0.6;
  const depositRate = 0.08 + bedLoad * 0.55;
  const evaporate = 0.01 + (1 - suspended) * 0.02;
  const gravity = 1.4;
  const maxDepositPerStep = TERRAIN_HEIGHT_M * 0.004;
  const erosionRadius = Math.max(1, Math.min(4, Math.round(1 + erosionScale * 3)));
  const depositRadius = coarse < 0.34 ? 0 : coarse < 0.67 ? 1 : 2;
  const brush = makeBrush(erosionRadius);

  const last = fine.length - 1;
  for (let k = last; k >= 0; k--) {
    const n = sizes[k];
    const weight = last === 0 ? 1 : 0.3 + 0.7 * (k / last);
    const droplets = Math.max(
      400,
      Math.min(2_000_000, Math.round(duration * 0.8 * n * n * weight)),
    );
    // A droplet must be able to cross a good part of its own level, because at the
    // coarsest scale that reach IS the feature. The single-scale bound (0.35*size) was
    // deliberately short to keep channels crisp; here it would forbid long valleys.
    const maxSteps = Math.max(20, Math.min(220, Math.round(n * 0.7)));

    erodeLevel(fine[k], n, {
      droplets, maxSteps, inertia, capacityFactor, minCapacity,
      erodeRate, depositRate, evaporate, gravity, maxDepositPerStep,
      brushOffsets: brush.offsets, brushSum: brush.sum, depositRadius, depBoost, extraBoost,
    }, rng);

    if (k > 0) {
      // Reconstruct the next finer level from the ERODED coarser one plus its stored
      // detail band. This is what carries coarse drainage down to fine resolution.
      const dst = fine[k - 1];
      const up = upsample2(fine[k], n, sizes[k - 1]);
      const band = lap[k - 1];
      for (let i = 0; i < dst.length; i++) dst[i] = up[i] + band[i];
    }
  }

  const shaped = applyShaping(fine[0], size, shape, shapeSharp, shapeDetail);
  return metresToField(shaped, size);
}

'''


def main() -> int:
    src = TARGET.read_text(encoding="utf-8")
    if "hydraulicDropletMultiscale" in src:
        print("already inserted; nothing to do")
        return 0
    if src.count(ANCHOR) != 1:
        print(f"anchor count {src.count(ANCHOR)}; aborting")
        return 1

    out = src.replace(ANCHOR, BLOCK + ANCHOR, 1)
    TARGET.write_text(out, encoding="utf-8")

    check = TARGET.read_text(encoding="utf-8")
    print("multiscale defined:", check.count("export function hydraulicDropletMultiscale"))
    print("pyramidLevelsFor defined:", check.count("export function pyramidLevelsFor"))
    print("buildPyramid defined:", check.count("function buildPyramid("))
    print("bytes:", len(check))

    p = subprocess.run(["node", "--check", str(TARGET)], capture_output=True, text=True)
    print("syntax:", "OK" if p.returncode == 0 else p.stderr[:400])
    return 0 if p.returncode == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
