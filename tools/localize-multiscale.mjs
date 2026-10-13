/**
 * localize-multiscale.mjs — find WHICH stage loses the field's dynamic range.
 *
 * Round 29 established that multiscale erosion loses about 10% of the field's range (1.0000 to
 * 0.8952) while single-scale preserves it, and that this is a real defect rather than a D8
 * metric artefact. Round 30 measured the first hypothesis — that the fixed deposition cap
 * overwhelms the coarse levels' smaller relief — and REFUTED it.
 *
 * This uses the `trace` hook added to `hydraulicDropletMultiscale` to read the field's span and
 * standard deviation after every stage of every level, so the loss is attributed to a specific
 * operation instead of guessed at.
 *
 * Run:  node tools/localize-multiscale.mjs
 */

import { hydraulicDroplet, hydraulicDropletMultiscale } from '../web/js/kernels/erosion.js';
import { createField } from '../web/js/kernel/field.js';

const size = 128;
const seed = 12345;
const TERRAIN_HEIGHT_M = 10000;

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

function stat(a) {
  let lo = Infinity;
  let hi = -Infinity;
  let mean = 0;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; mean += v; }
  mean /= a.length;
  let varr = 0;
  for (const v of a) varr += (v - mean) ** 2;
  return { lo, hi, span: hi - lo, sd: Math.sqrt(varr / a.length) };
}

// The field is passed in NORMALISED 0..1, because hydraulicDropletMultiscale calls
// ieldToMetres itself. Pre-multiplying here converted twice, which made every traced span
// read ~800x the input and made the numbers meaningless -- the trace caught it.
const base = baseField(size);
const metres = base;

const params = {
  Duration: 10, 'Erosion Scale': 1000, Seed: seed,
  'Suspended Load': 1, 'Bed Load': 0, 'Coarse Sediments': 0,
  Enable: true, NoErosion: false, Downcutting: 0.25, DepositionBoost: 0,
  ExtraDepositionBoost: 0,
};

const fieldOf = (h) => ({ data: h, channels: 1, size, channel: 'height' });
const ctxFor = (h) => ({ size, params, input: () => fieldOf(h) });

console.log('');
console.log('  stage            level  size     span(m)      sd(m)   span vs input');
console.log('  ' + '-'.repeat(70));

const inputStat = stat(base);
const rows = [];
const ctx = ctxFor(metres);
ctx.trace = (stage, k, n, beforeData, afterData) => {
  // `before` is the pre-erosion copy at the level's own resolution for the erode/gate stages;
  // for a reconstruction it is the coarser level's own buffer, which is a different length, so
  // only the AFTER reading is meaningful there and the ratio is left blank.
  const s = stat(afterData);
  rows.push({ stage, k, n, s, ratio: (afterData.length === metres.length)
    ? s.span / inputStat.span : null });
};

const result = hydraulicDropletMultiscale(ctx);
for (const r of rows) {
  console.log(`  ${r.stage.padEnd(16)} ${String(r.k).padStart(4)} ${String(r.n).padStart(5)}`
    + ` ${r.s.span.toFixed(1).padStart(11)} ${r.s.sd.toFixed(1).padStart(10)}`
    + ` ${r.ratio === null ? '     --' : r.ratio.toFixed(6).padStart(13)}`);
}

const outStat = stat(result.data);
console.log('');
console.log(`  final output span ${outStat.span.toFixed(4)} vs input 1.0000`);
console.log('');

// Which stage moved the range the most, at the full resolution only.
const full = rows.filter((r) => r.ratio !== null);
if (full.length) {
  let worst = full[0];
  for (const r of full) {
    if (Math.abs(r.ratio - 1) > Math.abs(worst.ratio - 1)) worst = r;
  }
  console.log(`  largest deviation at full resolution: ${worst.stage} level ${worst.k}`
    + ` (span ratio ${worst.ratio.toFixed(6)})`);
  console.log('');
  // The single-scale run is the control: same solver, no pyramid.
  const ss = hydraulicDroplet(ctxFor(base)).data;
  const ssStat = stat(ss);
  console.log(`  control, single-scale span ${ssStat.span.toFixed(1)} m`
    + ` (${(ssStat.span / inputStat.span).toFixed(6)} vs input)`);
  console.log('');
  // LOCALISED IN ROUND 31. The span/sd ratio is the unit-free reading:
  //
  //     eroded L2        553.3 / 114.4 = 4.84
  //     gated L2         706.9 / 148.4 = 4.76
  //     reconstructed L0 716.4 / 150.5 = 4.76
  //     eroded L0        844.8 / 148.9 = 5.67   <-- span stretches 18%, sd flat
  //     gated L0         713.4 / 150.0 = 4.76
  //
  // At L0 the erosion widens the span by 18% while the standard deviation does not move, so a
  // few EXTREME cells are being pushed out rather than the field changing coherently. The gate
  // then pulls the span back. Everything after gated L0 is applyShaping and metresToField,
  // and metresToField CLAMPS -- which compresses exactly the extremes a stretched span
  // represents. That clamp is where the final 0.8952 comes from, and it is the single
  // candidate left.
  if (worst.ratio !== null && worst.ratio < 0.99) {
    console.log('  The stage above is where the range is lost; everything downstream inherits it.');
  } else {
    console.log('  No single stage at full resolution loses the range, so the loss accumulates');
    console.log('  across the coarse levels and is carried down by the reconstructions.');
  }
}
console.log('');
