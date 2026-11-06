/**
 * gaea-erosion-schedule-test.mjs — the budget/level/iteration schedule recovered from
 * `FUN_1801f24f0` in `Gaea.Native.dll`.
 *
 * The kernel itself (droplet step, relaxation, flow gate) already has its own tests. What did
 * not exist before is the thing that decides HOW MUCH of it runs, and earlier versions of the
 * solver admitted in comments that it was a hand-tuned guess. These assertions pin the
 * recovered formulas so a later edit cannot quietly drift back onto a guess.
 *
 * Run: node web/tests/gaea-erosion-schedule-test.mjs
 */

import {
  gaeaErosionScaleRemap, gaeaPyramidDepth, gaeaPyramidDepthExact, gaeaDropletsPerIteration,
  gaeaDetailScale, gaeaLevelCurve, gaeaLevelIterations,
  K_SCALE_RATIO_KNEE, K_SCALE_RATIO_GAIN, K_SCALE_RATIO_CURVE,
  K_PYRAMID_LEVEL_CAP, K_DETAIL_SCALE_FALLBACK,
  K_CURVE_THRESHOLD, K_CURVE_RATE, K_CURVE_EXPO, GAEA_LEVEL_CURVES,
} from '../js/kernels/erosion.js';

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

function near(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

function section(t) { console.log(`\n== ${t}`); }

/* --------------------------------------------------- 1. the float32 constants */

section('constants carry the bytes from the image');
{
  // 0x3e4ccccd, 0x40c00000, 0x3e2aaaab, 0x42c80000.
  ok(K_SCALE_RATIO_KNEE === Math.fround(0.2), 'the remap knee is float32(0.2)',
    K_SCALE_RATIO_KNEE);
  ok(K_SCALE_RATIO_GAIN === 6.0, 'the knee slope is 6.0');
  ok(K_SCALE_RATIO_CURVE === Math.fround(1 / 6), 'the knee height is float32(1/6)',
    K_SCALE_RATIO_CURVE);
  ok(K_DETAIL_SCALE_FALLBACK === 100.0, 'the detail fallback is 100.0');
  ok(K_PYRAMID_LEVEL_CAP === 31, 'the level cap is 31 (0x1f)');
}

/* -------------------------------------------------------- 2. Erosion Scale remap */

section('Erosion Scale remap');
{
  // Below the knee the value passes through untouched. This is the common case for a normal
  // Erosion Scale on a normal terrain, so it must be exact, not merely close.
  ok(gaeaErosionScaleRemap(100, 20000) === 100, 'a ratio below the knee is unchanged');
  ok(gaeaErosionScaleRemap(4000, 20000) === 4000, 'a ratio exactly at the knee is unchanged',
    gaeaErosionScaleRemap(4000, 20000));

  // The knee is C0 and C1: value and slope match the identity at the boundary. Measuring it
  // needs care. A one-sided difference above the knee reads 0.994 at h = 1e-3 and 0.999997 at
  // h = 1e-6, because the curve's second derivative jumps at the knee (0 on the identity side,
  // -12 on the curved side), so the error is O(h) no matter how the difference is centred.
  // h = 1e-8 puts the truncation error at ~3e-8 while the subtraction stays exact in doubles.
  const at = (r, width) => gaeaErosionScaleRemap(r * width, width);
  const slopeBelow = (at(0.2, 1000) - at(0.2 - 1e-3, 1000)) / (1e-3 * 1000);
  const h = 1e-8;
  const slopeAbove = (at(0.2 + h, 1000) - at(0.2 - h, 1000)) / (2 * h * 1000);
  ok(near(slopeBelow, 1, 1e-6), 'slope below the knee is 1', slopeBelow);
  ok(near(slopeAbove, 1, 1e-6), 'slope at the knee is 1 (continuous derivative)',
    slopeAbove);

  // Above the knee the ratio saturates at 0.2 + 1/6, so the returned scale grows only with
  // terrainWidth. This is what keeps a huge Erosion Scale from exploding the pyramid.
  const huge = gaeaErosionScaleRemap(1e9, 1000);
  ok(near(huge / 1000, K_SCALE_RATIO_KNEE + K_SCALE_RATIO_CURVE, 1e-5),
    'a huge scale saturates at 0.2 + 1/6 of the terrain width', huge / 1000);

  // Monotone, so a larger parameter can never mean less erosion.
  let monotone = true;
  let prev = -Infinity;
  for (let s = 0; s <= 20000; s += 250) {
    const v = gaeaErosionScaleRemap(s, 10000);
    if (!(v >= prev)) { monotone = false; break; }
    prev = v;
  }
  ok(monotone, 'the remap is monotone over the whole parameter range');

  ok(gaeaErosionScaleRemap(500, 0) === 500, 'a zero terrain width is a no-op, not a divide by zero');
}

/* --------------------------------------------------------------- 3. pyramid depth */

section('pyramid depth');
{
  // ceil(sqrt(0.5 * scale * width / terrainWidth)). Scale 200 at terrain width 1000 sits
  // exactly on the remap knee, so the value is untouched and the arithmetic stays exact:
  // 0.5 * 200 * 100 / 1000 = 10 -> sqrt = 3.1623 -> ceil = 4.
  ok(gaeaPyramidDepth({ erosionScale: 200, terrainWidth: 1000, width: 100 }) === 4,
    'the depth is ceil(sqrt(0.5*scale*width/terrainWidth))',
    gaeaPyramidDepth({ erosionScale: 200, terrainWidth: 1000, width: 100 }));

  // Same pixel count on a wider terrain -> FEWER levels, because each pixel spans more world
  // units. Scale 100 stays below the knee on both, so the comparison is the raw expression.
  const narrow = gaeaPyramidDepth({ erosionScale: 100, terrainWidth: 1000, width: 100 });
  const wide = gaeaPyramidDepth({ erosionScale: 100, terrainWidth: 8000, width: 100 });
  ok(wide < narrow, 'a wider terrain gives fewer levels at equal pixel count',
    `${narrow} vs ${wide}`);

  // Degenerate inputs must not produce 0, NaN or Infinity levels.
  ok(gaeaPyramidDepth({ erosionScale: 1000, terrainWidth: 0, width: 0 }) === 1,
    'degenerate geometry still yields at least one level');
  ok(gaeaPyramidDepth({ erosionScale: 20000, terrainWidth: 1, width: 4096 }) <= K_PYRAMID_LEVEL_CAP,
    'the level count is capped at 31');
  ok(gaeaPyramidDepth({ erosionScale: 20000, terrainWidth: 1, width: 4096 }) >= 1,
    'the level count is never below one');
}

/* ------------------------------------------------------- 4. droplets and detail */

section('droplets per iteration and detail scale');
{
  ok(gaeaDropletsPerIteration(16, 16) === 1, '256 cells is exactly one droplet');
  ok(gaeaDropletsPerIteration(128, 128) === 64, '128^2 is 64 droplets');
  ok(gaeaDropletsPerIteration(1023, 1) === 3, 'the shift rounds down (1023 >> 8 = 3)');
  ok(gaeaDropletsPerIteration(255, 255) === 254, '255^2 >> 8 rounds down', gaeaDropletsPerIteration(255, 255));

  // Duration is not an argument. That is the point of the recovery: it never sets droplets.
  ok(gaeaDropletsPerIteration.length === 2, 'the droplet count takes only the resolution');

  ok(gaeaDetailScale(0) === K_DETAIL_SCALE_FALLBACK, 'zero detail scale falls back to 100');
  ok(near(gaeaDetailScale(4), 0.5), 'detail scale 4 gives sqrt(1/4) = 0.5', gaeaDetailScale(4));
  ok(gaeaDetailScale(1) === 1, 'detail scale 1 is unchanged');
}

/* ------------------------------------------------------------ 5. the level curve */

section('level curve (FUN_1801f0350)');
{
  // Defaults are the call-site 1 register values: thr = 2.5, rate = 0.75, expo = 0.5, flag = 1.
  ok(K_CURVE_THRESHOLD === 2.5, 'the iteration curve threshold is 2.5');
  ok(K_CURVE_RATE === 0.75, 'the iteration curve rate is 0.75');
  ok(K_CURVE_EXPO === 0.5, 'the iteration curve exponent is 0.5');
  ok(GAEA_LEVEL_CURVES.iterations.flag === 1, 'only the iteration call passes flag = 1');

  // `t` is the level COUNT, not the level index. With t = 22.36, level 0 keeps
  // u = frac(22.36) = 0.36 and v clamps to 0, so the result is exactly that fraction.
  const t = 22.36;
  ok(near(gaeaLevelCurve(0, { t }), 0.36, 1e-9), 'level 0 returns frac(t)', gaeaLevelCurve(0, { t }));
  ok(gaeaLevelCurve(0, { t, flag: 0 }) === 1,
    'flag 0 forces u = 1, so level 0 returns 1', gaeaLevelCurve(0, { t, flag: 0 }));

  // Levels 1, 2 and 3 are still inside the gate: `v = level - (1 - frac(t)) - thr` stays at 0
  // up to `level = 3.14`, so those three sit exactly on 1.
  ok(gaeaLevelCurve(1, { t }) === 1, 'level 1 sits on 1', gaeaLevelCurve(1, { t }));
  ok(gaeaLevelCurve(2, { t }) === 1, 'level 2 sits on 1', gaeaLevelCurve(2, { t }));
  ok(gaeaLevelCurve(3, { t }) === 1, 'level 3 still sits on the plateau (v = -0.14 -> 0)',
    gaeaLevelCurve(3, { t }));

  // Level 4 is the first to clear the gate: v = 4 - 0.64 - 2.5 = 0.86. Above it the curve
  // decays, because expo 0.5 raised to a positive `res` is a falling power.
  const l4 = gaeaLevelCurve(4, { t });
  const expected4 = Math.pow(0.5, (Math.exp(-0.86 * 0.75) - 1) / 0.75 + 0.86);
  ok(near(l4, expected4, 1e-12), 'level 4 matches the closed form', `${l4} vs ${expected4}`);
  ok(l4 < 1 && l4 > 0.8, 'level 4 is the first level below 1', l4);

  let prev = l4;
  let falling = true;
  for (let lv = 4; lv <= 31; lv++) {
    const v = gaeaLevelCurve(lv, { t });
    if (!(v <= prev)) { falling = false; break; }
    prev = v;
  }
  ok(falling, 'the curve never rises once it starts falling');

  // Coarse levels are effectively switched off: they still run (ceil gives at least 1) but the
  // weight is several orders of magnitude down, which is the whole point of the gate.
  ok(gaeaLevelCurve(20, { t }) < 1e-4, 'level 20 is effectively zero', gaeaLevelCurve(20, { t }));
  ok(gaeaLevelCurve(20, { t }) > 0, 'but never negative', gaeaLevelCurve(20, { t }));

  // expo = 1 neutralises the power stage, leaving just the gate: 1 everywhere from level 1 up.
  ok(gaeaLevelCurve(12, { t, expo: 1 }) === 1, 'expo 1 leaves the gate alone',
    gaeaLevelCurve(12, { t, expo: 1 }));

  // Decoding the other three call sites: the exponents are 0.6, 0.4 and 2.0.
  ok(GAEA_LEVEL_CURVES.downcutting.expo === 0.6 && GAEA_LEVEL_CURVES.downcutting.rate === 1.2,
    'the downcutting curve is (thr 1, rate 1.2, expo 0.6)');
  ok(GAEA_LEVEL_CURVES.shape.expo === 0.4 && GAEA_LEVEL_CURVES.shape.rate === 10,
    'the shape curve is (thr 1, rate 10, expo 0.4)');
  ok(GAEA_LEVEL_CURVES.slope.expo === 2 && GAEA_LEVEL_CURVES.slope.thr === 0,
    'the slope curve is (thr 0, rate 10, expo 2)');
}

/* ------------------------------------------------------- 6. iterations per level */

section('iterations per level');
{
  // ceil(curve * Duration). Levels inside the threshold get the full Duration.
  ok(gaeaLevelIterations(1, 10) === 10, 'level 1 gets exactly Duration iterations',
    gaeaLevelIterations(1, 10));
  ok(gaeaLevelIterations(0, 10, { levelCount: 22.36 }) === 4,
    'level 0 gets ceil(0.36 * Duration)', gaeaLevelIterations(0, 10, { levelCount: 22.36 }));
  ok(gaeaLevelIterations(0, 0) === 0, 'Duration 0 still yields no iterations');

  // ceil rounds a positive weight up, so no level is ever skipped entirely. That is why the
  // pyramid's coarse levels still contribute one pass even when their weight is ~1e-5.
  ok(gaeaLevelIterations(20, 10, { levelCount: 22.36 }) === 1,
    'a near-zero weight still runs one iteration',
    gaeaLevelIterations(20, 10, { levelCount: 22.36 }));

  // Integral, matching the driver's vroundss(..., 2).
  for (const d of [1, 2.5, 7.7, 199]) {
    const n = gaeaLevelIterations(4, d, { levelCount: 22.36 });
    ok(Number.isInteger(n), `the iteration count is integral for Duration ${d}`, n);
  }

  // A deeper pyramid pushes the weights down across the board: level 6 is lighter at 40 levels
  // than at 10, because the level index is what the gate measures.
  const shallow = gaeaLevelIterations(6, 20, { levelCount: 10 });
  const deep = gaeaLevelIterations(6, 20, { levelCount: 40 });
  ok(deep <= shallow, 'a deeper pyramid does not increase a given level', `${deep} vs ${shallow}`);
}

/* --------------------------------------------------- 7. unrounded pyramid depth */

section('unrounded depth for the curve input');
{
  // Same knee-aligned case as the depth section: 0.5 * 200 * 100 / 1000 = 10, so the raw
  // depth is sqrt(10) and the integer depth its ceil.
  const raw = gaeaPyramidDepthExact({ erosionScale: 200, terrainWidth: 1000, width: 100 });
  ok(near(raw, Math.sqrt(10), 1e-12), 'the raw depth is the sqrt before ceil', raw);
  ok(Math.ceil(raw) === gaeaPyramidDepth({ erosionScale: 200, terrainWidth: 1000, width: 100 }),
    'the integer depth is the ceil of the raw depth');
  ok(gaeaPyramidDepthExact({ erosionScale: 1, terrainWidth: 0, width: 0 }) === 0,
    'degenerate geometry gives 0, not NaN');
}

/* ------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('erosion schedule: scale remap, pyramid depth, droplet budget and level curve');
}
