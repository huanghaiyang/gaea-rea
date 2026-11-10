/**
 * gaea-filter.js — exact ports of `FilterCore.FilterProcess` and the three `Combiner` transpose
 * operations used by the Transpose node.
 *
 * `FilterProcess` is a blur-difference filter bank (the shipped implementation uses `Map.Blur` for
 * its shelf/band kernels, which is why it only became portable once `gaea-blur.js` existed). The
 * filter modes are pinned by the enum: LowPass=0, HighPass=1, LowShelf=2, HighShelf=3, BandPass=4,
 * Notch=5, Bell=6.
 *
 * Every public function here is diffed against the shipped `Combiner.*` / `FilterCore.*` methods by
 * `tools/verify-exact.mjs`.
 */

import { mapBlur, mapBlurPercent } from './gaea-blur.js';
import { graphicEQ } from './gaea-exact.js';
import { normalizeMap, autolevel, minMax, shiftClamp } from './gaea-combine.js';

export const FILTER_MODE = {
  LowPass: 0,
  HighPass: 1,
  LowShelf: 2,
  HighShelf: 3,
  BandPass: 4,
  Notch: 5,
  Bell: 6,
};

/** `MeasureDC` — the mean of the channel. */
export function measureDC(data) {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i];
  return s / data.length;
}

/**
 * `\ueb77\uf21d\ue95f(this Map)` — the "Drop" operator: subtract `min(1, dataMin)`, treat inputs above
 * 1 as 1, then clamp the remainder to [0, 1]. On a 0..1 ramp it is the identity; on a raised field it
 * re-bases to 0. The upper clamp is 1 (not `1 - min`), which only shows on fields that go negative
 * after an offset — `Combiner.Embed` with Extend does exactly that.
 */
export function mapDrop(data) {
  const { min } = minMax(data);
  const base = Math.min(1, min);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let v = Math.min(data[i], 1) - base;
    if (v < 0) v = 0;
    else if (v > 1) v = 1;
    out[i] = v;
  }
  return out;
}

/** `\ueb77\uf21d\ue95d(this Map)` — invert (`Vector<float>.One - v`). */
export function mapInvert(data) {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = 1 - data[i];
  return out;
}

const mix = (a, b, t) => a * (1 - t) + b * t;

/**
 * `FilterCore.FilterProcess(input, frequency, gain, q, mode, keepDC)`.
 * The shelf/band modes are blur-difference filters: `blurRadius = (1 - f*0.9999) * N * 0.25`.
 */
export function filterProcess(input, N, frequency, gain, q, mode, keepDC) {
  const src = Float32Array.from(input);
  let map = Float32Array.from(input);
  const dc = keepDC ? measureDC(src) : 0;
  const num = (1 - frequency * 0.9999) * N * 0.25;
  let blur1 = null;
  let blurL = null;
  let blurH = null;
  if (mode === FILTER_MODE.BandPass || mode === FILTER_MODE.Notch || mode === FILTER_MODE.Bell) {
    const num2 = 0.7 * q + 0.2;
    blurL = mapBlur(map, N, num * num2);
    blurH = mapBlur(map, N, num / num2);
  } else {
    blur1 = mapBlur(map, N, num);
  }
  switch (mode) {
    case FILTER_MODE.LowPass:
      map = blur1;
      break;
    case FILTER_MODE.HighPass:
      for (let i = 0; i < map.length; i++) map[i] = src[i] - blur1[i];
      break;
    case FILTER_MODE.LowShelf:
      for (let i = 0; i < map.length; i++) map[i] = mix(src[i] - blur1[i], src[i], gain);
      break;
    case FILTER_MODE.HighShelf:
      for (let i = 0; i < map.length; i++) map[i] = mix(blur1[i], src[i], gain);
      break;
    case FILTER_MODE.BandPass: {
      const bk = Math.exp(q * q * 2.5);
      for (let i = 0; i < map.length; i++) map[i] = (blurL[i] - blurH[i]) * bk;
      break;
    }
    case FILTER_MODE.Notch:
      for (let i = 0; i < map.length; i++) map[i] = src[i] - (blurL[i] - blurH[i]);
      break;
    case FILTER_MODE.Bell:
      for (let i = 0; i < map.length; i++) map[i] = (blurL[i] - blurH[i]) * (gain - 1) + src[i];
      break;
    default:
      break;
  }
  if (keepDC) {
    const correction = dc - measureDC(map);
    for (let i = 0; i < map.length; i++) map[i] += correction;
  }
  return map;
}

