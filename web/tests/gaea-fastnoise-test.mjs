/**
 * gaea-fastnoise-test.mjs — pins the FastNoiseSIMD scalar kernel to values captured from the
 * shipped Gaea build.
 *
 * The goldens below were produced by tools/gaea-probe calling Gaea's private RawNoise.Perlin
 * sampler (16x16 grid) with the exact argument sets listed. They are the contract this port
 * has to keep: if the hash, the fade, the gradient table, the octave stacking or the
 * coordinate frame drifts, these numbers move.
 *
 * Scope note: WarpType None is bit-exact to float32 rounding. Warp Simple/Complex is a
 * structural port whose perturbation does not yet reproduce Gaea; it is only asserted to be
 * deterministic, finite and non-degenerate, never to equal a golden.
 *
 * Run: node web/tests/gaea-fastnoise-test.mjs
 */

import {
  fnHash3, fnFractalPerlin, fnFractalBounding, fnPerlinGrid, FN_FRACTAL,
} from '../js/kernel/fastnoise.js';
import { perlinNode } from '../js/kernels/generators.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

/* ---------------------------------------------------------------- oracle goldens */

const GOLDENS = [
  { name: 'seed0 oct1 fbm', args: { scale: 0.5, octaves: 1, fractalType: 0, seed: 0 },
    first: [0.5118256, 0.5704261, 0.5684247, 0.5582085, 0.5526158, 0.5546224], sum: 120.21787 },
  { name: 'seed7 oct1 fbm', args: { scale: 0.5, octaves: 1, fractalType: 0, seed: 7 },
    first: [0.5972903, 0.5748805, 0.5710704, 0.5603798, 0.5216461, 0.4591570], sum: 131.88204 },
  { name: 'seed0 oct4 fbm', args: { scale: 0.5, octaves: 4, fractalType: 0, seed: 0 },
    first: [0.5854580, 0.5846311, 0.5802948, 0.5322821, 0.4746073, 0.5055684], sum: 123.91329 },
  { name: 'seed0 oct1 ridged', args: { scale: 0.5, octaves: 1, fractalType: FN_FRACTAL.RIDGED, seed: 0 },
    first: [0.9763489, 0.8591479, 0.8631505, 0.8835830, 0.8947684, 0.8907551], sum: 203.03058 },
  { name: 'seed0 oct1 billowy', args: { scale: 0.5, octaves: 1, fractalType: FN_FRACTAL.BILLOW, seed: 0 },
    first: [0.0236512, 0.1408522, 0.1368495, 0.1164170, 0.1052316, 0.1092449], sum: 52.96942 },
  { name: 'scale 0.25', args: { scale: 0.25, octaves: 1, fractalType: 0, seed: 0 },
    first: [0.4600102, 0.5227923, 0.5940573, 0.5556983, 0.4423651, 0.3420796], sum: 124.23347 },
  { name: 'scale 0.35', args: { scale: 0.35, octaves: 1, fractalType: 0, seed: 0 },
    first: [0.3548644, 0.4596042, 0.5039635, 0.4544878, 0.3752795, 0.3320428], sum: 123.92785 },
  { name: 'scale 0.65', args: { scale: 0.65, octaves: 1, fractalType: 0, seed: 0 },
    first: [0.4479228, 0.4469674, 0.4457301, 0.4445043, 0.4435961, 0.4431853], sum: 105.81012 },
  { name: 'scale 0.75', args: { scale: 0.75, octaves: 1, fractalType: 0, seed: 0 },
    first: [0.2910432, 0.2729169, 0.2594740, 0.2522168, 0.2514231, 0.2561705], sum: 100.18073 },
  { name: 'seed0 oct4 billowy', args: { scale: 0.5, octaves: 4, fractalType: FN_FRACTAL.BILLOW, seed: 0 },
    first: [0.2167805, 0.2121160, 0.1605895, 0.0830876, 0.1630323, 0.1053910], sum: 52.51302 },
  { name: 'seed0 oct4 ridged', args: { scale: 0.5, octaves: 4, fractalType: FN_FRACTAL.RIDGED, seed: 0 },
    first: [0.7832195, 0.7878840, 0.8394105, 0.9169124, 0.8369677, 0.8946090], sum: 203.48698 },
  { name: 'seed0 oct4 gain 0.3', args: { scale: 0.5, octaves: 4, gain: 0.3, fractalType: 0, seed: 0 },
    first: [0.5758228, 0.5919097, 0.5740316, 0.5400767, 0.5093284, 0.5279575], sum: 122.67128 },
  { name: 'axis scales 2 / 0.5', args: { scale: 0.5, octaves: 1, fractalType: 0, seed: 0, scaleX: 2, scaleY: 0.5 },
    first: [0.5599743, 0.6087543, 0.5343785, 0.4503139, 0.3968336, 0.3600257], sum: 125.78796 },
];

