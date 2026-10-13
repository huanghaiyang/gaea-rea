/**
 * gaea-rivers-test.mjs — the exactly-recoverable parts of Gaea's Rivers driver.
 *
 * Rivers is only PARTIALLY recovered: the algorithmic core (FUN_180044330 and the eight
 * unrolled FUN_1800488f0 calls) has not been read. What is tested here is the parameter ramp,
 * the pyramid-depth rule, and the seeding rule — all three exact, all three reusable, and one
 * of them different from the formula this build already uses elsewhere.
 *
 * Run: node web/tests/gaea-rivers-test.mjs
 */

import {
  K_RIVERS_RAMP_RATE, K_RIVERS_DEPTH_FACTOR, K_RAND_INV, K_RIVERS_SEED_THRESHOLD,
  K_RIVERS_CELL_MARGIN, K_RIVERS_WIDTH_QUANTUM, K_RIVERS_SCALE,
  K_RIVER_SCALE_QUANTUM, K_RIVER_HEIGHT_BIAS, K_RIVER_STEER, K_RIVER_TABLE_WEIGHT,
  K_RIVER_COUNT_HI, K_RIVER_COUNT_SCALE, RIVER_DIR_TABLE_SIZE,
  gaeaExpRamp, gaeaRiversPyramidDepth, gaeaRiversSeeds,
  gaeaSeedToCell, gaeaRiversStepBudget, gaeaRiversPostPasses,
  gaeaRiverStep, gaeaRiverVisit, gaeaRiverStepScale, gaeaRiverStepLimit,
  K_RIVER_PIT_FILL, gaeaFillPit,
  K_RIVER_W_DIAG, K_RIVER_W_AXIAL, K_RIVER_W_CENTRE, K_RIVER_W_TOTAL, gaeaRiverSmooth,
} from '../js/kernels/rivers.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* ------------------------------------------------------------------------ the constants */

{
  ok(K_RIVERS_RAMP_RATE === 4, 'the ramp rate is 4', K_RIVERS_RAMP_RATE);
  ok(K_RIVERS_DEPTH_FACTOR === 0.875, 'the depth factor is 0.875', K_RIVERS_DEPTH_FACTOR);
  // 1/32768, not 1/32767: the safe divisor for a generator whose maximum is RAND_MAX.
  ok(K_RAND_INV === 1 / 32768, 'the rand normaliser is 1/32768', K_RAND_INV);
  ok(K_RAND_INV * 32767 < 1, 'the largest rand value still lands below 1');
  ok(near(K_RIVERS_SEED_THRESHOLD, 1.00099, 1e-5),
    'the seed threshold scale is slightly above 1', K_RIVERS_SEED_THRESHOLD);
}

/* ------------------------------------------------------------------------- the exp ramp */

{
  // The endpoints are exact by construction, which is what makes this ramp usable as a
  // normalised parameter map rather than merely a curve.
  ok(gaeaExpRamp(0) === 0, 'the ramp is exactly 0 at 0', gaeaExpRamp(0));
  ok(near(gaeaExpRamp(1), 1, 1e-12), 'the ramp is exactly 1 at 1', gaeaExpRamp(1));

  // Convex: it spends more of its OUTPUT range near the low input end. Checked at the
  // midpoint, where a linear map would give 0.5. The ramp is sharply convex — the exact value
  // is (e^2 - 1)/(e^4 - 1) = 0.1192 — so the assertion is the closed form, not a guessed band.
  const mid = gaeaExpRamp(0.5);
  const closedForm = (Math.E ** 2 - 1) / (Math.E ** 4 - 1);
  ok(near(mid, closedForm, 1e-12), 'the midpoint is the closed form (e^2-1)/(e^4-1)', mid);
  ok(mid < 0.2, 'the ramp is strongly convex: the midpoint is well below 0.5', mid);

  // Monotone across the unit interval.
  let monotone = true;
  let prev = -Infinity;
  for (let p = 0; p <= 1.0000001; p += 0.01) {
    const v = gaeaExpRamp(p);
    if (!(v >= prev)) { monotone = false; break; }
    prev = v;
  }
  ok(monotone, 'the ramp is monotone on 0..1');

  // It must NOT be the erosion per-level curve. That one is (exp(-v*rate)-1)/rate + v, which
  // goes NEGATIVE for small v; this one does not. Asserting the difference keeps the two from
  // being treated as interchangeable.
  ok(gaeaExpRamp(0.01) > 0, 'the ramp stays positive where the erosion curve dips negative',
    gaeaExpRamp(0.01));

  // A non-finite input must not produce NaN.
  ok(Number.isFinite(gaeaExpRamp(NaN)) && Number.isFinite(gaeaExpRamp(Infinity)),
    'non-finite input is handled');
}

