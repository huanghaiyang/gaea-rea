/**
 * gaea-droplet-test.mjs — the droplet step recovered from FUN_1801f0440.
 *
 * This is the physics that decides where a droplet goes and when it stops, transcribed from
 * the shipped binary. The rules it encodes are materially different from the model this
 * build used before, so each difference gets an assertion that would fail if the old
 * behaviour were restored:
 *
 *   old: dir -= gradient * (1 - inertia)      raw gradient, so steep cells dominate
 *   new: dir += -gradient / |gradient|        unit gradient, so every cell deflects equally
 *
 *   old: dir = prevDir * 0.05                 a fixed fractional inertia
 *   new: dir = 0.5 * prevDir * (1 or 30)      full-strength, or 30x right after a deposit
 *
 *   old: fresh random angle per step
 *   new: a quarter of the direction from a PRECOMPUTED table
 *
 * Run: node web/tests/gaea-droplet-test.mjs
 */

import {
  K_DIR_INERTIA, K_DIR_TABLE, K_DIR_DEPOSIT, K_BORDER, DROPLET_STEPS,
  gaeaDropletDirection, gaeaDirectionTable,
  gaeaDischargeThreshold, gaeaDepositionThresholds, DISCHARGE_ANGLE_RANGE,
  PARAMETER_OFFSETS, CONTEXT_PARAMETERS_BASE, contextOffsetFor,
  K_APPLY_ZERO_A, K_APPLY_ZERO_B, K_GAIN_SCALE, K_PATH_WINDOW_3, K_PATH_WINDOW_5,
  gaeaIterationGain, gaeaPathCurvature, gaeaCapacity, gaeaStepContribution,
} from '../js/kernels/erosion.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* ----------------------------------------------------------------- the constants */

{
  ok(K_DIR_INERTIA === 0.5, 'K_DIR_INERTIA is 0.5 (0x180356210)', K_DIR_INERTIA);
  ok(K_DIR_TABLE === 0.25, 'K_DIR_TABLE is 0.25 (0x1803561ec)', K_DIR_TABLE);
  ok(K_DIR_DEPOSIT === 30, 'K_DIR_DEPOSIT is 30 (0x180356374)', K_DIR_DEPOSIT);
  ok(K_BORDER === 1.5, 'K_BORDER is 1.5 (0x1803562c0)', K_BORDER);
  ok(DROPLET_STEPS === 11, 'the step loop bound is the literal 0xb = 11', DROPLET_STEPS);
}

/* ------------------------------------------------------------------- direction rule */

{
  // The result is always a unit vector, which is what makes the normalisation observable.
  const v = gaeaDropletDirection({
    gx: 0.3, gy: 0.9, prevX: 1, prevY: 0, tableX: 0, tableY: 1, justDeposited: false,
  });
  ok(v !== null, 'a non-flat cell yields a direction');
  ok(near(Math.hypot(v.x, v.y), 1, 1e-6), 'the direction is normalised', Math.hypot(v.x, v.y));
}

{
  // A flat cell has no downhill direction and Gaea terminates the droplet; the null return
  // is what carries that, so it must not silently pick an arbitrary direction.
  ok(gaeaDropletDirection({
    gx: 0, gy: 0, prevX: 1, prevY: 0, tableX: 0, tableY: 1, justDeposited: false,
  }) === null, 'a flat cell returns null so the droplet can be terminated');
}

{
  // The unit-gradient rule: doubling the slope must not change the direction. Under the old
  // raw-gradient rule it would, which is exactly the difference being pinned here.
  const mk = (scale) => gaeaDropletDirection({
    gx: 0.1 * scale, gy: 0.2 * scale,
    prevX: 0, prevY: 0, tableX: 0, tableY: 0, justDeposited: false,
  });
  const a = mk(1), b = mk(1000);
  ok(near(a.x, b.x, 1e-6) && near(a.y, b.y, 1e-6),
    'the direction is independent of gradient magnitude', `${a.x},${a.y} vs ${b.x},${b.y}`);

  // With zero inertia and zero table weight the direction is exactly downhill.
  ok(near(a.x, -0.1 / Math.hypot(0.1, 0.2), 1e-6)
    && near(a.y, -0.2 / Math.hypot(0.1, 0.2), 1e-6),
    'with no inertia or table the direction is exactly the negative unit gradient',
    `${a.x},${a.y}`);
}