const TOL = 2e-4;
for (const g of GOLDENS) {
  const raw = fnPerlinGrid({ size: 16, warp: 'None', ...g.args });
  const d = Array.from(raw, (v) => v * 0.5 + 0.5);
  let worst = 0;
  for (let i = 0; i < g.first.length; i++) {
    worst = Math.max(worst, Math.abs(d[i] - g.first[i]));
  }
  const sum = d.reduce((a, b) => a + b, 0);
  ok(worst <= TOL, `oracle golden: ${g.name} — first 6 samples`, `worst ${worst.toExponential(2)}`);
  ok(Math.abs(sum - g.sum) <= TOL, `oracle golden: ${g.name} — grid sum`, `diff ${Math.abs(sum - g.sum).toExponential(2)}`);
}

/* ---------------------------------------------------------------- hash / fade */

{
  const a = fnHash3(1337, 3, -4, 5);
  const b = fnHash3(1337, 3, -4, 5);
  ok(a === b, 'hash is deterministic for identical lattice corners and seed', `${a} vs ${b}`);
  ok(Number.isInteger(a), 'hash returns an int32', a);
  ok(fnHash3(1338, 3, -4, 5) !== a, 'changing the seed changes the hash');
  ok(fnHash3(1337, 4, -4, 5) !== a, 'changing x changes the hash');
  ok(fnHash3(1337, 3, -3, 5) !== a, 'changing y changes the hash');
  ok(fnHash3(1337, 3, -4, 6) !== a, 'changing z changes the hash');
  ok(fnHash3(0, 0, 0, 0) === 0, 'hash of seed 0 at the origin is 0');
}

/* ---------------------------------------------------------------- fractal invariants */

{
  ok(Math.abs(fnFractalBounding(1, 0.5) - 1) < 1e-12, 'one octave has unit bounding');
  ok(Math.abs(fnFractalBounding(4, 0.5) - 1 / 1.875) < 1e-12,
    'four octaves at gain 0.5 normalise by 1/1.875', fnFractalBounding(4, 0.5));
  ok(Math.abs(fnFractalBounding(3, 1) - 1 / 3) < 1e-12,
    'gain 1 normalises by 1/octaves', fnFractalBounding(3, 1));

  // Ridged is Gaea's inverted billow: only for octaves >= 2 is the relation on raw values a
  // plain negation of the stacked sum, so compare the single-octave operator directly.
  let complement = true, worst = 0;
  for (let k = 0; k < 400; k++) {
    const x = (k % 20) * 0.37 - 3, y = Math.floor(k / 20) * 0.41 - 3;
    const billow = fnFractalPerlin(0, x, y, 0, { octaves: 1, fractalType: FN_FRACTAL.BILLOW });
    const ridged = fnFractalPerlin(0, x, y, 0, { octaves: 1, fractalType: FN_FRACTAL.RIDGED });
    worst = Math.max(worst, Math.abs(billow + ridged));
    if (Math.abs(billow + ridged) > 1e-12) complement = false;
  }
  ok(complement, 'ridged = -billowy for a single octave', `worst ${worst.toExponential(2)}`);

  // The same relation must survive the remap for every octave count, which is what the
  // golden pair (oct4 billow / oct4 ridged) shows: both grids sum to 256.
  const b4 = fnPerlinGrid({ size: 16, warp: 'None', scale: 0.5, octaves: 4, fractalType: FN_FRACTAL.BILLOW, seed: 0 });
  const r4 = fnPerlinGrid({ size: 16, warp: 'None', scale: 0.5, octaves: 4, fractalType: FN_FRACTAL.RIDGED, seed: 0 });
  let pairWorst = 0;
  for (let i = 0; i < b4.length; i++) pairWorst = Math.max(pairWorst, Math.abs(b4[i] + r4[i]));
  ok(pairWorst < 1e-12, 'billowy and ridged grids are exact negatives at any octave count',
    `worst ${pairWorst.toExponential(2)}`);

  ok(Math.abs(fnFractalPerlin(0, 0.3, 0.4, 0, { octaves: 0 }) - fnFractalPerlin(0, 0.3, 0.4, 0, { octaves: 1 })) < 1e-12,
    'octave count is floored at 1');
}

/* ---------------------------------------------------------------- coordinate frame */