/* --------------------------------------------------------------- the pyramid depth rule */

{
  // floor(log2(size * 0.875)), and the binary stores it as an int.
  const expect = {
    16: Math.floor(Math.log2(16 * 0.875)),      // log2(14) = 3.807 -> 3
    64: Math.floor(Math.log2(64 * 0.875)),      // log2(56) = 5.807 -> 5
    256: Math.floor(Math.log2(256 * 0.875)),    // log2(224) = 7.807 -> 7
    1024: Math.floor(Math.log2(1024 * 0.875)),  // log2(896) = 9.807 -> 9
  };
  for (const [size, want] of Object.entries(expect)) {
    ok(gaeaRiversPyramidDepth(Number(size)) === want,
      `depth for size ${size} is ${want}`, gaeaRiversPyramidDepth(Number(size)));
  }

  // The rule must differ from a plain log2, or the 0.875 factor would be decorative.
  ok(gaeaRiversPyramidDepth(256) !== Math.floor(Math.log2(256)),
    'the 0.875 factor changes the depth for at least one size',
    `${gaeaRiversPyramidDepth(256)} vs ${Math.floor(Math.log2(256))}`);

  // Degenerate sizes must not produce a zero or negative level count.
  ok(gaeaRiversPyramidDepth(1) >= 1, 'size 1 still gives at least one level');
  ok(gaeaRiversPyramidDepth(0) >= 1, 'size 0 is clamped to at least one level');
}

/* ------------------------------------------------------------------------ the seeding */

{
  // A deterministic generator so the test does not depend on the platform's rand.
  const lcg = (seed) => {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  };

  // With no mask every candidate is kept.
  const all = gaeaRiversSeeds({ count: 100, size: 32, rand: lcg(1) });
  ok(all.count === 100, 'without a mask every candidate is kept', all.count);

  // Positions are normalised to 0..1: that is what the 1/32768 divisor is for.
  let inRange = true;
  for (let i = 0; i < all.count; i++) {
    if (!(all.x[i] >= 0 && all.x[i] < 1 && all.y[i] >= 0 && all.y[i] < 1)) inRange = false;
  }
  ok(inRange, 'every seed position is normalised to 0..1');

  // A zero mask rejects everything, and a mask of 1 accepts nearly everything. The slight
  // over-unity threshold is what makes the second case true rather than borderline.
  const size = 16;
  const zero = new Float32Array(size * size);
  const none = gaeaRiversSeeds({ count: 200, size, mask: zero, rand: lcg(2) });
  ok(none.count === 0, 'a zero density mask rejects every candidate', none.count);

  const one = new Float32Array(size * size).fill(1);
  const many = gaeaRiversSeeds({ count: 200, size, mask: one, rand: lcg(2) });
  ok(many.count > 0, 'a full density mask keeps candidates', many.count);
  // Statistically it should keep essentially all of them; the threshold is 1.00099, so a
  // draw below 1 always passes.
  ok(many.count === 200, 'a mask of 1 keeps every candidate', many.count);
  ok(K_RIVERS_SEED_THRESHOLD * 1 >= 1, 'the threshold at mask 1 admits the whole unit interval');

  // A half mask must keep roughly half, which is the property that makes it a mask.
  const half = new Float32Array(size * size).fill(0.5);
  const some = gaeaRiversSeeds({ count: 4000, size, mask: half, rand: lcg(7) });
  ok(some.count > 1500 && some.count < 2500,
    'a half-density mask keeps about half the candidates', some.count);

  // Determinism under a fixed generator.
  const a = gaeaRiversSeeds({ count: 50, size, mask: half, rand: lcg(9) });
  const b = gaeaRiversSeeds({ count: 50, size, mask: half, rand: lcg(9) });
  let same = a.count === b.count;
  for (let i = 0; same && i < a.count; i++) if (a.x[i] !== b.x[i]) same = false;
  ok(same, 'the seeding is deterministic for a given generator');
}

/* ------------------------------------------------------- the seed stepper (partial) */

