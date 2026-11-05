/**
 * gaea-terrace.js — exact port of `Profiles.Terrace`.
 *
 * Terrace builds `num` boundary values evenly spaced over 0..1, then jitters the interior boundaries
 * with `XorShift64Star` (10 relaxation passes), and finally maps every height into its band through a
 * smoothstep-shaped curve whose exponent is `1 - steepness`. `forceZero` reserves a tiny first
 * boundary so the bottom of the range still forms a band.
 *
 * Verified against the shipped `Profiles.Terrace` by `tools/verify-exact.mjs` (randomised bands mean
 * this also validates `gaea-random.js`).
 */
import { XorShift64Star } from './gaea-random.js';

export function profileTerrace(src, num, uniformity, steepness, intensity, seed, forceZero = false) {
  const dst = Float32Array.from(src);
  const terraces = new Float32Array(forceZero ? num + 1 : num);
  const rng = new XorShift64Star(seed);
  const stepValue = 1 / (num - 1);
  if (forceZero) terraces[1] = 0.001;
  for (let i = forceZero ? 2 : 1; i < num; i++) terraces[i] = terraces[i - 1] + stepValue;
  for (let pass = 0; pass < 10; pass++) {
    for (let k = 1; k < num - 1; k++) {
      const span = terraces[k + 1] - terraces[k - 1];
      const r = rng.nextFloat();
      const candidate = terraces[k - 1] + span * r;
      terraces[k] = terraces[k] * uniformity + candidate * (1 - uniformity);
    }
  }
  for (let p = 0; p < dst.length; p++) {
    const v = dst[p];
    if (v >= 0.999) continue;
    let idx = 0;
    for (let l = 0; l < num - 1; l++) {
      if (terraces[idx + 1] > v) break;
      if (idx + 1 === num) break;
      idx += 1;
    }
    const lo = terraces[idx];
    const hi = terraces[idx + 1];
    const t = (v - lo) / (hi - lo);
    let s = 3 * t * t - 2 * t * t * t;
    s = (s - 0.5) * 2;
    const negative = s < 0;
    s = Math.abs(s);
    if (negative) s = -s;
    s = s / 2 + 0.5;
    s = Math.pow(s, 1 - steepness);
    dst[p] = (lo * (1 - s) + hi * s) * intensity + dst[p] * (1 - intensity);
  }
  return dst;
}