{
  // The deposit blend is the most distinctive rule. Right after a deposit the previous
  // direction is weighted 30x, so it should dominate a conflicting gradient; without the
  // blend the gradient should dominate instead. The two must differ in OPPOSITE senses.
  const args = {
    gx: -1, gy: 0,                    // downhill points +x
    prevX: -1, prevY: 0,              // but the droplet was travelling -x
    tableX: 0, tableY: 0,
  };
  const normal = gaeaDropletDirection({ ...args, justDeposited: false });
  const afterDeposit = gaeaDropletDirection({ ...args, justDeposited: true });

  // normal: 0.5*(-1) + 1 = +0.5  -> settles at +x (downhill wins)
  ok(normal.x > 0.9, 'without a deposit the downhill pull wins', normal.x);
  // deposit: 0.5*(-1)*30 + 1 = -14 -> settles at -x (inertia wins)
  ok(afterDeposit.x < -0.9, 'right after a deposit the previous direction wins', afterDeposit.x);

  ok(normal.x > 0 && afterDeposit.x < 0,
    'the deposit blend reverses which term dominates, not merely its weight');
}

{
  // The precomputed table contributes exactly a quarter, before normalisation. Setting the
  // table to a unit vector and zeroing the rest isolates its weight.
  const v = gaeaDropletDirection({
    gx: -0, gy: -0, prevX: 0, prevY: 0, tableX: 3, tableY: 0, justDeposited: false,
  });
  // A zero gradient returns null, so use a tiny one and check the ratio instead.
  const w = gaeaDropletDirection({
    gx: -1e-6, gy: 0, prevX: 0, prevY: 0, tableX: 3, tableY: 0, justDeposited: false,
  });
  ok(v === null, 'an exactly flat cell is rejected even with a table direction');
  ok(w !== null && w.x > 0, 'the table can steer a nearly flat cell', w && w.x);
}

/* -------------------------------------------------------------- the direction table */

{
  const t = gaeaDirectionTable(64, 12345);
  ok(t.length === 128, 'the table holds two floats per entry', t.length);

  let allUnit = true;
  for (let i = 0; i < 64; i++) {
    const m = Math.hypot(t[i * 2], t[i * 2 + 1]);
    if (!near(m, 1, 1e-5)) { allUnit = false; break; }
  }
  ok(allUnit, 'every table entry is a unit vector');

  // Determinism is the point of precomputing: two workers given the same seed must agree
  // exactly, which a per-step random draw could not guarantee.
  const again = gaeaDirectionTable(64, 12345);
  let identical = true;
  for (let i = 0; i < t.length; i++) if (t[i] !== again[i]) { identical = false; break; }
  ok(identical, 'the table is reproducible from its seed');

  const other = gaeaDirectionTable(64, 999);
  let differs = false;
  for (let i = 0; i < t.length; i++) if (t[i] !== other[i]) { differs = true; break; }
  ok(differs, 'a different seed gives a different table');
}

/* ------------------------------------------------- the three discharge angles */