{
  ok(K_RIVERS_CELL_MARGIN === 0.1, 'the cell margin is 0.1', K_RIVERS_CELL_MARGIN);
  ok(K_RIVERS_WIDTH_QUANTUM === 512, 'the budget quantises the width by 512');
  ok(K_RIVERS_SCALE === 4000, 'the river scale is pre-multiplied by 4000', K_RIVERS_SCALE);

  // `(dim - 0.1) * pos`. The margin is why a position of 1.0 lands one cell short of the end,
  // and the clamp is why nothing lands past it.
  ok(gaeaSeedToCell(256, 0) === 0, 'position 0 maps to cell 0');
  ok(gaeaSeedToCell(256, 1) === 255, 'position 1 maps exactly to the last cell',
    gaeaSeedToCell(256, 1));
  ok(gaeaSeedToCell(256, 0.5) === 127, 'the midpoint maps to the middle', gaeaSeedToCell(256, 0.5));

  // Never out of range, including for inputs the mask test could pass through.
  let inRange = true;
  for (let p = 0; p <= 1.0001; p += 0.001) {
    const c = gaeaSeedToCell(64, p);
    if (!(c >= 0 && c <= 63)) inRange = false;
  }
  ok(inRange, 'every position maps inside the grid');
  ok(gaeaSeedToCell(64, 5) === 63, 'an out-of-range position clamps to the last cell');
  ok(gaeaSeedToCell(64, -3) === 0, 'a negative position clamps to 0');
}

{
  // The budget's `max(1, ...)` floor is what keeps a small grid from producing nothing.
  const small = gaeaRiversStepBudget({ width: 64, riverScale: 1, divisor: 1, seedCount: 10 });
  ok(small === 10, 'below 512 cells wide the floor gives one step per seed', small);

  const zeroScale = gaeaRiversStepBudget({ width: 1024, riverScale: 0, divisor: 1, seedCount: 10 });
  ok(zeroScale === 10, 'a zero river scale still gives the floor', zeroScale);

  // Above 512 the quantised width drives the budget.
  const big = gaeaRiversStepBudget({ width: 1024, riverScale: 4000, divisor: 2000, seedCount: 10 });
  // floor(1024/512) = 2, so perSeed = max(1, 2*4000/2000) = 4, budget = 40.
  ok(big === 40, 'the budget scales with the quantised width', big);

  const halved = gaeaRiversStepBudget({ width: 1024, riverScale: 4000, divisor: 4000, seedCount: 10 });
  ok(halved === 20, 'doubling the divisor halves the budget', halved);

  // No seeds means no steps, regardless of the other terms.
  ok(gaeaRiversStepBudget({ width: 4096, riverScale: 4000, divisor: 1, seedCount: 0 }) === 0,
    'no seeds means no steps');
}

{
  // The post-pass count depends on the iteration index, which is easy to flatten by accident.
  ok(gaeaRiversPostPasses(0) === 2, 'the first iteration runs two passes');
  ok(gaeaRiversPostPasses(1) === 2, 'the second iteration still runs two');
  ok(gaeaRiversPostPasses(2) === 4, 'the third iteration adds two more', gaeaRiversPostPasses(2));
  ok(gaeaRiversPostPasses(3) === 6, 'the fourth reaches six', gaeaRiversPostPasses(3));
  ok(gaeaRiversPostPasses(99) === 6, 'and it saturates at six');
  ok(gaeaRiversPostPasses(0) !== gaeaRiversPostPasses(9),
    'the pass count is genuinely iteration-dependent');
}

/* ---------------------------------------------- the per-seed stepper (FUN_1800430c0) */

{
  ok(K_RIVER_SCALE_QUANTUM === 5e-5, 'the scale quantum is 5e-5', K_RIVER_SCALE_QUANTUM);
  ok(K_RIVER_HEIGHT_BIAS === 20, 'the height bias is 20', K_RIVER_HEIGHT_BIAS);
  ok(K_RIVER_STEER === 0.04, 'the steering coefficient is 0.04', K_RIVER_STEER);
  ok(K_RIVER_TABLE_WEIGHT === 0.2, 'the table weight is 0.2', K_RIVER_TABLE_WEIGHT);
  ok(K_RIVER_COUNT_HI === 500 && K_RIVER_COUNT_SCALE === 420,
    'the count guard is 500 - riverScale*420');
  ok(RIVER_DIR_TABLE_SIZE === 32, 'the direction table has 32 entries');

  ok(gaeaRiverStepScale(256, 1) === 2 * 256 * 5e-5, 'the scale is 2*w*5e-5*riverScale',
    gaeaRiverStepScale(256, 1));
  ok(gaeaRiverStepScale(256, 0) === 0, 'a zero river scale gives a zero scale');
  ok(gaeaRiverStepLimit(256) === 512, 'the loop bound is twice the width');
}

