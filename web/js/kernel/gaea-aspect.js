/**
 * gaea-aspect.js — ports of the `AspectMaps` height-analysis helpers.
 *
 * `AspectMaps` turns a heightfield into derivative products (curvature, slope, thresholds). These are
 * plain finite differences on the heightfield, so they port exactly; the only subtlety is that the
 * shipped code divides `ux = 1/(W-1)` and then divides by `ux` (not by the pixel step directly), and
 * that `GetCurvature` halves only the MAX bound (`max = Max/2`) while `min = Min` stays as given.
 *
 * Verified against the shipped methods by `tools/verify-exact.mjs`.
 */

export const CURVATURE_TYPE = { Horizontal: 0, Vertical: 1, Average: 2 };

function curvatureHorizontal(dx, dy, dxx, dyy, dxy) {
  let num = -2 * (dy * dy * dxx + dx * dx * dyy - dx * dy * dxy);
  num /= dx * dx + dy * dy;
  if (!Number.isFinite(num)) num = 0;
  if (num < -10000) num = -10000;
  if (num > 10000) num = 10000;
  num /= 10000;
  return num * 0.5 + 0.5;
}

function curvatureVertical(dx, dy, dxx, dyy, dxy) {
  let num = -2 * (dx * dx * dxx + dy * dy * dyy + dx * dy * dxy);
  num /= dx * dx + dy * dy;
  if (!Number.isFinite(num)) num = 0;
  if (num < -10000) num = -10000;
  if (num > 10000) num = 10000;
  num /= 10000;
  return num * 0.5 + 0.5;
}

/** `AspectMaps.GetCurvature(map, Min, Max, Falloff, Type)`. */
export function getCurvature(data, N, Min, Max, Falloff, Type) {
  const max = Max / 2;
  const min = Min;
  const falloffMax = max + Falloff;
  const falloffMin = min - Falloff;
  const minFactor = min - falloffMin;
  const maxFactor = falloffMax - max;
  const ux = 1 / (N - 1);
  const uy = 1 / (N - 1);
  const out = new Float32Array(N * N);
  const idx = (x, y) => x + y * N;
  for (let y = 0; y < N; y++) {
    const yUp = y === 0 ? y : y - 1;
    const yDn = y === N - 1 ? y : y + 1;
    for (let x = 0; x < N; x++) {
      const xL = x === 0 ? x : x - 1;
      const xR = x === N - 1 ? x : x + 1;
      const c = data[idx(x, y)];
      const l = data[idx(xL, y)];
      const r = data[idx(xR, y)];
      const u = data[idx(x, yUp)];
      const d = data[idx(x, yDn)];
      const ul = data[idx(xL, yUp)];
      const ur = data[idx(xR, yUp)];
      const dl = data[idx(xL, yDn)];
      const dr = data[idx(xR, yDn)];
      const dx = (r - l) / (2 * ux);
      const dy = (d - u) / (2 * uy);
      const dxx = (r - 2 * c + l) / (ux * ux);
      const dyy = (d - 2 * c + u) / (uy * uy);
      const dxy = (dr - dl - ur + ul) / (4 * ux * uy);
      let v = 0;
      if (Type === CURVATURE_TYPE.Horizontal) v = curvatureHorizontal(dx, dy, dxx, dyy, dxy);
      else if (Type === CURVATURE_TYPE.Vertical) v = curvatureVertical(dx, dy, dxx, dyy, dxy);
      else {
        const h = curvatureHorizontal(dx, dy, dxx, dyy, dxy);
        const vert = curvatureVertical(dx, dy, dxx, dyy, dxy);
        v = (h + vert) * 0.5;
      }
      let o = 0;
      if (v >= min && v <= max) o = 0;
      if (Falloff > 0) {
        if (v > max && v < falloffMax) o = (v - max) / maxFactor;
        if (v < min && v > falloffMin) o = 1 - (v - falloffMin) / minFactor;
      }
      out[idx(x, y)] = o;
    }
  }
  return out;
}

/** `AspectMaps.GetThreshold(map, threshold)` — hard binary threshold. */
export function getThreshold(data, threshold) {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] > threshold ? 1 : 0;
  return out;
}