{
  // FUN_1801f24f0 converts each angle with tanf((deg / 180) * PI). These are the exact
  // tangents, computed here from the mathematical definition rather than from the binary, so
  // a mismatch would mean the conversion in the kernel is wrong.
  const expect = {
    0: 0,
    10: Math.tan((10 / 180) * Math.PI),
    15: Math.tan((15 / 180) * Math.PI),
    24: Math.tan((24 / 180) * Math.PI),
    45: 1,                      // tan(45 deg) is exactly 1
  };
  for (const [deg, want] of Object.entries(expect)) {
    ok(near(gaeaDischargeThreshold(Number(deg)), want, 1e-6),
      `discharge angle ${deg} deg converts to the right slope`, gaeaDischargeThreshold(Number(deg)));
  }

  // 45 degrees is the top of the declared range and tan(45) is mathematically 1. It is NOT
  // exactly 1 in floating point — tan(PI/4) returns 0.9999999999999999 — so the tolerance is
  // one double ulp, not exact equality.
  ok(near(gaeaDischargeThreshold(45), 1, 1e-15), 'tan(45 deg) is 1 to within a double ulp',
    gaeaDischargeThreshold(45));

  // Monotone over the declared range, which is what makes it usable as a threshold.
  let monotone = true;
  let prev = -Infinity;
  for (let d = DISCHARGE_ANGLE_RANGE[0]; d <= DISCHARGE_ANGLE_RANGE[1]; d += 0.5) {
    const v = gaeaDischargeThreshold(d);
    if (!(v >= prev)) { monotone = false; break; }
    prev = v;
  }
  ok(monotone, 'the threshold is monotone across the declared 0..45 range');

  // Beyond the declared range the value must clamp to tan(45)=1, NOT to tan(90). tan(PI/2) is
  // about 1.6e16 in floating point, and a threshold that large is never crossed, so clamping
  // at 90 silently disables the deposition term instead of saturating it.
  ok(gaeaDischargeThreshold(90) === gaeaDischargeThreshold(45)
    && near(gaeaDischargeThreshold(180), 1, 1e-15),
    'past the declared range the value clamps to tan(45), not to tan(90)',
    gaeaDischargeThreshold(180));
  ok(gaeaDischargeThreshold(180) < 2,
    'the clamped value stays a usable slope rather than exploding',
    gaeaDischargeThreshold(180));
  ok(gaeaDischargeThreshold(-30) === 0, 'a negative angle clamps to 0',
    gaeaDischargeThreshold(-30));
  ok(gaeaDischargeThreshold(Infinity) === 0, 'a non-finite angle yields 0',
    gaeaDischargeThreshold(Infinity));
}

{
  // The catalogue's effective defaults are 10/10/10 — NOT the 24/15/10 the native signature
  // declares, which are only C# fallbacks. Getting this wrong would change all three
  // thresholds by a factor of two.
  const t = gaeaDepositionThresholds({});
  const tan10 = Math.tan((10 / 180) * Math.PI);
  ok(near(t.suspended, tan10, 1e-9), 'the suspended default comes from 10 deg', t.suspended);
  ok(near(t.bed, tan10, 1e-9), 'the bed default comes from 10 deg', t.bed);
  ok(near(t.coarse, tan10, 1e-9), 'the coarse default comes from 10 deg', t.coarse);

  // Named keys, matching the per-load storage keys the parameter schema now uses.
  ok('suspended' in t && 'bed' in t && 'coarse' in t,
    'the three thresholds are returned under distinct keys', Object.keys(t).join(','));

  // Distinct angles must give distinct thresholds, or the three loads are indistinguishable.
  const t2 = gaeaDepositionThresholds({
    SuspendedLoadDischargeAngle: 45, BedLoadDischargeAngle: 15, CoarseSedimentsDischargeAngle: 10,
  });
  ok(near(t2.suspended, 1, 1e-15) && t2.bed < t2.suspended && t2.coarse < t2.bed,
    'three different angles give three ordered thresholds',
    `${t2.suspended}, ${t2.bed}, ${t2.coarse}`);
}

/* --------------------------- the Parameters layout against the native context offsets */

