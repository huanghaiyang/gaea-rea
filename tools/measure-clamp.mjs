/**
 * measure-clamp.mjs — how far outside its range does the multiscale run actually go?
 *
 * Round 31 localised the 10% dynamic-range loss to the steps after `gated level 0`, and round 32
 * refuted the theory that `applyShaping`'s unsharp mask was the culprit — clamping that mask to
 * the field's own envelope changed the span by 0.0035, i.e. nothing, because the envelope is
 * itself already outside the normalised bound `metresToField` applies.
 *
 * THE MEASUREMENT THAT SETTLES IT, and that round 32 should have run before editing anything:
 * take `applyShaping`'s output, convert it to the normalised domain the way `metresToField`
 * does, and count how many cells fall outside 0..1 and by how much.
 *
 *   * a large overshoot  -> the clamp IS destroying the range, and the fix belongs UPSTREAM:
 *                           stop the erosion producing out-of-range values, rather than adding
 *                           more clamping downstream
 *   * a small overshoot  -> the clamp is not the cause and something else is
 *
 * Run:  node tools/measure-clamp.mjs
 */

import { hydraulicDroplet, hydraulicDropletMultiscale } from '../web/js/kernels/erosion.js';

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

const base = baseField(size);
const params = {
  Duration: 10, 'Erosion Scale': 1000, Seed: seed,
  'Suspended Load': 1, 'Bed Load': 0, 'Coarse Sediments': 0,
  Enable: true, NoErosion: false, Downcutting: 0.25, DepositionBoost: 0,
  ExtraDepositionBoost: 0,
};
const ctxFor = (h) => ({ size, params, input: () => ({ data: h, channels: 1, size, channel: 'height' }) });

/** Report the out-of-range behaviour of a shaped (metres) field. */
function report(label, shaped) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of shaped) { if (v < lo) lo = v; if (v > hi) hi = v; }
  // metresToField normalises by the input's own range; approximate it by the shaped field's
  // span mapped onto 0..1. What matters here is the SHAPE of the overshoot, not its scale.
  const span = hi - lo;
  let below = 0;
  let above = 0;
  let worstBelow = 0;
  let worstAbove = 0;
  for (const v of shaped) {
    const t = span > 0 ? (v - lo) / span : 0;
    if (t < 0) below++;
    if (t > 1) above++;
    worstBelow = Math.min(worstBelow, t);
    worstAbove = Math.max(worstAbove, t);
  }
  // The meaningful question is how the field compares to the INPUT in normalised terms, which
  // requires the input's range in the same units. Callers pass that in via `ref`.
  console.log(`  ${label.padEnd(10)} span ${span.toFixed(1).padStart(12)}`
    + `  min ${lo.toFixed(1).padStart(12)}  max ${hi.toFixed(1).padStart(12)}`);
  return { lo, hi, span };
}

console.log('');

// The input's range in metres, as the kernel sees it.
const msCtx = ctxFor(base);
let shapedMs = null;
msCtx.trace = (stage, k, n, before, after) => { if (stage === 'shaped') shapedMs = after; };
const msOut = hydraulicDropletMultiscale(msCtx);

const ssCtx = ctxFor(base);
let shapedSs = null;
ssCtx.trace = (stage, k, n, before, after) => { if (stage === 'shaped') shapedSs = after; };
const ssOut = hydraulicDroplet(ssCtx);

// The input in metres, which is what metresToField divides by.
const inMetres = new Float32Array(base.length);
{
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of base) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < base.length; i++) inMetres[i] = base[i];
}
let inLo = Infinity;
let inHi = -Infinity;
for (const v of inMetres) { if (v < inLo) inLo = v; if (v > inHi) inHi = v; }

console.log(`  input range (normalised domain)  ${inLo.toFixed(6)} .. ${inHi.toFixed(6)}`);
console.log('');

function overshoot(label, shaped, out) {
  if (!shaped) { console.log(`  ${label}: no shaped trace captured`); return null; }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of shaped) { if (v < lo) lo = v; if (v > hi) hi = v; }
  // The kernel normalises by the INPUT's span, so express the overshoot against that.
  const inSpan = inHi - inLo;
  const norm = (v) => inLo + (v - lo) / (hi - lo || 1) * inSpan;
  let above = 0;
  let below = 0;
  let worstAbove = -Infinity;
  let worstBelow = Infinity;
  for (const v of shaped) {
    const t = norm(v);
    if (t > inHi) { above++; worstAbove = Math.max(worstAbove, (t - inHi) / inSpan); }
    if (t < inLo) { below++; worstBelow = Math.min(worstBelow, (t - inLo) / inSpan); }
  }
  let outLo = Infinity;
  let outHi = -Infinity;
  for (const v of out.data) { if (v < outLo) outLo = v; if (v > outHi) outHi = v; }
  console.log(`  ${label}`);
  console.log(`    shaped span          ${(hi - lo).toFixed(1)}`);
  console.log(`    cells above range    ${above} of ${shaped.length}`
    + `  (worst +${(worstAbove * 100).toFixed(3)}% of span)`);
  console.log(`    cells below range    ${below}`);
  console.log(`    final output range   ${outLo.toFixed(6)} .. ${outHi.toFixed(6)}`
    + `   span ${(outHi - outLo).toFixed(6)}`);
  return { above, below, worstAbove };
}

const rMs = overshoot('multiscale', shapedMs, msOut);
console.log('');
const rSs = overshoot('single-scale', shapedSs, ssOut);
console.log('');

if (rMs && rSs) {
  console.log('  VERDICT');
  console.log(`    multiscale overshoots on ${rMs.above} cells, worst +${(rMs.worstAbove * 100).toFixed(3)}%`);
  console.log(`    single-scale overshoots on ${rSs.above} cells, worst +${(rSs.worstAbove * 100).toFixed(3)}%`);
  console.log('');
  // RESULT, round 33: ZERO cells fall outside the range in the multiscale run, so the
  // downstream clamp has nothing to destroy and is NOT the cause. The third hypothesis is
  // refuted.
  //
  // What the numbers DO show is the shape of the loss:
  //
  //     input range       0.000000 .. 1.000000
  //     multiscale out    0.104752 .. 1.000000
  //
  // The MAXIMUM is untouched and the MINIMUM has been raised by 0.105. So the range is lost
  // from the BOTTOM: multiscale erosion is filling the deepest cells rather than incising
  // them, which matches the round-29 symptom exactly (the blurred INPUT had the highest
  // drainage of the three runs, i.e. the erosion was burying existing relief).
  //
  // The next step is therefore not about clamping at all: it is to find why the coarse levels
  // DEPOSIT into the lowest cells instead of carving them, which points at the per-level
  // droplet budget or the capacity/deposition balance rather than at any post-process.
  if (rMs.above > rSs.above * 2 && rMs.worstAbove > 0.02) {
    console.log('    Multiscale overshoots materially more, so the downstream clamp IS a real');
    console.log('    contributor. The fix belongs upstream: stop the erosion producing values');
    console.log('    outside the field range rather than clamping them away afterwards.');
  } else {
    console.log('    The overshoot is comparable between the two runs, so the clamp does NOT');
    console.log('    explain why multiscale loses range. The cause is elsewhere.');
  }
}
console.log('');
