/**
 * gaea-voronoi-test.mjs — pins the FastNoiseSIMD cellular kernel behind Gaea's Voronoi node.
 *
 * Goldens come from tools/gaea-probe calling Gaea's private RawNoise.Voronoi sampler with the
 * argument sets listed (16x16 and 64x64 grids). They cover:
 *   - all three distance functions (Euclidean / Manhattan / Natural);
 *   - every distance-combining form (R = F1, P = F2, A = add, S = sub, M = mul, D = div);
 *   - the cell-value form (C) at low jitter, where the nearest cell is unambiguous;
 *   - jitter 0, arbitrary seeds, non-integer wavelengths and all four one-cell offsets.
 *
 * Tolerances are 5e-4 per sample (the port sits ~2e-5 from float32) and 5e-4 per sample on the
 * grid sum, which catches a systematically shifted grid without tripping on accumulated rounding.
 *
 * Known limits, deliberately not asserted as goldens:
 *   - C at jitter >= 0.85: Gaea's normalized jitter direction differs from the recovered
 *     10-bit-slice formula by enough to flip near-ties between cells (1 pixel in 256 at
 *     jitter 1, worst error 0.13);
 *   - form N (NoiseLookup) needs PerlinFractal lookups and is not implemented;
 *   - Warp Simple/Complex is a structural port, never compared to a golden.
 *
 * Run: node web/tests/gaea-voronoi-test.mjs
 */

import {
  fnCellHash, fnCellValue, fnCellDir, fnCellular3, fnVoronoiGrid,
  FN_CELLULAR_RETURN, FN_CELLULAR_DISTANCE,
} from '../js/kernel/fastnoise.js';
import { voronoi } from '../js/kernels/generators.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

const TOL = 5e-4;

/* ---------------------------------------------------------------- oracle goldens */