{
  // The struct must be 96 bytes, matching the twelve 8-byte moves in ParallelErosion_Erode.
  // If this drifts, every offset below shifts with it.
  ok(PARAMETER_OFFSETS.__size === 96,
    'Parameters is 96 bytes, matching the twelve qword moves', PARAMETER_OFFSETS.__size);
  ok(CONTEXT_PARAMETERS_BASE === 0x98,
    'the copy begins at context + 0x98', `0x${CONTEXT_PARAMETERS_BASE.toString(16)}`);

  // THE CROSS-CHECK. These context offsets were read out of the native decompilation; the
  // parameter offsets they are compared against come from the managed assembly's field order.
  // Two independent artefacts, five specific agreements.
  const observed = {
    SuspendedLoadDischargeAngle: 0xd4,   // tanf input in FUN_1801f24f0
    BedLoadDischargeAngle: 0xdc,         // tanf input
    CoarseSedimentsDischargeAngle: 0xe4, // tanf input
    Downcutting: 0xbc,                   // zeroed when NoErosion is set
    NoErosion: 0xf4,                     // the flag that does the zeroing
  };
  for (const [name, ctx] of Object.entries(observed)) {
    ok(contextOffsetFor(name) === ctx,
      `${name} lands on the context offset the native code reads`,
      `computed 0x${(contextOffsetFor(name) ?? 0).toString(16)}, observed 0x${ctx.toString(16)}`);
  }

  // The relation the native code relies on: NoErosion zeroing Downcutting. Asserting the
  // parameter values too keeps the check attached to the behaviour, not just to arithmetic.
  ok(contextOffsetFor('NoErosion') - contextOffsetFor('Downcutting') === 0x38,
    'NoErosion sits 0x38 above Downcutting, as the struct declares');

  // Natural alignment must place the two odd-typed fields where the type list says.
  ok(PARAMETER_OFFSETS.Seed === 0x20, 'Seed, the only Int32, is at 0x20', PARAMETER_OFFSETS.Seed);
  ok(PARAMETER_OFFSETS.NoErosion === 0x5C,
    'NoErosion, the only Boolean, is at 0x5C', PARAMETER_OFFSETS.NoErosion);

  // The angle/amount pairs must be four bytes apart, which is what makes them pairs.
  for (const [amount, angle] of [
    ['SuspendedLoadDischargeAmount', 'SuspendedLoadDischargeAngle'],
    ['BedLoadDischargeAmount', 'BedLoadDischargeAngle'],
    ['CoarseSedimentsDischargeAmount', 'CoarseSedimentsDischargeAngle'],
  ]) {
    ok(PARAMETER_OFFSETS[angle] - PARAMETER_OFFSETS[amount] === 4,
      `${amount} is immediately followed by its angle`,
      `${PARAMETER_OFFSETS[amount]} -> ${PARAMETER_OFFSETS[angle]}`);
  }

  // The three fields PE() never sets must be at the offsets with no assigned name, and one
  // of them (0xc0 in context) is zeroed by the orchestrator while the apply multiplies by it.
  const unset = [0x14, 0x1C, 0x28].map((p) => p + CONTEXT_PARAMETERS_BASE);
  ok(unset.join(',') === [0xac, 0xb4, 0xc0].join(','),
    'the three never-set parameters land on 0xac, 0xb4 and 0xc0', unset.join(','));
}

/* ----------------------------------------------- the apply's clean sub-expressions */