{
  // THE NORMALISATION IS CHEBYSHEV, NOT EUCLIDEAN. The larger component must land on exactly
  // +-1; a Euclidean divide would leave it below 1. This is where the river stepper and the
  // erosion droplet deliberately differ, so it is asserted rather than assumed.
  const r = gaeaRiverStep({ vx: 0.6, vy: 0.8, gx: 0, gy: 0, mag: 0, scale: 0, tableX: 0, tableY: 0 });
  ok(Math.abs(r.x) === 1 || Math.abs(r.y) === 1,
    'the larger component is normalised to exactly 1', `${r.x}, ${r.y}`);

  const euclid = Math.hypot(0.6, 0.8);
  ok(Math.abs(r.x) !== 0.6 / euclid || Math.abs(r.y) !== 0.8 / euclid,
    'the normalisation is not the Euclidean one');

  const z = gaeaRiverStep({ vx: 0, vy: 0, gx: 0, gy: 0, mag: 0, scale: 0, tableX: 0, tableY: 0 });
  ok(z.x === 0 && z.y === 0, 'a zero direction yields a zero step');

  // The table and the gradient must both be able to steer the step — but ONLY when they change
  // the DIRECTION. Because the divide is Chebyshev, the step is scale-invariant: scaling both
  // components equally leaves it identical. An earlier version of this test used vy = 0, which
  // made the table's y term vanish and let the normalisation absorb the x change, so both
  // comparisons reported no difference. The inputs below use a genuine 2-D direction.
  const base = { vx: 0.6, vy: 0.8, gx: 0.3, gy: 0.9, mag: 1, scale: 0.1 };
  const plain = gaeaRiverStep({ ...base, tableX: 0, tableY: 0 });
  const tabled = gaeaRiverStep({ ...base, tableX: 5, tableY: -3 });
  ok(plain.x !== tabled.x || plain.y !== tabled.y,
    'the direction table changes the step', `${plain.x},${plain.y} vs ${tabled.x},${tabled.y}`);

  const noGrad = gaeaRiverStep({ ...base, gx: 0, gy: 0, tableX: 0, tableY: 0 });
  ok(noGrad.x !== plain.x || noGrad.y !== plain.y,
    'the gradient term changes the step', `${noGrad.x},${noGrad.y} vs ${plain.x},${plain.y}`);

  // THE SCALE INVARIANCE, asserted explicitly rather than left implicit. Doubling the
  // direction magnitude must not move the normalised step at all.
  const small = gaeaRiverStep({ vx: 0.6, vy: 0.8, gx: 0, gy: 0, mag: 0, scale: 1,
    tableX: 0, tableY: 0 });
  const large = gaeaRiverStep({ vx: 6, vy: 8, gx: 0, gy: 0, mag: 0, scale: 1,
    tableX: 0, tableY: 0 });
  ok(Math.abs(small.x - large.x) < 1e-12 && Math.abs(small.y - large.y) < 1e-12,
    'the step is scale-invariant: only the direction ratio matters',
    `${small.x},${small.y} vs ${large.x},${large.y}`);

  // And with equal components the Chebyshev divide leaves both at 1.
  const tie = gaeaRiverStep({ vx: 1, vy: 1, gx: 0, gy: 0, mag: 0, scale: 1,
    tableX: 0, tableY: 0 });
  ok(tie.x === 1 && tie.y === 1, 'equal components normalise to 1 and 1', `${tie.x},${tie.y}`);
}