const GOLDENS = [
  { name: "16 P euclidean j0.45", size: 16, args: { scale: 50, jitter: 0.45, distanceFunction: 0, returnType: 2 },
    first: [0.79795486, 1.068198, 0.743973, 0.76041436, 0.81155914, 0.7383964], sum: 205.30884 },
  { name: "16 R euclidean j0.45", size: 16, args: { scale: 50, jitter: 0.45, distanceFunction: 0, returnType: 1 },
    first: [0.60126567, 0.6012495, 0.60123515, 0.60127175, 0.601251, 0.6012737], sum: 153.92176 },
  { name: "16 C euclidean j0.45", size: 16, args: { scale: 50, jitter: 0.45, distanceFunction: 0, returnType: 0 },
    first: [0.25390625, 0.3625784, 0.05669403, 0.05589771, 0.6503296, 0.6542845], sum: 131.23193 },
  { name: "16 C euclidean j0", size: 16, args: { scale: 50, jitter: 0, distanceFunction: 0, returnType: 0 },
    first: [0.25390625, 0.3625784, 0.05669403, 0.05589771, 0.6503296, 0.6542845], sum: 131.23193 },
  { name: "16 P manhattan", size: 16, args: { scale: 50, jitter: 0.45, distanceFunction: 1, returnType: 2 },
    first: [1.0659207, 1.3384001, 0.9676205, 0.980052, 1.0641234, 1.0053585], sum: 267.90389 },
  { name: "16 P natural", size: 16, args: { scale: 50, jitter: 0.45, distanceFunction: 2, returnType: 2 },
    first: [0.83723766, 1.4527544, 0.72817355, 0.75002486, 0.8515156, 0.7409513], sum: 219.01265 },
  { name: "16 P seed 7", size: 16, args: { scale: 50, jitter: 0.45, distanceFunction: 0, returnType: 2, seed: 7 },
    first: [0.78091115, 0.72746134, 0.7422408, 0.65542066, 0.7773317, 0.7347381], sum: 203.55488 },
  { name: "16 P scale 100", size: 16, args: { scale: 100, jitter: 0.45, distanceFunction: 0, returnType: 2 },
    first: [0.74038863, 0.8458626, 0.8170495, 0.85916495, 0.8972465, 0.6985364], sum: 206.86384 },
  { name: "64 P euclidean", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 2 },
    first: [0.59144574, 0.58781457, 0.5866195, 0.58860075, 0.5908261, 0.59329563], sum: 2706.2974 },
  { name: "64 P manhattan", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 1, returnType: 2 },
    first: [0.8701038, 0.8622913, 0.8544788, 0.8466663, 0.8388538, 0.8369789], sum: 3815.15692 },
  { name: "64 P natural", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 2, returnType: 2 },
    first: [0.5676888, 0.5636289, 0.5598555, 0.5569444, 0.55979383, 0.5628773], sum: 2666.2819 },
  { name: "64 A euclidean", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 3 },
    first: [0.6748352, 0.67269695, 0.67104703, 0.6698854, 0.669212, 0.66902685], sum: 3049.79463 },
  { name: "64 S euclidean", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 4 },
    first: [0.5080562, 0.50293213, 0.502192, 0.5073161, 0.5124402, 0.51756436], sum: 2362.80018 },
  { name: "64 M euclidean", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 5 },
    first: [0.5152512, 0.51490784, 0.51462615, 0.51440376, 0.51423895, 0.5141308], sum: 2161.4118 },
  { name: "64 D euclidean", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 6 },
    first: [0.95595074, 0.9833051, 0.987347, 0.95871305, 0.9315162, 0.9058672], sum: 3216.8087 },
  { name: "64 R manhattan j0", size: 64, args: { scale: 0.1953125, jitter: 0, distanceFunction: 1, returnType: 1 },
    first: [1, 0.9921875, 0.984375, 0.9765625, 0.96875, 0.9609375], sum: 3072 },
  { name: "64 R natural j0", size: 64, args: { scale: 0.1953125, jitter: 0, distanceFunction: 2, returnType: 1 },
    first: [0.75, 0.7385235, 0.7275238, 0.7169895, 0.7069092, 0.69727135], sum: 2261.5 },
  { name: "64 R manhattan j0.45", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 1, returnType: 1 },
    first: [0.7979164, 0.8057289, 0.8135414, 0.8213539, 0.8291664, 0.8310413], sum: 3318.03507 },
  { name: "64 R natural j0.45", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 2, returnType: 1 },
    first: [0.5496862, 0.55190206, 0.5543176, 0.55635726, 0.5531227, 0.5501403], sum: 2285.81495 },
  { name: "64 offset origin", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 1 },
    first: [0.58338946, 0.58488244, 0.58442754, 0.58128464, 0.5783859, 0.5757313], sum: 2391.49723 },
  { name: "64 offset +1x", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 1, offsetX: 1 },
    first: [0.63556135, 0.6412624, 0.6472077, 0.6533971, 0.6598306, 0.6665082], sum: 2590.81056 },
  { name: "64 offset +1y", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 1, offsetY: 1 },
    first: [0.6340575, 0.6318596, 0.626573, 0.6215306, 0.61673236, 0.6121782], sum: 2665.11218 },
  { name: "64 offset -1x", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 1, offsetX: -1 },
    first: [0.7908106, 0.8010477, 0.811529, 0.8222544, 0.83322394, 0.84443766], sum: 2759.30341 },
  { name: "64 offset -1y", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 1, offsetY: -1 },
    first: [0.6433242, 0.65111375, 0.6591475, 0.6674254, 0.6759474, 0.6808669], sum: 2704.17513 },
  { name: "64 offset origin seed 7", size: 64, args: { scale: 0.1953125, jitter: 0.45, distanceFunction: 0, returnType: 1, seed: 7 },
    first: [0.6465871, 0.6458867, 0.6454305, 0.64521843, 0.64525056, 0.64552677], sum: 2700.91081 },
];