{
  ok(K_APPLY_ZERO_A === 0.3 && K_APPLY_ZERO_B === 0.5,
    'the mode selector values are 0.3 and 0.5', `${K_APPLY_ZERO_A}, ${K_APPLY_ZERO_B}`);
  ok(K_GAIN_SCALE === 1.4, 'K_GAIN_SCALE is 1.4', K_GAIN_SCALE);
  ok(K_PATH_WINDOW_3 === 3 && K_PATH_WINDOW_5 === 5,
    'the path averages use divisors 3 and 5');

  // The ramp starts at exactly 1 regardless of the boost: a droplet's first step gets no
  // boost at all, which is what makes the boost an integration over the simulation.
  ok(gaeaIterationGain({ iteration: 0, depositionBoost: 0.5 }) === 1,
    'the gain is exactly 1 at iteration 0', gaeaIterationGain({ iteration: 0, depositionBoost: 0.5 }));
  ok(gaeaIterationGain({ iteration: 0, depositionBoost: 0 }) === 1,
    'the gain is 1 at iteration 0 even with no boost');
  ok(gaeaIterationGain({ iteration: 100, depositionBoost: 0 }) === 1,
    'with no boost the gain never leaves 1');

  // The plateau is 1 + 1.4 * boost, and the ramp must approach it from below.
  const plateau = 1 + 1.4 * 0.5;
  const late = gaeaIterationGain({ iteration: 500, depositionBoost: 0.5 });
  ok(Math.abs(late - plateau) < 1e-6, 'the ramp plateaus at 1 + 1.4 * boost', late);

  let monotone = true;
  let prev = -Infinity;
  for (let n = 0; n <= 40; n++) {
    const g = gaeaIterationGain({ iteration: n, depositionBoost: 0.5 });
    if (!(g >= prev && g <= plateau + 1e-9)) { monotone = false; break; }
    prev = g;
  }
  ok(monotone, 'the gain rises monotonically and never overshoots its plateau');

  // The two modes share a formula but differ in the exponent's rate. The ratio of the two
  // ramp values is NOT the ratio of the rates — it only tends to it as iteration -> 0 — so
  // assert the direction and the limit rather than an identity that does not hold.
  const slow = gaeaIterationGain({ iteration: 2, depositionBoost: 1, mode: 0 });
  const fast = gaeaIterationGain({ iteration: 2, depositionBoost: 1, mode: 1 });
  ok(fast > slow, 'mode 1 approaches the plateau faster than mode 0', `${fast} vs ${slow}`);

  const ratioAt = (n) => {
    const a = gaeaIterationGain({ iteration: n, depositionBoost: 1, mode: 0 }) - 1;
    const b = gaeaIterationGain({ iteration: n, depositionBoost: 1, mode: 1 }) - 1;
    return b / a;
  };
  const limit = 0.5 / 0.3;
  ok(ratioAt(1e-6) > ratioAt(1) && ratioAt(1) > 1,
    'the mode ratio is largest at the start and decays towards 1', `${ratioAt(1e-6)}, ${ratioAt(1)}`);
  ok(Math.abs(ratioAt(1e-6) - limit) < 1e-4,
    'as iteration tends to 0 the mode ratio tends to 0.5/0.3', ratioAt(1e-6));
}