{
  // The count-driven output. `count` is how many seeds passed through the cell, so the first
  // visit always fires and the weight saturates at 1.
  const first = gaeaRiverVisit(1, 1, 5);
  ok(first.fire, 'the first visit to a cell always fires');
  ok(first.weight === Math.min(1, 1 * 0.04 * 1), 'the first weight is count*0.04*riverScale',
    first.weight);

  const many = gaeaRiverVisit(1000, 1, 5);
  ok(many.weight === 1, 'the weight saturates at 1', many.weight);
  ok(many.fire, 'a saturated count fires');

  // The 32-step cadence: (idx + 1) & 31 == 0 fires regardless of the count.
  let cadence = 0;
  for (let i = 0; i < 64; i++) if (gaeaRiverVisit(3, 0.1, i).fire) cadence++;
  ok(cadence >= 2, 'the 32-step cadence fires repeatedly', cadence);
  ok(gaeaRiverVisit(3, 0.1, 31).fire, 'step 31 fires on the wrap');
  ok(gaeaRiverVisit(3, 0.1, 63).fire, 'step 63 fires on the wrap');

  // Degenerate inputs must not produce NaN in the weight.
  for (const c of [0, -5, NaN]) {
    const r = gaeaRiverVisit(c, 1, 5);
    ok(Number.isFinite(r.weight) && r.weight >= 0,
      `count ${c} yields a usable weight`, r.weight);
  }
}

/* ---------------------------------------------------- the pit fill (FUN_180041600) */

{
  ok(Math.abs(K_RIVER_PIT_FILL - 0.99999) < 1e-9,
    'the pit-fill factor is 0.99999, just under 1', K_RIVER_PIT_FILL);
  // Just under 1 is load-bearing: at exactly 1 a filled cell would saturate onto its
  // neighbour and the field would lose the gradient the stepper needs.
  ok(K_RIVER_PIT_FILL < 1, 'the factor is strictly below 1');
  ok(K_RIVER_PIT_FILL > 0.99, 'and it is close enough to 1 to fill almost completely');

  const size = 7;
  const mk = (fill, cx, cy, v) => {
    const f = new Float32Array(size * size).fill(fill);
    f[cy * size + cx] = v;
    return f;
  };

  // A pit cell is raised toward its lowest neighbour.
  {
    const f = mk(1, 3, 3, 0);
    const before = f[3 * size + 3];
    const after = gaeaFillPit(f, size, 3, 3);
    ok(after > before, 'a pit cell is raised', `${before} -> ${after}`);
    ok(after < 1, 'but it does not reach the neighbour value', after);
    // The gap is scaled by exactly (1 - factor).
    ok(Math.abs(after - (before + (1 - before) * K_RIVER_PIT_FILL)) < 1e-6,
      'the raise is (minN - h) * factor + h', after);
  }

  // THE STRICT TEST: a cell equal to its lowest neighbour must be untouched. This is what
  // makes a flat field idempotent, and a `<=` instead of `<` would erode it pass by pass.
  {
    const f = new Float32Array(size * size).fill(0.5);
    const after = gaeaFillPit(f, size, 3, 3);
    ok(after === 0.5, 'a cell equal to its neighbours is untouched', after);
    let flat = true;
    for (let i = 0; i < f.length; i++) if (f[i] !== 0.5) { flat = false; break; }
    ok(flat, 'a flat field is unchanged by a pass');
  }

  // The centre is EXCLUDED from the neighbourhood. A cell higher than its neighbours must not
  // be dragged down: its own value must not appear in the minimum.
  {
    const f = mk(1, 3, 3, 5);
    const after = gaeaFillPit(f, size, 3, 3);
    ok(after === 5, 'a cell above its neighbours is not lowered', after);
  }

  // Diagonals count. With the unique minimum on a diagonal, a 4-connected neighbourhood would
  // compute a different minimum, so the result distinguishes 8 neighbours from 4.
  // The centre must be BELOW every neighbour for the raise to fire at all — an earlier version
  // had the centre high, so the strict test rejected the raise and nothing was measured.
  {
    const f = new Float32Array(size * size).fill(0.9);
    f[3 * size + 3] = 0.1;          // the centre, low
    f[2 * size + 2] = 0.3;          // up-left DIAGONAL, the unique minimum
    const after = gaeaFillPit(f, size, 3, 3);
    const expected = 0.1 + (0.3 - 0.1) * K_RIVER_PIT_FILL;
    ok(Math.abs(after - expected) < 1e-6,
      'a diagonal neighbour supplies the minimum', `${after} vs ${expected}`);
    const fourWay = 0.1 + (0.9 - 0.1) * K_RIVER_PIT_FILL;
    ok(Math.abs(after - fourWay) > 0.1, 'and not the 4-connected minimum', after);
  }

  // The LOWEST neighbour wins, not the first or the average.
  {
    const f = new Float32Array(size * size).fill(0.9);
    f[3 * size + 3] = 0.05;         // the centre, lowest
    f[3 * size + 2] = 0.2;          // left, the minimum
    f[3 * size + 4] = 0.6;          // right
    f[2 * size + 3] = 0.8;          // up
    const after = gaeaFillPit(f, size, 3, 3);
    ok(Math.abs(after - (0.05 + (0.2 - 0.05) * K_RIVER_PIT_FILL)) < 1e-6,
      'the lowest neighbour drives the raise', after);
  }

  // Repeated passes converge toward the minimum. In FLOAT32 they eventually REACH it: after
  // enough passes the residual falls below the float32 spacing and rounds onto 1.0. An earlier
  // assertion that it can never reach the neighbour value was wrong about float32, not the code.
  {
    const f = mk(1, 3, 3, 0);
    let prev = 0;
    let monotone = true;
    let inBounds = true;
    for (let i = 0; i < 8; i++) {
      const v = gaeaFillPit(f, size, 3, 3);
      if (!(v >= prev)) monotone = false;
      if (v > 1) inBounds = false;
      prev = v;
    }
    ok(monotone, 'repeated passes are monotone', prev);
    ok(inBounds, 'and never overshoot the neighbour value', prev);
    ok(prev > 0.9999, 'and they get very close', prev);
  }

  // Boundary cells must not read out of the field.
  {
    const f = new Float32Array(size * size).fill(1);
    f[0] = 0;                        // corner pit
    const corner = gaeaFillPit(f, size, 0, 0);
    ok(Number.isFinite(corner) && corner > 0, 'a corner cell is handled', corner);
    const edge = gaeaFillPit(f, size, size - 1, size - 1);
    ok(Number.isFinite(edge), 'the opposite corner is handled', edge);
    ok(gaeaFillPit(f, size, -1, 0) === 0, 'an out-of-range cell returns 0');
    ok(gaeaFillPit(f, size, size, 0) === 0, 'a cell past the edge returns 0');
  }

  // A 1x1 field has no neighbours at all and must be left alone rather than becoming NaN.
  // The comparison goes through Math.fround because the field stores float32.
  {
    const one = new Float32Array([0.3]);
    const v = gaeaFillPit(one, 1, 0, 0);
    ok(v === Math.fround(0.3) && Number.isFinite(v), 'a 1x1 field is untouched', v);
  }
}