for (const g of GOLDENS) {
  const grid = fnVoronoiGrid({ size: g.size, warp: 'None', ...g.args });
  let worst = 0;
  for (let i = 0; i < g.first.length; i++) worst = Math.max(worst, Math.abs(grid[i] - g.first[i]));
  const sum = grid.reduce((a, b) => a + b, 0);
  ok(worst <= TOL, `oracle golden: ${g.name} — first 6 samples`, `worst ${worst.toExponential(2)}`);
  ok(Math.abs(sum - g.sum) <= TOL * grid.length, `oracle golden: ${g.name} — grid sum`, `diff ${Math.abs(sum - g.sum).toExponential(2)}`);
}

/* ---------------------------------------------------------------- cellular primitives */

{
  const a = fnCellHash(7, 3, -4, 5);
  ok(a === fnCellHash(7, 3, -4, 5), 'cell hash is deterministic', a);
  ok(Number.isInteger(a), 'cell hash returns an int32', a);
  ok(fnCellHash(8, 3, -4, 5) !== a, 'cell hash reacts to the seed');
  ok(fnCellHash(7, 4, -4, 5) !== a, 'cell hash reacts to x');
  ok(fnCellHash(7, 3, -3, 5) !== a, 'cell hash reacts to y');
  ok(fnCellHash(7, 3, -4, 6) !== a, 'cell hash reacts to z');

  let inRange = true;
  for (let k = 0; k < 500; k++) {
    const v = fnCellValue(3, k % 13 - 6, Math.floor(k / 13) - 9, 0);
    if (!(v >= -1 && v < 1)) inRange = false;
  }
  ok(inRange, 'cell value stays in [-1, 1)');

  let unit = true, worstLen = 0;
  for (let k = 0; k < 200; k++) {
    const d = fnCellDir(5, k % 17 - 8, Math.floor(k / 17) - 5, 1);
    const len = Math.hypot(d[0], d[1], d[2]);
    worstLen = Math.max(worstLen, Math.abs(len - 1));
    if (Math.abs(len - 1) > 1e-12) unit = false;
  }
  ok(unit, 'jitter direction is a unit vector', `worst ${worstLen.toExponential(2)}`);
}

{
  // With jitter 0 the nearest site is the containing lattice node: at integer samples the
  // Euclidean distance is exactly zero and the cell value is the node's own ValCoord.
  const v = fnCellular3(11, 4, -7, 0, { jitter: 0, returnType: FN_CELLULAR_RETURN.DISTANCE });
  ok(v === 0, 'jitter 0 puts a site exactly on the lattice node', v);
  const c = fnCellular3(11, 4, -7, 0, { jitter: 0, returnType: FN_CELLULAR_RETURN.CELL });
  ok(Math.abs(c - fnCellValue(11, 4, -7, 0)) < 1e-12, 'jitter 0 reports the containing cell', c);

  const d = fnCellular3(11, 4.2, -6.9, 0.1, { jitter: 0.45, returnType: FN_CELLULAR_RETURN.DISTANCE });
  const p = fnCellular3(11, 4.2, -6.9, 0.1, { jitter: 0.45, returnType: FN_CELLULAR_RETURN.DISTANCE2 });
  ok(p >= d && d > 0, 'F2 is never smaller than F1', `F1 ${d} F2 ${p}`);
}

/* ---------------------------------------------------------------- sampler frame */

{
  const plain = fnVoronoiGrid({ size: 32, scale: 20, jitter: 0.45, returnType: 2, seed: 1 });
  const unit = fnVoronoiGrid({ size: 32, scale: 20, jitter: 0.45, returnType: 2, seed: 1, scaleX: 1, scaleY: 1 });
  let same = true;
  for (let i = 0; i < plain.length; i++) if (plain[i] !== unit[i]) same = false;
  ok(same, 'axis scale 1 is the identity for Voronoi');

  const small = fnVoronoiGrid({ size: 4, scale: 20, returnType: 2 });
  ok(small.length === 16 * 16, 'grid size is clamped to 16', small.length);

  const a = fnVoronoiGrid({ size: 16, scale: 20, returnType: 2 });
  const b = fnVoronoiGrid({ size: 16, scale: 20, returnType: 2, offsetX: 1 });
  let differs = false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) differs = true;
  ok(differs, 'a one-wavelength offset is not a no-op');

  const s1 = fnVoronoiGrid({ size: 16, scale: 20, returnType: 2, seed: 1 });
  const s2 = fnVoronoiGrid({ size: 16, scale: 20, returnType: 2, seed: 2 });
  differs = false;
  for (let i = 0; i < s1.length; i++) if (Math.abs(s1[i] - s2[i]) > 1e-6) differs = true;
  ok(differs, 'changing the seed changes the Voronoi grid');
}

