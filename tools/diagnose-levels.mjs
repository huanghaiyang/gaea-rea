/**
 * diagnose-levels.mjs — measure how much relief each pyramid level actually has.
 *
 * WHY THIS MATTERS
 * `erodeLevel` applies ABSOLUTE limits: `maxDepositPerStep = TERRAIN_HEIGHT_M * 0.004`, and
 * fixed erode/deposit rates. But a pyramid's coarse levels are low-pass versions of the fine
 * one, so their relief in metres is much smaller. A fixed deposition cap against a small
 * relief deposits RELATIVELY more material, which would fill valleys instead of carving them —
 * exactly the symptom diagnosed in round 29 (multiscale shrinks the field's range from 1.0000
 * to 0.8952, and the blurred input has higher drainage than either eroded run).
 *
 * This measures the relief per level and the cap-to-relief ratio, so the hypothesis is tested
 * rather than assumed.
 *
 * Run:  node tools/diagnose-levels.mjs
 */

import { buildPyramid, pyramidLevelsFor } from '../web/js/kernels/erosion.js';

const size = 128;
const seed = 12345;

function baseField(n) {
  const h = new Float32Array(n * n);
  let phase = seed;
  const rand = () => {
    phase = (phase * 1664525 + 1013904223) >>> 0;
    return phase / 4294967296;
  };
  for (let oct = 0; oct < 5; oct++) {
    const f = 2 ** oct;
    const amp = 1 / f;
    const px = rand() * 100;
    const py = rand() * 100;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        h[y * n + x] += Math.sin((x / n) * f * 6.28 + px) * Math.cos((y / n) * f * 6.28 + py) * amp;
      }
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / (hi - lo);
  return h;
}

function stats(a) {
  let lo = Infinity;
  let hi = -Infinity;
  let mean = 0;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; mean += v; }
  mean /= a.length;
  let varr = 0;
  for (const v of a) varr += (v - mean) ** 2;
  return { lo, hi, span: hi - lo, sd: Math.sqrt(varr / a.length) };
}

// The same scale the kernel uses internally, so the cap is expressed in the same units.
const TERRAIN_HEIGHT_M = 10000;
const CAP = TERRAIN_HEIGHT_M * 0.004;

const base = baseField(size);
// The field is normalised 0..1; the kernel converts to metres before the pyramid is built.
const metres = new Float32Array(base.length);
for (let i = 0; i < base.length; i++) metres[i] = base[i] * TERRAIN_HEIGHT_M;

const levels = pyramidLevelsFor(size);
const { fine, sizes } = buildPyramid(metres, size, levels);

console.log('');
console.log(`  deposit cap per step: ${CAP.toFixed(1)} m   (TERRAIN_HEIGHT_M * 0.004)`);
console.log('');
console.log('  level   size    relief(m)     sd(m)   cap/relief   cap/sd   droplets');
console.log('  ' + '-'.repeat(72));
const duration = 10;
for (let k = 0; k < sizes.length; k++) {
  const s = stats(fine[k]);
  const n = sizes[k];
  const droplets = Math.max(2000, Math.min(2_000_000, Math.round(duration * 0.8 * n * n)));
  console.log(`  ${String(k).padStart(4)} ${String(n).padStart(6)} ${s.span.toFixed(1).padStart(11)}`
    + ` ${s.sd.toFixed(1).padStart(9)} ${(CAP / s.span).toFixed(6).padStart(11)}`
    + ` ${(CAP / s.sd).toFixed(6).padStart(9)} ${String(droplets).padStart(10)}`);
}

console.log('');
const s0 = stats(fine[0]);
const sLast = stats(fine[sizes.length - 1]);
const ratio = sLast.sd / s0.sd;
const capRatio = (CAP / sLast.sd) / (CAP / s0.sd);
console.log(`  coarsest sd / finest sd            : ${ratio.toFixed(4)}`);
console.log(`  so cap-to-relief grows by          : ${capRatio.toFixed(1)}x from fine to coarse`);
console.log('');
// NOTE: this threshold was set expecting the relief to collapse at coarse scales. It does
// NOT: the 5x5 Gaussian is a mild low-pass, so the coarsest level keeps 96.9% of the finest
// level's standard deviation and capRatio comes out at 1.0x. The hypothesis that the fixed
// deposition cap causes the filling is therefore REFUTED, and the cause lies elsewhere --
// the next step is to instrument each reconstruction to localise where the range is lost.
if (capRatio > 5) {
  console.log('  VERDICT: the fixed deposition cap is far larger relative to the coarse levels\'');
  console.log('           relief than to the fine level, so the coarse passes deposit relatively');
  console.log('           more and fill drainage. The cap (or the rates) must scale with the');
  console.log('           level, which this build does not do.');
} else {
  console.log('  VERDICT: the cap-to-relief ratio does not grow enough to explain the filling on');
  console.log('           its own; the cause lies elsewhere.');
}
console.log('');
