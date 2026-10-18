/**
 * gaea-mosaic.js — exact ports of the tile/transform helpers the Repeat and Seamless nodes use.
 *
 * Sources (constant-resolved `Gaea.Nodes.resolved.cs` plus `Gaea.Engine.whole.cs` for the
 * Transformer internals):
 *   - `Transformer.Resize(map, res, LinearFast)` = bilinear sample at `x*scale - 0.5`
 *   - `Transformer.Insert(..., BlendMode.Add)`   = integer-aligned add with clamped bounds
 *   - `Mosaic.Repeat(map, tiles, height)`
 *   - `Mosaic.Seamless(heightmap, texture, Edge, ShiftX, ShiftY)`
 *
 * All verified against the shipped methods by `tools/verify-exact.mjs`.
 */

/**
 * `Channel.InterpolateBilinear(position)` (the no-edge-behaviour overload):
 * subtract 0.5 (pixel centres), truncate toward zero, clamp, bilinear.
 */
export function interpolateBilinear(src, N, px, py) {
  const x = px - 0.5;
  const y = py - 0.5;
  let xi = Math.trunc(x);
  let yi = Math.trunc(y);
  const fx = x - xi;
  const fy = y - yi;
  if (xi < 0) xi = 0;
  else if (xi > N - 1) xi = N - 1;
  if (yi < 0) yi = 0;
  else if (yi > N - 1) yi = N - 1;
  const x1 = Math.min(xi + 1, N - 1);
  const y1 = Math.min(yi + 1, N - 1);
  const top = src[yi * N + xi] * (1 - fx) + src[yi * N + x1] * fx;
  const bot = src[y1 * N + xi] * (1 - fx) + src[y1 * N + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

/** `Transformer.Resize(map, Resolution(dstN), LinearFast)`. */
export function resizeLinearFast(src, srcN, dstN) {
  const out = new Float32Array(dstN * dstN);
  const scale = srcN / dstN;
  for (let y = 0; y < dstN; y++) {
    for (let x = 0; x < dstN; x++) {
      out[y * dstN + x] = interpolateBilinear(src, srcN, x * scale, y * scale);
    }
  }
  return out;
}

/**
 * `Transformer.Insert(source, dest, position, BlendMode.Add, null, TopLeft)` for one-channel data.
 * position is in destination pixels; placement is integer-truncated and clipped to the canvas.
 */
export function insertAdd(dest, destN, src, srcN, posX, posY) {
  const vx = Math.trunc(posX);
  const vy = Math.trunc(posY);
  const yStart = Math.min(Math.max(vy, 0), destN - 1);
  const yEnd = Math.min(Math.max(vy + srcN - 1, 0), destN - 1);
  const xStart = Math.min(Math.max(vx, 0), destN - 1);
  const xEnd = Math.min(Math.max(vx + srcN - 1, 0), destN - 1);
  for (let y = yStart; y <= yEnd; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      dest[y * destN + x] += src[(y - yStart) * srcN + (x - xStart)];
    }
  }
  return dest;
}

/**
 * `Mosaic.Repeat(map, tiles, height = 1)`:
 * shrink the map to ceil(N/tiles), optionally scale its height, then tile it `tiles^2` times with
 * integer-aligned additive insertion.
 */
export function mosaicRepeat(src, N, tiles, height = 1) {
  const num = N / tiles;
  const srcN = Math.ceil(num);
  let tile = resizeLinearFast(src, N, srcN);
  if (height !== 1) {
    for (let i = 0; i < tile.length; i++) tile[i] *= height;
  }
  const out = new Float32Array(N * N);
  for (let i = 0; i < tiles; i++) {
    const oy = i * num;
    for (let j = 0; j < tiles; j++) {
      insertAdd(out, N, tile, srcN, j * num, oy);
    }
  }
  return out;
}

/** Mosaic's smootherstep polynomial (`Mosaic.Smoothstep`). */
function smoothstep(x) {
  const x2 = x * x;
  return x * x2 * (6 * x2 - 15 * x + 10);
}

const combine = (a, b, fade) => a * fade + b * (1 - fade);

/**
 * `Mosaic.Seamless(heightmap, texture, Edge, ShiftX, ShiftY)` — height half only.
 * Blends a horizontally shifted copy, then a vertically shifted copy of the result, with a
 * half-resolution trapezoid weight fed through smootherstep. The texture output is not produced
 * because this graph model carries one output per node.
 */
export function mosaicSeamless(src, N, edge = 0.5, shiftX = 0.5, shiftY = 0.5) {
  const e = Math.max(edge, 0.01);
  const sx = Math.trunc(0.5 + (N - 1) * ((shiftX - 0.5) * (1 - e) + 0.5));
  const sy = Math.trunc(0.5 + (N - 1) * ((shiftY - 0.5) * (1 - e) + 0.5));
  const edgeInv = 1 / e;
  const half = new Float32Array(N * N);
  const halfRes = N >> 1;
  for (let y = 0; y < N; y++) {
    for (let i = 0; i < N; i++) {
      let w = 1 - Math.abs(halfRes - i) / halfRes;
      w = Math.min(w * edgeInv, 1);
      w = smoothstep(w);
      const sxr = (i + sx) % N;
      half[y * N + i] = combine(src[y * N + i], src[y * N + sxr], w);
    }
  }
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    let w = 1 - Math.abs(halfRes - y) / halfRes;
    w = Math.min(w * edgeInv, 1);
    w = smoothstep(w);
    const syr = (y + sy) % N;
    for (let i = 0; i < N; i++) {
      out[y * N + i] = combine(half[y * N + i], half[syr * N + i], w);
    }
  }
  return out;
}