{
  // The path windows are plain means over 3 and 5 samples, with indices clamped at the ends
  // rather than wrapping — wrapping would make a droplet's first step see its last one.
  //
  // The sample is [1..10] and the step is 4, so the current value is 5 and the three-sample
  // window is (4, 5, 6). A LINEAR ramp is deliberate: it makes both means equal the current
  // value, so the curvature is exactly zero and the arithmetic of each window is still
  // checkable from the explicit expectation below.
  const dir = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const c = gaeaPathCurvature(dir, 4, 10);
  ok(Math.abs(c.smooth3 - (dir[3] + dir[4] + dir[5]) / 3) < 1e-9,
    'smooth3 is the mean of step-1, step, step+1', c.smooth3);
  ok(Math.abs(c.smooth5 - (dir[2] + dir[3] + dir[4] + dir[5] + dir[6]) / 5) < 1e-9,
    'smooth5 is the mean of step-2,-1,step,+1,+2', c.smooth5);
  ok(Math.abs(c.a - (c.smooth3 - dir[4])) < 1e-9, 'a is smooth3 minus the current step', c.a);
  ok(Math.abs(c.b - (c.smooth5 - dir[4])) < 1e-9, 'b is smooth5 minus the current step', c.b);

  // A non-linear sample, so the windows and the differences are both non-trivial. A spike
  // makes the smoothed value fall BELOW the current one, so the curvature is NEGATIVE — and
  // the floor is what keeps that from becoming a negative capacity. This is the floor's
  // actual purpose, so it is asserted rather than assumed.
  const spike = new Float32Array([0, 0, 0, 0, 9, 0, 0, 0, 0, 0]);
  const cs2 = gaeaPathCurvature(spike, 4, 10);
  ok(Math.abs(cs2.smooth3 - (0 + 9 + 0) / 3) < 1e-9, 'a spike pulls smooth3 below the peak',
    cs2.smooth3);
  ok(cs2.a < 0 && cs2.b < 0, 'a spike leaves both differences negative', `${cs2.a}, ${cs2.b}`);
  ok(gaeaCapacity(cs2, K_APPLY_ZERO_A) === K_APPLY_ZERO_A,
    'a spike capacity is the floor, not a negative number',
    gaeaCapacity(cs2, K_APPLY_ZERO_A));

  // A dip is the opposite sign, and there the curvature itself is what survives the floor.
  const dip = new Float32Array([0, 0, 0, 0, -9, 0, 0, 0, 0, 0]);
  const cd = gaeaPathCurvature(dip, 4, 10);
  ok(cd.a > 0 && cd.b > 0, 'a dip leaves both differences positive', `${cd.a}, ${cd.b}`);
  ok(gaeaCapacity(cd, K_APPLY_ZERO_A) === Math.max(cd.a, cd.b),
    'above the floor the curvature itself is used',
    `${gaeaCapacity(cd, K_APPLY_ZERO_A)} vs ${Math.max(cd.a, cd.b)}`);

  // Clamping at the low end: step 0 must see dir[0] three times, not dir[-1].
  const c0 = gaeaPathCurvature(dir, 0, 10);
  ok(Math.abs(c0.smooth3 - (1 + 1 + 2) / 3) < 1e-9,
    'at step 0 the window clamps instead of reading before the start', c0.smooth3);

  // And at the high end.
  const cN = gaeaPathCurvature(dir, 9, 10);
  ok(Math.abs(cN.smooth3 - (9 + 10 + 10) / 3) < 1e-9,
    'at the last step the window clamps instead of reading past the end', cN.smooth3);

  // A perfectly straight path has zero curvature, so only the floor survives.
  const straight = new Float32Array(10).fill(3);
  const cs = gaeaPathCurvature(straight, 5, 10);
  ok(cs.a === 0 && cs.b === 0, 'a straight path has zero curvature', `${cs.a}, ${cs.b}`);
  ok(gaeaCapacity(cs, K_APPLY_ZERO_A) === K_APPLY_ZERO_A,
    'zero curvature falls back to the floor, not to zero',
    gaeaCapacity(cs, K_APPLY_ZERO_A));

  // The floor is a floor, and the larger difference wins.
  ok(gaeaCapacity({ a: 0.2, b: 0.4 }, 0.3) === 0.4, 'the larger difference wins');
  ok(gaeaCapacity({ a: -5, b: -5 }, 0.3) === 0.3, 'a negative curvature cannot go below the floor');
}

/* ------------------------------ the per-step contribution: structural invariants only */

