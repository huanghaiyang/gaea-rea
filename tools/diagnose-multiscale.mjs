/**
 * diagnose-multiscale.mjs — decide whether the multiscale erosion really carves channels.
 *
 * THE QUESTION, left open in round 28
 * Replacing the 2x2 box reduction with Gaea's real 5x5 Gaussian dropped multiscale's peak D8
 * accumulation from 90 to 71, below both the input (83) and the single-scale run (81). Two
 * readings were left open:
 *
 *   (a) the D8 metric is the problem — with a proper low-pass the stored detail band dominates
 *       the reconstructed field, so steepest-descent paths follow the original texture rather
 *       than the eroded channels
 *   (b) the level combination is genuinely worse
 *
 * WHY BLURRING BEFORE MEASURING DISCRIMINATES
 * The suspected cause of (a) is the detail band, which is entirely HIGH frequency: it is what
 * the reduction removed. Blurring the output with the same 5x5 kernel several times attenuates
 * the band by orders of magnitude while leaving the coarse-scale structure that erosion acted
 * on. If multiscale carved real valleys, D8 on the blurred field must still show them — the
 * erased band cannot be what is producing the measurement.
 *
 * The control is the single-scale run blurred identically. If both collapse to the same
 * numbers, the coarse levels contributed nothing and the pyramid is doing no work.
 *
 * Run:  node tools/diagnose-multiscale.mjs
 */

import {
  hydraulicDroplet, hydraulicDropletMultiscale,
  downsample2, upsample2, flowAccumulation,
} from '../web/js/kernels/erosion.js';
import { createField } from '../web/js/kernel/field.js';

const size = 128;
const seed = 12345;

/** A deterministic fbm-ish height field, so the diagnostic is reproducible. */
function baseField(n) {
  const h = new Float32Array(n * n);
  let phase = seed;
  const rand = () => {
    phase = (phase * 1664525 + 1013904223) >>> 0;
    return phase / 4294967296;
  };
  // Several octaves, so the field has both broad basins and fine texture for the band to hold.
  for (let oct = 0; oct < 5; oct++) {
    const f = 2 ** oct;
    const amp = 1 / f;
    const px = rand() * 100;
    const py = rand() * 100;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = Math.sin((x / n) * f * 6.28 + px) * Math.cos((y / n) * f * 6.28 + py);
        h[y * n + x] += v * amp;
      }
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / (hi - lo);
  return h;
}

/**
 * Blur with the pyramid's own low-pass, repeatedly.
 *
 * The first version of this used NEAREST-NEIGHBOUR upsampling, which turned the field into
 * coarse blocks after one pass and saturated D8 accumulation at 4 -- a degenerate measurement
 * reporting the same number at every blur level. Using the real interpolator keeps the field
 * smooth, so the accumulation stays meaningful and what the metric sees is the surviving
 * low-frequency structure.
 */
function blurTimes(a, n, times) {
  let cur = Float32Array.from(a);
  for (let t = 0; t < times; t++) {
    const coarse = downsample2(cur, n);
    cur = upsample2(coarse, n >> 1, n);
  }
  return cur;
}

function peakOf(h, n) {
  // `flowAccumulation` takes the height field directly and returns `{ acc, recv }`.
  const { acc } = flowAccumulation(h, n);
  let peak = 0;
  for (const v of acc) if (v > peak) peak = v;
  return peak;
}

function rangeOf(h) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { lo, hi, span: hi - lo };
}

/** Root-mean-square difference, and the correlation of the two fields. */
function compare(a, b) {
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / a.length;
  const mb = sb / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  let rms = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
    rms += (a[i] - b[i]) ** 2;
  }
  return { corr: num / Math.sqrt(da * db || 1), rms: Math.sqrt(rms / a.length) };
}

const base = baseField(size);
const ctxFor = (h, seedVal) => ({
  size,
  field: createField(size, 'height'),
  params: {
    Duration: 10, 'Erosion Scale': 1000, Seed: seedVal,
    'Suspended Load': 1, 'Bed Load': 0, 'Coarse Sediments': 0,
    Rain: 1, Enable: true, NoErosion: false, Downcutting: 0.25, DepositionBoost: 0,
    ExtraDepositionBoost: 0, 'Discharge Angle': 10,
  },
  input: () => ({ data: h, channels: 1, size, channel: 'height' }),
});

const P = ctxFor(base).params;

console.log('');
console.log('  metric                        input   single    multi');
console.log('  ' + '-'.repeat(56));

const runs = {
  input: base,
  single: hydraulicDroplet(ctxFor(base, P.Seed)).data,
  multi: hydraulicDropletMultiscale(ctxFor(base, P.Seed)).data,
};

// Raw.
console.log(`  peak D8 accumulation (raw)   ${peakOf(runs.input, size).toFixed(0).padStart(6)}` +
  ` ${peakOf(runs.single, size).toFixed(0).padStart(7)} ${peakOf(runs.multi, size).toFixed(0).padStart(8)}`);

// Blurred, which removes the detail band. This is the discriminating measurement.
for (const times of [1, 2, 3]) {
  const label = `peak D8 accumulation (blur x${times})`.padEnd(28);
  const bi = peakOf(blurTimes(runs.input, size, times), size);
  const bs = peakOf(blurTimes(runs.single, size, times), size);
  const bm = peakOf(blurTimes(runs.multi, size, times), size);
  console.log(`  ${label}${bi.toFixed(0).padStart(6)} ${bs.toFixed(0).padStart(7)} ${bm.toFixed(0).padStart(8)}`);
}

console.log('');
console.log('  how far each run moved the field');
for (const [name, r] of Object.entries(runs)) {
  if (name === 'input') continue;
  const c = compare(runs.input, r);
  const rg = rangeOf(r);
  console.log(`    ${name.padEnd(8)} rms delta ${c.rms.toFixed(5)}  correlation ${c.corr.toFixed(6)}` +
    `  span ${rg.span.toFixed(4)} vs input ${rangeOf(runs.input).span.toFixed(4)}`);
}

// The coarse-scale effect specifically: compare the two runs on the LOW-PASS content only.
// If multiscale carved broad valleys, its low-pass must differ from single-scale's by more
// than the runs differ from the input at that scale.
console.log('');
const lowIn = blurTimes(runs.input, size, 3);
const lowSs = blurTimes(runs.single, size, 3);
const lowMs = blurTimes(runs.multi, size, 3);
const ssVsIn = compare(lowIn, lowSs);
const msVsIn = compare(lowIn, lowMs);
const msVsSs = compare(lowSs, lowMs);
console.log('  low-pass content (blur x3), rms difference');
console.log(`    single vs input : ${ssVsIn.rms.toFixed(6)}`);
console.log(`    multi  vs input : ${msVsIn.rms.toFixed(6)}`);
console.log(`    multi  vs single: ${msVsSs.rms.toFixed(6)}`);
console.log('');
if (msVsIn.rms > ssVsIn.rms && msVsSs.rms > ssVsIn.rms) {
  console.log('  VERDICT: multiscale alters the LOW-PASS content more than single-scale does,');
  console.log('           so the coarse levels are doing real work and the D8 drop is a metric');
  console.log('           artefact of the detail band dominating the reconstructed field.');
} else if (msVsSs.rms < ssVsIn.rms) {
  console.log('  VERDICT: multiscale barely moves the low-pass content, so its coarse levels');
  console.log('           contribute little and the D8 drop reflects a genuine loss.');
} else {
  console.log('  VERDICT: inconclusive at this threshold; the numbers are above for reading.');
}
console.log('');