/* ------------------------------------------------ the vector-field smoother (FUN_1800488f0) */

{
  ok(K_RIVER_W_DIAG === 21, 'the diagonal weight is 21', K_RIVER_W_DIAG);
  ok(K_RIVER_W_AXIAL === 31, 'the axial weight is 31', K_RIVER_W_AXIAL);
  ok(K_RIVER_W_CENTRE === 48, 'the centre weight is 48', K_RIVER_W_CENTRE);
  // The power-of-two total is the design, not a coincidence: the weights are 8-bit fractions
  // of 256.
  ok(K_RIVER_W_TOTAL === 256, 'the kernel totals exactly 256', K_RIVER_W_TOTAL);
  // The ordering must be Gaussian-like: axial above diagonal, centre above both. Reversing
  // axial and diagonal would still total 256, so this is a separate assertion.
  ok(K_RIVER_W_AXIAL > K_RIVER_W_DIAG, 'axial outweighs diagonal');
  ok(K_RIVER_W_CENTRE > K_RIVER_W_AXIAL, 'the centre outweighs the neighbours');

  const size = 7;
  const mkVec = (vx, vy) => {
    const f = new Float32Array(size * size * 2);
    for (let i = 0; i < size * size; i++) { f[i * 2] = vx; f[i * 2 + 1] = vy; }
    return f;
  };
  const fullMask = new Float32Array(size * size).fill(1);

  // A CONSTANT FIELD IS A FIXED POINT. The output is a weighted MEAN, so a uniform field must
  // come back unchanged — a weighted sum instead of a mean would multiply it by 256.
  {
    const f = mkVec(0.25, -0.5);
    const out = gaeaRiverSmooth({ field: f, mask: fullMask, size });
    let ok1 = true;
    for (let i = 0; i < out.length; i++) {
      const want = i % 2 === 0 ? 0.25 : -0.5;
      if (Math.abs(out[i] - want) > 1e-6) { ok1 = false; break; }
    }
    ok(ok1, 'a uniform field is a fixed point of the smoother', out[0]);
  }

  // The output is a MEAN: scaling the input scales the output linearly.
  {
    const a = gaeaRiverSmooth({ field: mkVec(0.3, 0.6), mask: fullMask, size });
    const b = gaeaRiverSmooth({ field: mkVec(0.6, 1.2), mask: fullMask, size });
    let linear = true;
    for (let i = 0; i < a.length; i++) if (Math.abs(b[i] - 2 * a[i]) > 1e-6) { linear = false; break; }
    ok(linear, 'the smoother is linear in the field');
  }

  // THE MASK GATES NEIGHBOURS. With only one cell marked, that cell's output is itself (it is
  // the only contributor), regardless of what the unmarked neighbours hold.
  {
    const f = new Float32Array(size * size * 2);
    f[(3 * size + 3) * 2] = 1; f[(3 * size + 3) * 2 + 1] = 1;
    for (let i = 0; i < size * size; i++) {
      if (i === 3 * size + 3) continue;
      f[i * 2] = 9; f[i * 2 + 1] = 9;      // loud, but unmarked
    }
    const mask = new Float32Array(size * size);   // all zero
    mask[3 * size + 3] = 1;
    const out = gaeaRiverSmooth({ field: f, mask, size });
    // The centre is the only contributor, so the mean is the centre's own value.
    ok(Math.abs(out[(3 * size + 3) * 2] - 1) < 1e-6,
      'only masked neighbours contribute', out[(3 * size + 3) * 2]);
    // Every other cell fails the outer guard, so it takes `preserveEmpty ? in : 0`, which
    // defaults to zero.
    ok(out[0] === 0, 'a cell outside the mask is zeroed by default', out[0]);
    // And the preserve flag keeps it — the SAME flag as the no-contributor case, not the blend.
    const keptMaskedOut = gaeaRiverSmooth({ field: f, mask, size, preserveEmpty: true });
    ok(Math.abs(keptMaskedOut[0] - 9) < 1e-6,
      'the preserve flag keeps a masked-out cell', keptMaskedOut[0]);
  }

  // centreWeight trades smoothing against preserving the cell's own value.
  {
    const f = mkVec(0, 0);
    f[(3 * size + 3) * 2] = 1;               // one cell differs
    const low = gaeaRiverSmooth({ field: f, mask: fullMask, size, centreWeight: 0.1 });
    const high = gaeaRiverSmooth({ field: f, mask: fullMask, size, centreWeight: 10 });
    const atLow = low[(3 * size + 3) * 2];
    const atHigh = high[(3 * size + 3) * 2];
    ok(atHigh > atLow, 'a larger centre weight preserves the cell value', `${atLow} vs ${atHigh}`);
    // But even a small centre weight leaves a positive value, since the centre still counts.
    ok(atLow > 0, 'the centre always contributes something', atLow);
  }

  // preserveEmpty decides the fallback where nothing contributed.
  {
    const f = mkVec(0.4, 0.4);
    const none = new Float32Array(size * size);      // every mask zero
    const zeroed = gaeaRiverSmooth({ field: f, mask: none, size });
    ok(zeroed[0] === 0, 'with no contributors and no preserve flag the output is zero');
    const kept = gaeaRiverSmooth({ field: f, mask: none, size, preserveEmpty: true });
    ok(Math.abs(kept[0] - 0.4) < 1e-6, 'the preserve flag keeps the input', kept[0]);
  }

  // With no mask at all every neighbour counts, so the kernel is a plain 3x3 average and the
  // totals must still work out at the boundary where neighbours clamp.
  {
    const f = mkVec(0.5, -0.25);
    const out = gaeaRiverSmooth({ field: f, mask: null, size });
    let finite = true;
    for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) { finite = false; break; }
    ok(finite, 'a null mask produces finite output at every cell');
    ok(Math.abs(out[(size - 1) * size * 2 + (size - 1) * 2] - 0.5) < 1e-6,
      'a corner cell is still the constant', out[0]);
  }

  // Determinism and a usable length.
  {
    const f = mkVec(0.1, 0.2);
    const a = gaeaRiverSmooth({ field: f, mask: fullMask, size });
    const b = gaeaRiverSmooth({ field: f, mask: fullMask, size });
    ok(a.length === size * size * 2, 'the output holds one float2 per cell', a.length);
    let same = true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
    ok(same, 'the smoother is deterministic');
  }
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
  console.log('Gaea Rivers: ramp, depth, seeding, stepper, pit fill, visit counter, smoother');
  console.log('all four inner helpers read; the pyramid build/restore is not implemented');
}