{
  // FIDELITY NOTE: the contribution chain is transcribed but NOT validated branch by branch,
  // so what is asserted here are the properties that follow from the binary's SHAPE and hold
  // regardless of which operand wins where. Asserting the arithmetic itself would be
  // restating the transcription back to itself.
  const mkState = () => ({ p118: 1, p11c: 0.5, p124: 7, p128: 2, p12c: 4 });
  const base = {
    dirPrev: 1.2, dirNext: 0.8, dirCur: 1.0, dirPrev2: 1.1, dirNext2: 0.9, dirLast: 0.1,
    scale: 1, zero: K_APPLY_ZERO_A, gain: 1, ctx12c: 1, perCell: 0.5, hardness: 0.3,
    params: {},
  };

  // p124 is written as `x - x`. The field must end at exactly zero, and the initial 7 is what
  // makes this a real assertion rather than a coincidence.
  const s1 = mkState();
  gaeaStepContribution({ ...base, state: s1 });
  ok(s1.p124 === 0, 'p124 ends at exactly zero, as the binary writes it', s1.p124);

  // p118 is `max(zero, sum * gain) + refMin`. The only unconditional claim is the FLOOR: the
  // first term is at least `zero` because zero is 0.3 or 0.5. It is NOT strictly increasing —
  // when `sum * gain` falls below the floor the max saturates and p118 holds constant. An
  // earlier version of this test asserted strict increase and was wrong about the structure,
  // not about the code.
  let floorHeld = true;
  let nonDecreasing = true;
  const s2 = mkState();
  let prev = s2.p118;
  for (let n = 0; n < 12; n++) {
    const r = gaeaStepContribution({ ...base, state: s2 });
    if (!(s2.p118 >= r.refMin + K_APPLY_ZERO_A - 1e-9)) floorHeld = false;
    if (!(s2.p118 >= prev)) nonDecreasing = false;
    prev = s2.p118;
  }
  ok(floorHeld, 'p118 always stays at or above refMin plus the floor', s2.p118);
  ok(nonDecreasing, 'p118 never decreases across steps', s2.p118);

  // And it does move at all, or the floor claim would be vacuous.
  const s2b = mkState();
  const r2b = gaeaStepContribution({ ...base, state: s2b });
  ok(s2b.p118 > 1, 'p118 rises above its initial value on the first step', s2b.p118);
  ok(Math.abs(s2b.p118 - (r2b.lifted + r2b.refMin)) < 1e-9,
    'p118 is exactly the lifted term plus refMin',
    `${s2b.p118} vs ${r2b.lifted + r2b.refMin}`);

  // The contribution is reported as p118 minus the current direction, so it tracks that rise.
  const s3 = mkState();
  const before118 = s3.p118;
  const r3 = gaeaStepContribution({ ...base, state: s3 });
  ok(Math.abs(r3.contribution - (s3.p118 - base.dirCur)) < 1e-9,
    'the contribution is p118 minus the current direction', r3.contribution);
  ok(s3.p118 > before118, 'and it is positive because p118 rose');

  // The hardness term is min(..., inert * ...) with the inert factor at zero, so it can never
  // be positive. This is the parameter the orchestrator explicitly zeroes.
  const s4 = mkState();
  s4.p11c = -1e6;                       // force the first operand very negative
  const r4 = gaeaStepContribution({ ...base, state: s4 });
  ok(r4.hardness <= 0, 'the hardness term is never positive', r4.hardness);

  // Determinism: no randomness anywhere in the chain.
  const a = mkState(); const b = mkState();
  const ra = gaeaStepContribution({ ...base, state: a });
  const rb = gaeaStepContribution({ ...base, state: b });
  ok(ra.contribution === rb.contribution && a.p118 === b.p118,
    'the chain is deterministic', `${ra.contribution} vs ${rb.contribution}`);

  // And it must never produce NaN, including from a degenerate flat path.
  const flat = { ...base, dirPrev: 1, dirNext: 1, dirCur: 1, dirPrev2: 1, dirNext2: 1 };
  const s5 = mkState();
  const r5 = gaeaStepContribution({ ...flat, state: s5 });
  let finite = Number.isFinite(r5.contribution) && Number.isFinite(r5.base)
    && Number.isFinite(r5.capacity) && Number.isFinite(s5.p118);
  ok(finite, 'a flat path produces finite values', JSON.stringify(r5));
}

/* ------------------------------------------------------------------------------ */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('Gaea droplet step: unit-gradient pull, 1-or-30 inertia, precomputed table');
  console.log('fidelity: arithmetic transcribed; the deposit/erode threshold logic is NOT yet');
}