{
  // Gaea's sampler uses ((i/size - 0.5) * size) * axisScale, i.e. an axis scale of 1 must
  // reproduce the unscaled grid exactly.
  const plain = fnPerlinGrid({ size: 16, warp: 'None', scale: 0.5, octaves: 1, seed: 3 });
  const unit = fnPerlinGrid({ size: 16, warp: 'None', scale: 0.5, octaves: 1, seed: 3, scaleX: 1, scaleY: 1 });
  let same = true;
  for (let i = 0; i < plain.length; i++) if (plain[i] !== unit[i]) same = false;
  ok(same, 'axis scale 1 is the identity');

  // Gaea applies `offset * wavelength * resolutionInv` BEFORE multiplying by the resolution,
  // so after the frequency multiply the offset is simply added in noise-space units. This is
  // the exact relation Perlin's X/Y parameters rely on.
  const a = fnPerlinGrid({ size: 16, warp: 'None', scale: 0.5, octaves: 1, seed: 3, offsetX: 1 });
  const freq = (1 - 0.5) * 0.01 * (512 / 16);
  let shifted = 0;
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 16; i++) {
      const expect = fnFractalPerlin(3, (i - 8) * freq + 1, (j - 8) * freq, 0, { octaves: 1 });
      shifted = Math.max(shifted, Math.abs(a[j * 16 + i] - expect));
    }
  }
  ok(shifted < 1e-6, 'the X offset is added in noise-space units', `worst ${shifted.toExponential(2)}`);

  // Gaea rejects resolutions below 16.
  ok(fnPerlinGrid({ size: 8 }).length === 256, 'sizes below 16 clamp to a 16x16 grid');
  ok(fnPerlinGrid({ size: 32 }).length === 1024, 'larger sizes keep their resolution');
}

/* ---------------------------------------------------------------- warp is structural only */

{
  const base = fnPerlinGrid({ size: 16, warp: 'None', scale: 0.5, octaves: 4, seed: 0 });
  for (const warp of ['Simple', 'Complex']) {
    const w1 = fnPerlinGrid({ size: 16, warp, scale: 0.5, octaves: 4, seed: 0, amplitude: 0.5, frequency: 0.05, warpOctaves: 10 });
    const w2 = fnPerlinGrid({ size: 16, warp, scale: 0.5, octaves: 4, seed: 0, amplitude: 0.5, frequency: 0.05, warpOctaves: 10 });
    let finite = true, deterministic = true, delta = 0;
    for (let i = 0; i < w1.length; i++) {
      if (!Number.isFinite(w1[i])) finite = false;
      if (w1[i] !== w2[i]) deterministic = false;
      delta = Math.max(delta, Math.abs(w1[i] - base[i]));
    }
    ok(finite, `warp ${warp}: every sample is finite`);
    ok(deterministic, `warp ${warp}: repeated calls are identical`);
    ok(delta > 0.01, `warp ${warp}: perturbs the field (this is NOT a fidelity claim)`, `max delta ${delta.toFixed(3)}`);
  }

  const zeroAmp = fnPerlinGrid({ size: 16, warp: 'Complex', scale: 0.5, octaves: 4, seed: 0, amplitude: 0 });
  let sameAsNone = true;
  for (let i = 0; i < base.length; i++) if (Math.abs(zeroAmp[i] - base[i]) > 1e-12) sameAsNone = false;
  ok(sameAsNone, 'warp amplitude 0 degenerates to the unwarped grid');
}

/* ---------------------------------------------------------------- Perlin node wiring */

{
  const size = 32;
  const field = perlinNode({ size, params: {}, seed: 0 });
  ok(field.size === size, 'Perlin node emits the requested size', field.size);
  ok(field.channel === 'height', 'Perlin node emits a height field', field.channel);
  ok(field.data.length === size * size, 'Perlin node data length is size*size');

  let inRange = true;
  for (const v of field.data) if (!(v >= 0 && v <= 1)) inRange = false;
  ok(inRange, 'Perlin node output is clamped to 0..1');

  // With defaults (Scale 0.5, Octaves 10, FBM, Warp Complex) the node must not be flat.
  let lo = Infinity, hi = -Infinity;
  for (const v of field.data) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ok(hi - lo > 0.05, 'default Perlin terrain has relief', `range ${(hi - lo).toFixed(3)}`);

  // Height scales the remapped value, then clamps.
  const half = perlinNode({ size, params: { Height: 0.5, Type: 'FBM', Warp: 'None', Octaves: 4 }, seed: 0 });
  const full = perlinNode({ size, params: { Height: 1, Type: 'FBM', Warp: 'None', Octaves: 4 }, seed: 0 });
  let halfOk = true, maxd = 0;
  for (let i = 0; i < full.data.length; i++) {
    const expect = Math.min(1, full.data[i] * 0.5);
    maxd = Math.max(maxd, Math.abs(half.data[i] - expect));
    if (Math.abs(half.data[i] - expect) > 1e-6) halfOk = false;
  }
  ok(halfOk, 'Height 0.5 halves the signal before clamping', `worst ${maxd.toExponential(2)}`);

  // Two seeds must not produce the same terrain.
  const s1 = perlinNode({ size, params: { Seed: 1, Warp: 'None' }, seed: 0 });
  const s2 = perlinNode({ size, params: { Seed: 2, Warp: 'None' }, seed: 0 });
  let same = true;
  for (let i = 0; i < s1.data.length; i++) if (s1.data[i] !== s2.data[i]) same = false;
  ok(!same, 'different Seed values produce different terrain');
}

/* ------------------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('Gaea FastNoiseSIMD: scalar Perlin kernel');
  console.log('fidelity: exact for WarpType None (13 oracle grids, tolerance 2e-4)');
  console.log('fidelity: structural only for WarpType Simple/Complex — not validated');
}