/* ---------------------------------------------------------------- node wiring */

{
  const ctx = (params, seed = 0, size = 32) => ({ size, params, seed });
  const base = { Scale: 0.5, Jitter: 0.45, Function: 'Euclidean', Form: 'P', Type: 'None' };
  const a = voronoi(ctx({ ...base })).data;
  ok(a.length === 32 * 32, 'voronoi node emits a size*size field', a.length);

  {
    let mn = Infinity, mx = -Infinity;
    for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
    ok(Math.abs(mn) < 1e-6 && Math.abs(mx - 1) < 1e-6, 'node normalises the sampler grid to [0,1]', `[${mn}, ${mx}]`);
  }
  {
    let inside = true;
    for (const form of ['C', 'R', 'P', 'A', 'S', 'M', 'D']) {
      const g = voronoi(ctx({ ...base, Form: form })).data;
      for (const v of g) if (!(v >= 0 && v <= 1)) { inside = false; break; }
    }
    ok(inside, 'every form lands inside [0,1] after normalisation');
  }

  const r = voronoi(ctx({ ...base, Form: 'R' })).data;
  const c = voronoi(ctx({ ...base, Form: 'C' })).data;
  let pVsR = false, rVsC = false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - r[i]) > 1e-6) pVsR = true;
    if (Math.abs(r[i] - c[i]) > 1e-6) rVsC = true;
  }
  ok(pVsR, 'form P and form R produce different fields');
  ok(rVsC, 'form R and form C produce different fields');

  const legacy = voronoi(ctx({ ...base, Scale: 50 })).data;
  let same = true;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - legacy[i]) > 1e-6) same = false;
  ok(same, 'legacy 0-100 Scale is converted to the 0-1 control');

  const gainA = voronoi(ctx({ ...base, Gain: 0.2 })).data;
  const gainB = voronoi(ctx({ ...base, Gain: 0.9 })).data;
  same = true;
  for (let i = 0; i < a.length; i++) if (Math.abs(gainA[i] - gainB[i]) > 1e-12) same = false;
  ok(same, 'Gain does not reach RawNoise and therefore has no effect');

  const clamped = voronoi(ctx({ ...base, Clamp: 0.5 })).data;
  let scaleOk = true;
  for (let i = 0; i < a.length; i++) if (Math.abs(clamped[i] - a[i] * 0.5) > 1e-6) scaleOk = false;
  ok(scaleOk, 'Clamp below 1 multiplies the raw output');

  const xA = voronoi(ctx({ ...base, X: 0.5 })).data;
  const xB = voronoi(ctx({ ...base, X: 0.25 })).data;
  let xDiffers = false;
  for (let i = 0; i < a.length; i++) if (Math.abs(xA[i] - xB[i]) > 1e-6) xDiffers = true;
  ok(xDiffers, 'X shifts the pattern');

  const seedA = voronoi(ctx({ ...base }, 1)).data;
  const seedB = voronoi(ctx({ ...base }, 2)).data;
  let seedDiffers = false;
  for (let i = 0; i < a.length; i++) if (Math.abs(seedA[i] - seedB[i]) > 1e-6) seedDiffers = true;
  ok(seedDiffers, 'the node seed reaches the kernel');
}

report();

function report() {
  for (const f of failures) console.log('FAIL', f);
  console.log(`${failures.length ? 'FAIL' : 'PASS'} ${pass} / ${failures.length}`);
  if (failures.length) process.exitCode = 1;
}