const addMix = (a, b, ratio) => {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = mix(a[i], a[i] + b[i], ratio);
  return out;
};

/**
 * `Combiner.Transpose(ground, reference, amount)`:
 * low-shelf(filter 0.75, gain 0) the reference, drop it to 0, add it into the ground with `amount`,
 * then walk the result's range back to the ground's original min/max.
 */
export function combinerTranspose(ground, reference, N, amount) {
  const g = Float32Array.from(ground);
  const oldStats = minMax(g);
  let ref = filterProcess(reference, N, 0.75, 0, 0, FILTER_MODE.LowShelf, true);
  ref = mapDrop(ref);
  let out = addMix(g, ref, amount);
  const s = minMax(out);
  out = normalizeMap(out, s.max, s.min, oldStats.max, oldStats.min);
  return out;
}

/**
 * `Combiner.Embed(a, b, ratio, extend)` — inset the reference as a raised/offset plateau.
 *
 * Measured order: invert the reference (`\ueb77\uf21d\ue95d` = `Vector<float>.One - v`), shift it so
 * its min sits at 0, optionally scale it up with Extend, subtract `ratio` of it from the terrain,
 * then raise the result so its min is 0.
 *
 * The invert is NOT a horizontal mirror. On the horizontal ramp this test used to feed in, the two
 * operations are mathematically identical, which is why the mismatch went unnoticed; on any other
 * field they differ completely.
 *
 * The trailing raise is the engine's no-arg `\ueb77\uf21d\ue95e`: "if min < 0, subtract min",
 * NOT unconditional `Drop`.
 */
export function combinerEmbed(a, b, N, ratio = 1, extend = 0) {
  const num = extend - 0.1;
  let m = mapInvert(b);
  const s0 = minMax(m);
  m = shiftClamp(m, s0.min, 1);
  if (num > 0) {
    const k = num + 1;
    for (let i = 0; i < m.length; i++) m[i] *= k;
  }
  const out = new Float32Array(a.length);
  for (let i = 0; i < out.length; i++) out[i] = a[i] - m[i] * ratio;
  const s = minMax(out);
  // no-arg `ue95e`：只有 min < 0 时才走 Drop（Drop 自己会把结果夹在 [0,1]）。
  return s.min < 0 ? mapDrop(out) : out;
}

/**
 * `Combiner.Insert(terrain, input, ratio, threshold, flatten, boundary)`:
 * threshold the insert mask, soften it with a Boundary-proportional blur, flatten the terrain's
 * highs through a GraphicEQ, blend with the mask, then add the input.
 */
export function combinerInsert(terrain, input, N, ratio, threshold, flatten, boundary) {
  const mask = new Float32Array(N * N);
  for (let i = 0; i < mask.length; i++) mask[i] = input[i] > threshold ? 1 : 0;
  const soft = mapBlurPercent(mask, N, boundary * 3);
  const f = 1 - flatten;
  const eq = graphicEQ(terrain, N, [1, 1, f, f, f, f, f]);
  const blended = new Float32Array(N * N);
  for (let i = 0; i < blended.length; i++) blended[i] = terrain[i] * (1 - soft[i]) + eq[i] * soft[i];
  const out = new Float32Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = blended[i] + input[i] * ratio;
  return out;
}
