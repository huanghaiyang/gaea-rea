/**
 * erosion.js — hydraulic and thermal erosion kernels.
 *
 * Three independent solvers live here; each one is a self-contained, deterministic
 * simulation. See IMPLEMENTATION-NOTES.md for how each relates to Gaea's Erosion / Erosion2 /
 * Thermal nodes (short version: the exposed parameter *names* are Gaea's, the numerical
 * model is a standard published algorithm, not a transcription of Gaea's solver).
 *
 *   hydraulicDroplet()  — particle/"droplet" hydraulic erosion (Hansson et al. style)
 *   streamPower()       — D8 flow accumulation + stream-power incision/deposition
 *   thermalTalus()      — thermal (talus-angle) relaxation with anisotropic transport
 */

import { createField, clamp01, clamp, gaussianBlur, cloneField, stats } from '../kernel/field.js';
import { pyramidDownsample, pyramidUpsample } from './pyramid.js';
import { makeRng } from '../kernel/hash.js';

function P(params, name, dflt) {
  const v = params ? params[name] : undefined;
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
  return v;
}

/* ------------------------------------------------------------------ shared helpers */

/** Bilinear height sample with clamping, returns 0 outside. */
function hAt(h, size, x, y) {
  if (x < 0 || y < 0 || x > size - 1 || y > size - 1) return 0;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const x1 = xi + 1 > size - 1 ? size - 1 : xi + 1;
  const y1 = yi + 1 > size - 1 ? size - 1 : yi + 1;
  const a = h[yi * size + xi], b = h[yi * size + x1];
  const c = h[y1 * size + xi], d = h[y1 * size + x1];
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/** Height gradient by central differences. */
function gradientAt(h, size, x, y) {
  const xm = x < 1 ? 0 : x - 1, xp = x > size - 2 ? size - 1 : x + 1;
  const ym = y < 1 ? 0 : y - 1, yp = y > size - 2 ? size - 1 : y + 1;
  return [
    (h[y * size + xp] - h[y * size + xm]) * 0.5,
    (h[yp * size + x] - h[ym * size + x]) * 0.5,
  ];
}

/** D8 receiver map: index of the steepest downhill neighbour, or -1 for a pit. */
export function computeD8(h, size) {
  const recv = new Int32Array(size * size).fill(-1);
  const dist = new Float32Array(size * size);
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DD = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hc = h[i];
      let best = 0, bi = -1, bd = 1;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        const s = (hc - h[j]) / DD[k];
        if (s > best) { best = s; bi = j; bd = DD[k]; }
      }
      recv[i] = bi;
      dist[i] = bd;
    }
  }
  return { recv, dist };
}

/**
 * Flow accumulation in *units of upslope area* using D8 and a descending-height sweep.
 * O(N^2 log N) from the sort. Returns Float32Array of accumulation counts (>=1 per cell).
 */
export function flowAccumulation(h, size) {
  const { recv } = computeD8(h, size);
  const order = new Uint32Array(size * size);
  for (let i = 0; i < order.length; i++) order[i] = i;
  const arr = Array.from(order);
  arr.sort((a, b) => h[b] - h[a]);
  const acc = new Float32Array(size * size).fill(1);
  for (let k = 0; k < arr.length; k++) {
    const i = arr[k];
    const r = recv[i];
    if (r >= 0) acc[r] += acc[i];
  }
  return { acc, recv };
}

import { gaeaFlowReceiverMax } from './relaxation.js';

/* ---------------------------------------------------- Gaea's droplet step (FUN_1801f0440) */

/**
 * Constants from the droplet step. Every one was read out of the image, not chosen.
 *
 * `K_DIR_INERTIA`  `0x180356210` = 0.5    weight on the previous direction
 * `K_DIR_TABLE`    `0x1803561ec` = 0.25   weight on the precomputed random direction table
 * `K_DIR_DEPOSIT`  `0x180356374` = 30.0   multiplier on the inertia term right after a deposit
 * `K_BORDER`       `0x1803562c0` = 1.5    cell margin the droplet must stay inside
 * `DROPLET_STEPS`  the loop bound is the literal `0xb`
 */
export const K_DIR_INERTIA = 0.5;
export const K_DIR_TABLE = 0.25;
export const K_DIR_DEPOSIT = 30.0;
export const K_BORDER = 1.5;
export const DROPLET_STEPS = 11;

/**
 * One droplet direction update, transcribed from `FUN_1801f0440`.
 *
 *     blend = justDeposited ? 30.0 : 1.0
 *     dir   = 0.5 * prevDir * blend  +  0.25 * table[i]  -  gradient / |gradient|
 *     dir  /= |dir|
 *
 * THREE THINGS THIS CORRECTS IN THIS BUILD'S OWN MODEL
 *
 * 1. The downhill pull is the UNIT gradient, not the raw gradient. `erodeLevel` used
 *    `dir -= grad * (1 - inertia)`, which lets a steep cell dominate in proportion to its
 *    steepness; Gaea normalises first, so every cell pulls equally and only the DEFLECTION
 *    differs.
 * 2. The inertia term is `prevDir * blend`, not `prevDir * inertia`, and `blend` is 1 or 30
 *    — not a fractional weight. Inertia is either full-strength or thirty times
 *    full-strength, the latter immediately after the droplet deposited. A fractional 0.05
 *    has no counterpart here.
 * 3. A quarter of the direction comes from a PRECOMPUTED RANDOM TABLE, not from a fresh
 *    random draw. `FUN_1801f2100`'s SPIR-V sibling `create_random_directions` builds it, and
 *    each particle walks it by its own index, so the jitter is deterministic per particle
 *    and identical across parallel workers. A per-step `Math.random()`-style draw cannot
 *    reproduce that, and it would also break the cross-worker determinism.
 *
 * AXIS ASSIGNMENT IS UNCERTAIN. The decompiler feeds the two gradient components into the
 * two output lanes in an order that depends on how it named the bilinear samples, and I could
 * not pin which is x and which is y from the decompilation alone. The two components are
 * symmetric in every other respect, so this affects orientation only, not magnitude.
 *
 * @param {object} o
 * @param {number} o.gx,o.gy   gradient at the droplet's new cell
 * @param {number} o.prevX,o.prevY  the direction it was travelling
 * @param {number} o.tableX,o.tableY the precomputed random unit direction for this step
 * @param {boolean} o.justDeposited  whether the previous step deposited
 * @returns {{x: number, y: number}|null} a unit vector, or null on a flat cell
 */
export function gaeaDropletDirection({ gx, gy, prevX, prevY, tableX, tableY, justDeposited }) {
  const mag = Math.sqrt(gx * gx + gy * gy);
  // A flat cell has no downhill direction. The binary takes the `mag <= 0` branch and
  // terminates the droplet, which is what the null return signals here.
  if (!(mag > 0)) return null;

  const blend = justDeposited ? K_DIR_DEPOSIT : 1.0;
  let dx = K_DIR_INERTIA * prevX * blend + K_DIR_TABLE * tableX - gx / mag;
  let dy = K_DIR_INERTIA * prevY * blend + K_DIR_TABLE * tableY - gy / mag;

  const m = Math.sqrt(dx * dx + dy * dy);
  if (!(m > 0)) return null;
  return { x: dx / m, y: dy / m };
}

/**
 * The precomputed random-direction table, standing in for Gaea's
 * `resampling::create_random_directions` / `parallel_erosion::create_random_directions`.
 *
 * Gaea builds a table of unit vectors once and every droplet walks it by its own index
 * (`param_2[0x130] = (param_2[0x130] + 1) & param_1[0x94]`), which is why the jitter is
 * deterministic and repeatable across workers. The table is a fixed-size array of float
 * pairs; the mask `param_1[0x94]` is its power-of-two length minus one.
 *
 * @param {number} count must be a power of two, matching the mask Gaea uses
 * @param {number} seed
 * @returns {Float32Array} `count * 2` floats: unit x, unit y, unit x, unit y, ...
 */
export function gaeaDirectionTable(count, seed) {
  const n = Math.max(1, count | 0);
  const out = new Float32Array(n * 2);
  const rng = makeRng(seed);
  for (let i = 0; i < n; i++) {
    const a = rng.unit() * Math.PI * 2;
    out[i * 2] = Math.cos(a);
    out[i * 2 + 1] = Math.sin(a);
  }
  return out;
}

/* ---------------------------------------------------- Gaea's droplet step (end) */

/* ------------------------------------- the per-step contribution (FUN_1801f0c60, inner) */

/**
 * The per-step contribution, transcribed from the inner loop of `FUN_1801f0c60`.
 *
 * FIDELITY: `approx`, and deliberately NOT wired into the solver.
 *
 * The chain of nested `min`/`max` over six mutable particle fields was read off a dense
 * decompilation. The sequence, the constants and the parameter names are all established, but
 * several individual branches — which operand wins where, and the precise order of the two
 * `p128` writes — have NOT been validated against reference output, because no reference
 * output is available for this build. A transcription in that state is exactly the kind that
 * looks correct, so it is exported for testing and isolated from `erodeLevel` until the
 * branches can be pinned.
 *
 * WHAT IS ASSERTED, AND WHY IT IS ENOUGH TO BE WORTH KEEPING
 * Three structural properties follow from the binary's shape rather than from the arithmetic,
 * so they hold regardless of the branch details:
 *
 *   * `p124` is written as `x - x`, i.e. exactly zero. A store, not a dead expression.
 *   * `p118` advances by `max(zero, ...)` with `zero` in {0.3, 0.5}, so it STRICTLY increases
 *     every step. This is checkable and a sign error anywhere upstream breaks it.
 *   * the hardness term is `min(..., ctx12c * 0.02 * inertFactor * hardness)` where
 *     `inertFactor` is the parameter the orchestrator zeroes, so hardness can never be
 *     positive.
 *
 * The particle carries six mutable float fields that this function reads and writes. They are
 * passed as an explicit state object rather than hidden, so each write is visible.
 *
 * @param {object} o
 * @param {number} o.dirPrev,o.dirNext,o.dirCur       direction history around the step
 * @param {number} o.dirPrev2,o.dirNext2              the wider window
 * @param {number} o.dirLast                          the step's own recorded value
 * @param {number} o.scale                            the running path scale
 * @param {number} o.zero                             0.3 or 0.5, from the dispatch mode
 * @param {number} o.gain                             from gaeaIterationGain
 * @param {number} o.ctx12c                           context + 0x12c, a per-droplet accumulator
 * @param {number} o.perCell                          the per-cell physical size
 * @param {number} o.hardness                         the per-cell erodibility sample
 * @param {object} o.params                           the node parameters, by storage key
 * @param {Float32Array|object} o.state               {p118, p11c, p124, p128, p12c}
 * @returns {{contribution: number, base: number, capacity: number, p118: number}}
 */
export function gaeaStepContribution(o) {
  const {
    dirPrev, dirNext, dirCur, dirPrev2, dirNext2, scale, zero, gain, params, state,
  } = o;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const downcutting = num(params?.Downcutting, 0.25);
  const downcuttingType = num(params?.DowncuttingType, 0);
  const extraBoost = num(params?.ExtraDepositionBoost, 0);
  const suspendedAmount = num(params?.SuspendedLoadDischargeAmount, 1);
  const bedAmount = num(params?.BedLoadDischargeAmount, 0);
  const coarseAmount = num(params?.CoarseSedimentsDischargeAmount, 0);
  const suspendedTh = gaeaDischargeThreshold(num(params?.SuspendedLoadDischargeAngle, 10));
  const bedTh = gaeaDischargeThreshold(num(params?.BedLoadDischargeAngle, 10));
  const coarseTh = gaeaDischargeThreshold(num(params?.CoarseSedimentsDischargeAngle, 10));

  // 1. path asymmetry, floored
  const slopeDiff = Math.max(zero, (dirPrev - dirNext) / (scale || 1));

  // 2. a soft saturation, armed only past the suspended threshold
  let recip = 1;
  if (!(suspendedTh <= slopeDiff * suspendedAmount)) {
    recip = 1 / (slopeDiff * 5 + 1);          // 0x180356340 = 5
  }

  // 3. curvature and the capacity base
  const smooth3 = (dirPrev + dirCur + dirNext) / 3;
  const smooth5 = (dirPrev2 + dirPrev + dirCur + dirNext + dirNext2) / 5;
  const a = smooth3 - dirCur;
  const b = smooth5 - dirCur;
  const capacity = gaeaCapacity({ a, b }, zero) * recip;

  // 4. the base term. The reference is smooth3 when either curvature is non-negative.
  const reference = (0 <= a || 0 <= b) ? smooth3 : smooth5;
  const refMin = Math.min(dirCur, reference);
  // The third factor is the never-set parameter the orchestrator zeroes, so that product is
  // identically zero for Erosion2 — transcribed as-is rather than dropped, so the reason
  // stays visible.
  const inertFactor = num(params?.__neverSetIndex9, 0);
  const base = (refMin - (dirNext2 * 0.95 + o.dirLast)) * o.ctx12c * (1 - downcuttingType)
             + downcuttingType * downcutting * (o.perCell || 0) * 0.15;

  // 5. the gated additions
  let value = capacity;
  if (base + capacity < state.p128) {
    if (state.p128 * 0.8 < slopeDiff && slopeDiff < state.p128 * 1.25) {
      value = capacity + Math.min(state.p128 * coarseAmount, base);
    }
    if (slopeDiff < bedTh) {
      const scale100 = slopeDiff < bedTh * 0.1 ? 100 : 1;
      value += Math.min(refMin * 0.3 * bedAmount * scale100, base);
    }
    void coarseTh;
  }

  // 6. advance the running height: strictly positive, so p118 rises every step
  const p118Prev = state.p118;
  let applied = Math.min((p118Prev - refMin) * 0.9, value);
  applied = Math.min(applied, state.p128);
  const hardness = Math.min((state.p11c - (applied + refMin)) * 0.95,
    o.ctx12c * 0.02 * inertFactor * (o.hardness || 0));
  state.p11c = p118Prev;
  const sum = hardness + applied;
  const lifted = Math.max(zero, sum * gain);
  const p118 = lifted + refMin;

  // 7. the two writes that look like no-ops
  state.p124 = p118Prev - p118Prev;            // exactly zero
  state.p12c = state.p12c - (1 - extraBoost) * hardness;
  state.p118 = p118;

  // 8. the contribution
  const raw = p118 - dirCur;
  const scaled = raw >= 0 ? raw * 1.05 : raw;
  const p128 = Math.max(zero, (lifted - sum) * extraBoost + (state.p128 - scaled));
  state.p128 = p128;

  return { contribution: raw, base, capacity, applied, hardness, value, p118, p128, refMin, lifted };
}

/* ------------------------------------- the per-step contribution (end) */

/* ----------------------------------- the apply's two clean sub-expressions (FUN_1801f0c60) */

/**
 * `FUN_1801f0c60` selects its "zero" reference from the dispatch mode, and that choice
 * propagates through every clamp in the function:
 *
 *     zero = (dispatchMode == 0) ? 0.3 : 0.5      // 0x1803561f0 : 0x180356210
 *
 * It is not a rounding epsilon. It is the floor of the capacity term, so it sets how much
 * material a droplet moves even where the path is locally straight.
 */
export const K_APPLY_ZERO_A = 0.3;
export const K_APPLY_ZERO_B = 0.5;

/** The 3-term and 5-term path averages are plain means: divisors 3.0 and 5.0. */
export const K_PATH_WINDOW_3 = 3;
export const K_PATH_WINDOW_5 = 5;

/** `0x3fb33333` at `0x1803562b0`. */
export const K_GAIN_SCALE = 1.4;

/**
 * The iteration-dependent gain.
 *
 *     fVar19 = expf(zero * -iteration);
 *     gain   = (1 - fVar19) * DepositionBoost * 1.4 + 1;
 *
 * A saturating ramp: exactly 1 at iteration 0, rising towards `1 + 1.4 * DepositionBoost` as
 * the simulation proceeds. So `DepositionBoost` is not a constant offset — it is the DEPTH of
 * a ramp whose time constant is `1 / zero`, and the two mode values 0.3 and 0.5 make that
 * ramp reach its plateau about 1.67x faster in the second mode.
 *
 * The `iteration` here is `context + 0x110`, the counter the orchestrator increments once per
 * level pass.
 *
 * @param {object} o
 * @param {number} o.iteration
 * @param {number} o.depositionBoost
 * @param {number} [o.mode=0] 0 selects 0.3, anything else selects 0.5
 * @returns {number} the gain, >= 1
 */
export function gaeaIterationGain({ iteration, depositionBoost, mode = 0 }) {
  const zero = mode === 0 ? K_APPLY_ZERO_A : K_APPLY_ZERO_B;
  const n = Number.isFinite(iteration) && iteration > 0 ? iteration : 0;
  const boost = Number.isFinite(depositionBoost) ? depositionBoost : 0;
  const decay = Math.exp(-zero * n);
  return (1 - decay) * boost * K_GAIN_SCALE + 1;
}

/**
 * The two smoothed path samples and their differences from the current step.
 *
 *     smooth3 = (dir[step-1] + dir[step] + dir[step+1]) / 3       // 0x180356330 = 3.0
 *     smooth5 = (dir[step-2] + dir[step-1] + dir[step] + dir[step+1] + dir[step+2]) / 5
 *
 * Indices clamp to the ends rather than wrapping or shrinking the window, matching the
 * binary's `if (i < 0) i = 0; if (count-1 < i) i = count-1;` guards.
 *
 * The two differences `a` and `b` are the curvature of the droplet's own path: how far the
 * local direction departs from its 3- and 5-step means. The capacity term takes the larger
 * of the two and floors it at `zero`, so a path that is locally straight still carries the
 * floor amount.
 *
 * @param {Float32Array} dir  the per-step direction values at `particle + 0`
 * @param {number} step
 * @param {number} count      number of valid steps
 * @returns {{smooth3: number, smooth5: number, a: number, b: number}}
 */
export function gaeaPathCurvature(dir, step, count) {
  const at = (i) => dir[i < 0 ? 0 : i > count - 1 ? count - 1 : i];
  const cur = at(step);
  const prev = at(step - 1);
  const next = at(step + 1);
  const prev2 = at(step - 2);
  const next2 = at(step + 2);

  const smooth3 = (prev + cur + next) / K_PATH_WINDOW_3;
  const smooth5 = (prev2 + prev + cur + next + next2) / K_PATH_WINDOW_5;
  return { smooth3, smooth5, a: smooth3 - cur, b: smooth5 - cur };
}

/**
 * The capacity term: the larger of the two curvature differences, floored at `zero`.
 *
 *     auVar6 = max(fVar4, fVar3);  auVar6 = max(zero, auVar6);
 *
 * @param {{a: number, b: number}} curvature
 * @param {number} zero
 * @returns {number}
 */
export function gaeaCapacity(curvature, zero) {
  const m = Math.max(curvature.b, curvature.a);
  return m > zero ? m : zero;
}

/* ----------------------------------- the apply's clean parts (end) */

/* --------------------------------------- Parameters layout and its context offsets */

/**
 * `ParallelErosion_Erode` copies the caller's `Parameters` verbatim into a 0x140-byte context
 * struct, as twelve 8-byte moves starting at `context + 0x98`. Twelve qwords is 96 bytes,
 * exactly the size of `Parameters`, so:
 *
 *     context + 0x98 + parametersOffset  ==  the context offset the algorithm reads
 *
 * This layout is derived INDEPENDENTLY of the native offsets, from the field order recovered
 * from the managed assembly's call site. Asserting that the two agree is therefore a real
 * cross-check between two different artefacts rather than a restatement of one.
 *
 * NATURAL ALIGNMENT
 * `Resolution` is 8 bytes (two int32), then twenty `Single` fields, one `Int32`, and one
 * `Boolean`. The `Int32` falls at a 4-byte boundary naturally; the `Boolean` is last, so the
 * struct pads from 93 to 96 bytes with no interior padding. That is what makes the offsets
 * predictable without reading a compiler's layout decision.
 */
const PARAMETER_FIELDS = [
  ['Resolution', 'Resolution'],
  ['TerrainWidth', 'Single'],
  ['TerrainHeight', 'Single'],
  ['ErosionScale', 'Single'],
  [null, 'Single'],                          // never set by PE()
  ['Duration', 'Single'],
  [null, 'Single'],                          // never set by PE()
  ['Seed', 'Int32'],
  ['Downcutting', 'Single'],
  [null, 'Single'],                          // never set by PE()
  ['Shape', 'Single'],
  ['ShapeSharpness', 'Single'],
  ['ShapeDetailScale', 'Single'],
  ['SuspendedLoadDischargeAmount', 'Single'],
  ['SuspendedLoadDischargeAngle', 'Single'],
  ['BedLoadDischargeAmount', 'Single'],
  ['BedLoadDischargeAngle', 'Single'],
  ['CoarseSedimentsDischargeAmount', 'Single'],
  ['CoarseSedimentsDischargeAngle', 'Single'],
  ['DowncuttingType', 'Single'],
  ['DepositionBoost', 'Single'],
  ['ExtraDepositionBoost', 'Single'],
  ['NoErosion', 'Boolean'],
];

const TYPE_SIZE = { Resolution: 8, Single: 4, Int32: 4, Boolean: 1 };
const TYPE_ALIGN = { Resolution: 4, Single: 4, Int32: 4, Boolean: 1 };

/** Byte offset of each parameter within `Parameters`, computed from the field list. */
export const PARAMETER_OFFSETS = (() => {
  const out = {};
  let at = 0;
  for (const [name, type] of PARAMETER_FIELDS) {
    const align = TYPE_ALIGN[type];
    at = Math.ceil(at / align) * align;
    if (name) out[name] = at;
    at += TYPE_SIZE[type];
  }
  out.__size = Math.ceil(at / 4) * 4;
  return out;
})();

/** Where the verbatim `Parameters` copy begins inside the erosion context. */
export const CONTEXT_PARAMETERS_BASE = 0x98;

/**
 * The context offset the native code reads for a given parameter.
 * @param {string} name
 * @returns {number|undefined}
 */
export function contextOffsetFor(name) {
  const p = PARAMETER_OFFSETS[name];
  return p === undefined ? undefined : CONTEXT_PARAMETERS_BASE + p;
}

/* --------------------------------------- Parameters layout (end) */

/* ---------------------------------------------------- discharge angles (FUN_1801f24f0) */

/**
 * Gaea converts each sediment's discharge ANGLE into a slope tangent and uses it as a
 * deposition threshold:
 *
 *     threshold = tan(angle_degrees / 180 * PI)
 *
 * transcribed from three `tanf` calls in `FUN_1801f24f0`:
 *
 *     param_1[0x124] = tanf((param_1[0xdc] / 180.0) * PI);   // one load type
 *     param_1[0x128] = tanf((param_1[0xe4] / 180.0) * PI);   // another
 *     param_1[0x120] = tanf((param_1[0xd4] / 180.0) * PI);   // the third
 *
 * The two constants are `0x43340000` = 180.0 at `0x180356398` and `0x40490fdb` = PI at
 * `0x180356334`, so this is the plain degrees-to-radians conversion.
 *
 * WHY THIS MATTERS FOR FIDELITY
 * This build's `Erosion2` accepted the three discharge angles as parameters and did nothing
 * with them — the UI matched Gaea while the algorithm ignored them. The offsets above show
 * exactly what they feed: `FUN_1801f0c60` reads `param_1[0x120]`, `[0x124]` and `[0x128]` as
 * thresholds gating an additional deposition term. So the angles are a PHYSICAL PARAMETER of
 * the deposition rule, not decoration.
 *
 * A tangent rather than the raw angle is the right form: a threshold on the terrain's local
 * gradient is a slope, and `tan` converts the angle at which material settles into the slope
 * that corresponds to it.
 *
 * @param {number} degrees
 * @returns {number} the slope tangent, or 0 for a non-finite input
 */
/** Gaea's declared range for all three discharge angles: 0..45 degrees. */
export const DISCHARGE_ANGLE_RANGE = [0, 45];

export function gaeaDischargeThreshold(degrees) {
  const d = Number.isFinite(degrees) ? degrees : 0;
  /*
   * Clamped to the DECLARED range, not to 90 degrees.
   *
   * Clamping at 90 looks like the natural choice — a vertical slope — but `tan(PI/2)` is not
   * infinity in floating point: PI/2 is not exactly representable, so it returns about
   * 1.6e16. A threshold that large is never crossed, which silently disables the deposition
   * term instead of saturating it. Clamping at the top of Gaea's own range gives the
   * well-defined value 1 and keeps the ordering monotone.
   */
  const [lo, hi] = DISCHARGE_ANGLE_RANGE;
  const clamped = d < lo ? lo : d > hi ? hi : d;
  return Math.tan((clamped / 180) * Math.PI);
}

/**
 * The three deposition thresholds, in the order the catalogue lists them.
 *
 * The catalogue's defaults are 10 / 10 / 10 (what the node actually sends). The native
 * `PE()` signature declares 24 / 15 / 10, but those apply only when no argument is passed, so
 * they are fallbacks rather than the effective values.
 *
 * @param {object} params the node's parameter object
 * @returns {{suspended: number, bed: number, coarse: number}} slope tangents
 */
export function gaeaDepositionThresholds(params) {
  const q = (name, dflt) => {
    const v = P(params, name, dflt);
    return Number.isFinite(v) ? v : dflt;
  };
  return {
    suspended: gaeaDischargeThreshold(q('SuspendedLoadDischargeAngle', 10)),
    bed: gaeaDischargeThreshold(q('BedLoadDischargeAngle', 10)),
    coarse: gaeaDischargeThreshold(q('CoarseSedimentsDischargeAngle', 10)),
  };
}

/* ---------------------------------------------------- discharge angles (end) */

/* ------------------------------------------- Gaea's real parameter ranges and scaling */

/**
 * The ranges Gaea's UI actually declares for Erosion2, taken from the vendor catalogue's IL
 * metadata (`Nodes.json`). Exported so a test can assert them against the catalogue rather
 * than trusting this transcription.
 */
export const GAEA_EROSION_RANGES = {
  Duration: [1, 200],
  Downcutting: [0, 1],
  'Erosion Scale': [1, 20000],
  'Suspended Load': [0, 1],
  'Bed Load': [0, 1],
  'Coarse Sediments': [0, 1],
  Shape: [0, 1],
  'Shape Sharpness': [0, 1],
  'Shape Detail Scale': [0, 1],
};

/**
 * How values arriving in Gaea's units become the 0..1 dials this solver works in.
 *
 * THESE ARE MODEL CHOICES, NOT GAEA'S FORMULAS. Gaea's own mapping from `Duration` to a
 * droplet count lives in the native kernel and has not been recovered, so what follows is
 * calibrated to reproduce this build's previous behaviour at the catalogue defaults while
 * opening up Gaea's full input range:
 *
 *   Duration      linear by 1/20. The catalogue default 10 then yields the same droplet
 *                 budget the old 0..1 dial gave at 0.5. Gaea's ceiling of 200 reaches 10x.
 *   Erosion Scale logarithmic over three decades. 1..20000 is too wide for a linear map to
 *                 be usable; log puts the default 1000 at 0.697, which rounds to the same
 *                 brush radius (3 cells) the old 0..1 dial gave at 0.5.
 *   everything else, including the three discharge angles, passes through clamped to 0..1.
 */
export function gaeaDial(name, value) {
  const v = Number.isFinite(value) ? value : 0;
  switch (name) {
    case 'Duration':
      return Math.max(0, v) / 20;
    case 'Erosion Scale': {
      const lo = GAEA_EROSION_RANGES['Erosion Scale'][0];
      const hi = GAEA_EROSION_RANGES['Erosion Scale'][1];
      return clamp01(Math.log(Math.max(lo, v) / lo) / Math.log(hi / lo));
    }
    default:
      return clamp01(v);
  }
}

/* ------------------------------------------------------------------ hydraulic droplet erosion */

/**
 * Particle-based hydraulic erosion (droplet model).
 *
 * Each droplet follows the height gradient, picks up sediment when it has spare capacity and
 * deposits it when it does not. This is the standard published formulation; the Gaea parameter
 * names are mapped onto it as follows (see IMPLEMENTATION-NOTES.md):
 *
 *   Duration        -> droplet count = Duration * 0.8 * size^2
 *   Downcutting     -> erosion rate multiplier
 *   Erosion Scale   -> erosion brush radius (1..4 cells)
 *   Suspended Load  -> sediment capacity constant
 *   Bed Load        -> deposit rate
 *   Coarse Sediments-> deposit footprint (point / 1 cell / 2 cells)
 *   DepositionBoost -> extra deposition multiplier
 *   Shape / Shape Sharpness / Shape Detail Scale -> valley post-shaping
 *   Enable / NoErosion -> early-out (field returned untouched)
 *   Seed            -> RNG seed
 *
 * SCALE: the engine works on a normalised 0..1 height field, while the droplet equations are
 * conventionally written for metre-scale terrain. We therefore do all the erosion arithmetic in
 * metres (TERRAIN_HEIGHT_M) and convert back at the end, which is what keeps the sediment
 * capacity in a sane ratio to the terrain instead of letting deposition run away.
 */
const TERRAIN_HEIGHT_M = 800;

/* ------------------------------------------------------- droplet core (reusable) */

/**
 * Build the normalized erosion brush: a disc of weights with linear falloff.
 * @returns {{offsets: number[][], sum: number}}
 */
function makeBrush(erosionRadius) {
  const offsets = [];
  let sum = 0;
  const r2 = erosionRadius * erosionRadius;
  for (let dy = -erosionRadius; dy <= erosionRadius; dy++) {
    for (let dx = -erosionRadius; dx <= erosionRadius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const w = 1 - Math.sqrt(d2) / (erosionRadius + 1e-6);
      offsets.push([dx, dy, w]);
      sum += w;
    }
  }
  if (sum <= 0) { offsets.push([0, 0, 1]); sum = 1; }
  return { offsets, sum };
}

/**
 * Run the droplet solver over one metre-space height grid, in place.
 *
 * Extracted from `hydraulicDroplet` so the single-scale and pyramid solvers share one
 * implementation. The arithmetic, the RNG consumption order and the stability bounds
 * are unchanged, which is what lets the existing erosion assertions keep guarding it.
 *
 * @param {Float32Array} h   metres, size*size, mutated
 * @param {number} size
 * @param {object} cfg       see the call sites
 * @param {{unit: () => number}} rng
 */
function erodeLevel(h, size, cfg, rng) {
  const {
    droplets, maxSteps, inertia, capacityFactor, minCapacity,
    erodeRate, depositRate, evaporate, gravity, maxDepositPerStep,
    brushOffsets, brushSum, depositRadius, depBoost, extraBoost,
  } = cfg;
  // Height-weighted seeding is Gaea's behaviour (FUN_1801f2100). It can be switched off so
  // the difference is measurable rather than asserted.
  const heightWeightedSpawn = cfg.heightWeightedSpawn !== false;

  let posX = 0, posY = 0, dirX = 0, dirY = 0, speed = 0, water = 0, sediment = 0;

  /*
   * Height-weighted droplet seeding — transcribed from FUN_1801f2100.
   *
   * Gaea draws a uniformly random position and keeps the droplet only when a SECOND,
   * independent random draw falls below the normalised height at that position:
   *
   *     if (rand01 < height/HEIGHT_MAX)  accept
   *
   * so the seeding density is proportional to elevation rather than uniform. The second
   * stream uses its own seed multiplier (seed * 111251), separate from the position stream
   * (seed * 111143) — the two are not interchangeable, and reusing one for both would
   * correlate a droplet's position with whether it survives.
   *
   * BUDGET CONSEQUENCE, which is easy to get wrong: rejection sampling accepts only a
   * fraction of candidates, that fraction being the terrain's mean normalised height. Feeding
   * the same `droplets` count as before would silently erode with a small fraction of the
   * intended droplet count and look like "the erosion got weaker". So the candidate count is
   * the target divided by the mean height, keeping the ACCEPTED count on target.
   */
  let meanNormHeight = 0;
  {
    let sum = 0;
    for (let i = 0; i < h.length; i++) sum += h[i];
    meanNormHeight = sum / h.length / TERRAIN_HEIGHT_M;
  }
  const candidates = heightWeightedSpawn && meanNormHeight > 1e-6
    ? Math.min(50_000_000, Math.round(droplets / meanNormHeight))
    : droplets;

  for (let n = 0; n < candidates; n++) {
    posX = rng.unit() * (size - 1);
    posY = rng.unit() * (size - 1);

    if (heightWeightedSpawn) {
      const hv = hAt(h, size, posX, posY) / TERRAIN_HEIGHT_M;
      if (rng.unit() >= hv) continue;   // rejected: this candidate does not become a droplet
    }

    dirX = 0; dirY = 0; speed = 1; water = 1; sediment = 0;

    for (let step = 0; step < maxSteps; step++) {
      const nodeX = posX | 0, nodeY = posY | 0;
      const idx = nodeY * size + nodeX;
      if (nodeX < 0 || nodeY < 0 || nodeX >= size - 1 || nodeY >= size - 1) break;

      const h00 = h[idx], h10 = h[idx + 1];
      const h01 = h[idx + size], h11 = h[idx + size + 1];
      const fx = posX - nodeX, fy = posY - nodeY;
      const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      // Use the SAME clamped sampler that is used for the target height. Mixing in an
      // unclamped, corner-offset estimate here made the border look like a cliff, which
      // produced runaway deposition (observed max ~15 on a 0..1 field).
      const hOld = hAt(h, size, posX, posY);

      // direction, with inertia toward the previous direction
      dirX = dirX * inertia - gx * (1 - inertia);
      dirY = dirY * inertia - gy * (1 - inertia);
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len < 1e-8) {
        const a = rng.unit() * Math.PI * 2;   // escape flat regions
        dirX = Math.cos(a); dirY = Math.sin(a);
      } else {
        dirX /= len; dirY /= len;
      }

      const nxp = posX + dirX, nyp = posY + dirY;
      if (nxp < 0 || nyp < 0 || nxp >= size - 1 || nyp >= size - 1) break;
      const hNew = hAt(h, size, nxp, nyp);
      const dh = hNew - hOld;

      // Capacity is the transported load the flow can hold, in metres. It is bounded by the
      // drop just travelled (a classic stability requirement) so a single droplet can never
      // gouge more than the step it just took.
      const capacity = Math.max(
        Math.min(-dh * speed * water * capacityFactor, -dh * 1.5),
        minCapacity,
      );

      if (sediment > capacity) {
        // Over capacity: the surplus settles here.
        const amount = Math.min((sediment - capacity) * depositRate, sediment, maxDepositPerStep);
        if (amount > 0) {
          sediment -= amount;
          deposit(h, size, nxp, nyp, amount, depositRadius, depBoost, extraBoost);
        }
      } else if (dh > 0) {
        // Moving uphill: the droplet cannot carry its load. It refills the step it climbs,
        // but only as far as that step's own rise (never past it), so terrain is not invented.
        const amount = Math.min(dh, sediment, maxDepositPerStep);
        if (amount > 0) {
          sediment -= amount;
          deposit(h, size, nxp, nyp, amount, depositRadius, depBoost, extraBoost);
        }
      } else {
        // Erode up to capacity, distributed over the brush around the droplet's cell.
        const amount = Math.min((capacity - sediment) * erodeRate, -dh);
        if (amount > 0) {
          const bi0 = Math.min(size - 2, Math.max(0, nxp | 0));
          const bj0 = Math.min(size - 2, Math.max(0, nyp | 0));
          let taken = 0;
          for (let b = 0; b < brushOffsets.length; b++) {
            const bx = bi0 + brushOffsets[b][0];
            const by = bj0 + brushOffsets[b][1];
            if (bx < 0 || by < 0 || bx >= size || by >= size) continue;
            const w = brushOffsets[b][2] / brushSum;
            const di = by * size + bx;
            const take = amount * w;
            if (take <= 0) continue;
            const rem = h[di] - take;
            if (rem < 0) { taken += h[di]; h[di] = 0; } else { taken += take; h[di] = rem; }
          }
          sediment += taken;
        }
      }

      speed = Math.sqrt(Math.max(0, speed * speed + -dh * gravity));
      water *= 1 - evaporate;
      posX = nxp; posY = nyp;
      if (water < 0.01) break;
    }
    // A droplet that ran out of steps while still carrying sediment must drop its load where
    // it stopped, spread over the deposit footprint. Without this the tail of the load is
    // either lost (a mass leak of several percent) or dumped in one spike on the next pass.
    if (sediment > 0) {
      const px = Math.min(size - 1, Math.max(0, posX));
      const py = Math.min(size - 1, Math.max(0, posY));
      if (depositRadius > 0) {
        deposit(h, size, px, py, sediment, depositRadius, depBoost, extraBoost);
      } else {
        // fine grains: settle over the brush footprint so a paused droplet does not poke a hole
        deposit(h, size, px, py, sediment, 1, depBoost, extraBoost);
      }
      sediment = 0;
    }
  }
}

export function hydraulicDroplet(ctx) {
  const { size, params, input, seed } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height', 0.5);

  // Parameters arrive in GAEA'S UNITS (Duration 1..200, Erosion Scale 1..20000, ...), not
  // as 0..1 dials. gaeaDial converts them; see its doc comment for what is calibration and
  // what is measured. The single-scale solver is kept on the same convention so the two
  // remain comparable.
  const duration = gaeaDial('Duration', P(params, 'Duration', 10));
  const downcutting = gaeaDial('Downcutting', P(params, 'Downcutting', 0.25));
  const erosionScale = gaeaDial('Erosion Scale', P(params, 'Erosion Scale', 1000));
  const noErosion = !!P(params, 'NoErosion', false);
  const suspended = gaeaDial('Suspended Load', P(params, 'Suspended Load', 1));
  const bedLoad = gaeaDial('Bed Load', P(params, 'Bed Load', 0));
  const coarse = gaeaDial('Coarse Sediments', P(params, 'Coarse Sediments', 0));
  const depBoost = P(params, 'DepositionBoost', 0);
  const extraBoost = P(params, 'ExtraDepositionBoost', 0);
  const shape = gaeaDial('Shape', P(params, 'Shape', 0.2));
  const shapeSharp = gaeaDial('Shape Sharpness', P(params, 'Shape Sharpness', 0.6));
  const shapeDetail = gaeaDial('Shape Detail Scale', P(params, 'Shape Detail Scale', 0.25));
  const enable = P(params, 'Enable', true);
  // Strength of the FUN_1801f2f30 flow gate: 1 is Gaea's full coupling, 0 disables it.
  // Taken from ctx so a test can isolate the gate's effect rather than infer it from output.
  const flowGateStrength = ctx.flowGate === undefined ? 1 : ctx.flowGate;
  // Height-weighted droplet seeding — Gaea's behaviour. Exposed so a test can isolate it.
  const heightWeightedSpawn = ctx.heightWeighted === undefined ? true : ctx.heightWeighted;

  // Work in metres.
  const h = new Float32Array(size * size);
  const stride = src.channels;
  for (let i = 0; i < h.length; i++) {
    const v = src.data[i * stride];
    h[i] = (Number.isFinite(v) ? v : 0) * TERRAIN_HEIGHT_M;
  }

  if (!enable || noErosion || duration <= 0) {
    const out = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) out[i] = h[i] / TERRAIN_HEIGHT_M;
    return { size, channel: 'height', channels: 1, data: out };
  }

  const rng = makeRng(seed);
  // Droplet budget: Duration=0.5 on a 256 grid ~ 26k droplets, enough for believable channels.
  const droplets = Math.max(1000, Math.min(2_000_000, Math.round(duration * 0.8 * size * size)));
  const maxSteps = Math.max(16, Math.min(96, Math.round(size * 0.35)));

  const inertia = 0.05;
  const capacityFactor = 1.0 + suspended * 4.0;
  const minCapacity = 0.01;
  const erodeRate = 0.1 + downcutting * 0.6;
  const depositRate = 0.08 + bedLoad * 0.55;
  const evaporate = 0.01 + (1 - suspended) * 0.02;
  const gravity = 1.4;
  /**
   * Hard bound on how much material one droplet may add to one place in one step. Without it,
   * a droplet that reaches a pit keeps re-depositing while neighbouring droplets keep eroding
   * into the same pit, and the pile grows without limit (observed: a single cell reaching 8.9
   * on a 0..1 field). Bound = a small fraction of the terrain relief.
   */
  const maxDepositPerStep = TERRAIN_HEIGHT_M * 0.004;
  // "Erosion Scale" widens the erosion brush (1..4 cells). Deliberately NOT scaled by grid
  // size: a physically-sized brush would make a 512px build erode visibly differently from the
  // 256px preview, which is worse than a slightly finer channel network at higher resolution.
  const erosionRadius = Math.max(1, Math.min(4, Math.round(1 + erosionScale * 3)));
  const depositRadius = coarse < 0.34 ? 0 : coarse < 0.67 ? 1 : 2;

  const brush = makeBrush(erosionRadius);
  const singleBefore = Float32Array.from(h);
  erodeLevel(h, size, {
    droplets, maxSteps, inertia, capacityFactor, minCapacity,
    erodeRate, depositRate, evaporate, gravity, maxDepositPerStep,
    brushOffsets: brush.offsets, brushSum: brush.sum, depositRadius, depBoost, extraBoost,
    heightWeightedSpawn,
  }, rng);
  // The same flow coupling the multiscale solver applies, so the two remain comparable:
  // gating only one side would make the pyramid comparison measure the gate, not the pyramid.
  applyFlowGate(h, singleBefore, size, flowGateStrength);


  // ---- shaping: valley sharpening / detail, driven by Shape + Shape Sharpness.
  // Done in metres, then the whole field is converted back to normalised units below.
  let out = h;
  if (shape > 0) {
    const s = stats({ data: h, channels: 1, size });
    const span = s.max - s.min;
    if (span > 1e-9) {
      const k = 1 + shapeSharp * 3;
      out = new Float32Array(h.length);
      for (let i = 0; i < h.length; i++) {
        const t = clamp01((h[i] - s.min) / span);
        out[i] = (Math.pow(t, k) * shape + t * (1 - shape)) * span + s.min;
      }
    }
  }
  if (shapeDetail > 0 && shapeDetail !== 0.5) {
    const blurred = gaussianBlur({ data: out, channels: 1, size, channel: 'height' }, Math.max(1, shapeDetail * size * 0.02));
    const d = 1 + (0.5 - shapeDetail) * 0.8;
    for (let i = 0; i < out.length; i++) out[i] = out[i] + (out[i] - blurred.data[i]) * d;
  }
  const final = createField(size, 'height');
  for (let i = 0; i < out.length; i++) final.data[i] = out[i] / TERRAIN_HEIGHT_M;
  return final;
}

/* ------------------------------------------------- Laplacian pyramid (multiscale) */

/**
 * The pyramid's reduction, now Gaea's own filter.
 *
 * REPLACES a 2x2 box average. That was a cruder low-pass: averaging four cells removes far
 * less of the high-frequency content than a 5x5 Gaussian, so the Laplacian levels carried
 * detail the original sends to the coarse base. The kernel here is the one recovered from
 * `FUN_18003f250` — a separable 5x5 Gaussian at stride 2, normalised by 0.999998.
 *
 * The `>> 1` geometry is Gaea's: a plain floor halving, so an odd size truncates rather than
 * rounding up.
 *
 * @param {Float32Array} a
 * @param {number} n
 * @returns {Float32Array} the coarse level, `n >> 1` per side
 */
export function downsample2(a, n) {
  const { data } = pyramidDownsample(a, n, n);
  return data;
}

/**
 * The pyramid's expansion, now Gaea's own interpolator.
 *
 * REPLACES a bilinear expansion scaled by `(m - 1) / (n - 1)`. That scaling aligns the coarse
 * grid's EDGES with the fine grid's edges, which is a different resampling convention from
 * Gaea's: the original keeps the grids' CELL CENTRES aligned and picks its taps from the
 * parity of the fine coordinate (`[v0, v2, v0]` at even, `[v1, v1]` at odd). Edge-aligned
 * bilinear and centre-aligned parity agree in the interior of a large level and diverge
 * everywhere near a boundary, which is exactly where a pyramid's error accumulates.
 *
 * @param {Float32Array} a the coarse level
 * @param {number} m its size
 * @param {number} n the fine size, expected to be `2 * m`
 * @returns {Float32Array}
 */
export function upsample2(a, m, n) {
  const out = new Float32Array(n * n);
  if (m <= 0) return out;
  if (m === 1) { out.fill(a[0]); return out; }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out[y * n + x] = pyramidUpsample(a, m, m, x, y);
    }
  }
  return out;
}

/**
 * Decompose a height grid into a Gaussian pyramid plus its Laplacian bands.
 *
 * `fine[0]` is the input, `fine[k]` is the 2x2 reduction of `fine[k-1]`, and
 * `lap[k] = fine[k] - upsample(fine[k+1])` is the detail the reduction dropped.
 * Reconstruction is `fine[k] = upsample(fine[k+1]) + lap[k]`, which is exact, so a level
 * can be modified and re-expanded without losing the bands below it.
 *
 * @param {Float32Array} h
 * @param {number} size
 * @param {number} maxLevels
 * @returns {{fine: Float32Array[], sizes: number[], lap: Float32Array[]}}
 */
export function buildPyramid(h, size, maxLevels) {
  const fine = [h];
  const sizes = [size];
  for (let k = 1; k < maxLevels; k++) {
    const pn = sizes[k - 1];
    if (pn < 16) break;                 // below this a level stops describing relief
    fine.push(downsample2(fine[k - 1], pn));
    sizes.push(pn >> 1);
  }
  const lap = [];
  for (let k = 0; k < fine.length - 1; k++) {
    const up = upsample2(fine[k + 1], sizes[k + 1], sizes[k]);
    const d = new Float32Array(sizes[k] * sizes[k]);
    const src = fine[k];
    for (let i = 0; i < d.length; i++) d[i] = src[i] - up[i];
    lap.push(d);
  }
  return { fine, sizes, lap };
}

/**
 * How many pyramid levels to use at a given resolution.
 *
 * The coarsest level stays near 32 cells. Below that a droplet step spans so much
 * ground that the level stops describing measurable relief. Derived rather than exposed
 * as a node parameter, because Gaea's Erosion2 does not expose one either: its
 * `LaplacianLevel` is an internal enum.
 */
export function pyramidLevelsFor(size) {
  if (size < 32) return 1;
  let levels = 1;
  let s = size;
  while (s >= 64 && levels < 6) { s >>= 1; levels++; }
  return levels;
}

/**
 * Shared post-shaping: valley sharpening plus detail emphasis, driven by Shape, Shape
 * Sharpness and Shape Detail Scale. Operates in metres.
 */
function applyShaping(h, size, shape, shapeSharp, shapeDetail) {
  let out = h;
  if (shape > 0) {
    const s = stats({ data: h, channels: 1, size });
    const span = s.max - s.min;
    if (span > 1e-9) {
      const k = 1 + shapeSharp * 3;
      out = new Float32Array(h.length);
      for (let i = 0; i < h.length; i++) {
        const t = clamp01((h[i] - s.min) / span);
        out[i] = (Math.pow(t, k) * shape + t * (1 - shape)) * span + s.min;
      }
    }
  }
  if (shapeDetail > 0 && shapeDetail !== 0.5) {
    const blurred = gaussianBlur(
      { data: out, channels: 1, size, channel: 'height' },
      Math.max(1, shapeDetail * size * 0.02),
    );
    const d = 1 + (0.5 - shapeDetail) * 0.8;
    // NOTE, round 32: an envelope clamp was added here to stop this mask pushing values past
    // the field's own range, on the theory that `metresToField`'s clamp was destroying them and
    // causing the 10% range loss. IT WAS MEASURED AND THE THEORY IS WRONG: the multiscale span
    // moved from 0.8952 to 0.8917, i.e. not at all, because this envelope is itself already
    // outside the normalised 0..1 bound that `metresToField` applies -- two different limits.
    // The change was reverted rather than kept, since a comment claiming a refuted cause is
    // worse than no change at all. See tools/diagnose-multiscale.mjs for the standing numbers.
    for (let i = 0; i < out.length; i++) out[i] += (out[i] - blurred.data[i]) * d;
  }
  return out;
}

/**
 * metres -> normalized height field.
 *
 * Clamped, because a height field's contract with the rest of the app is 0..1 and the
 * shaping stage can overshoot. The clamp was absent until the flow gate perturbed the field
 * enough to make `applyShaping` push a cell to 1.016, which surfaced as "Erosion2 output in
 * [0,1]" failing. The overflow was not caused by the gate — the gate only moves a value
 * between its pre- and post-erosion bounds — so the missing guarantee was here all along and
 * was simply never exercised.
 */
function metresToField(h, size) {
  const final = createField(size, 'height');
  for (let i = 0; i < h.length; i++) {
    const v = h[i] / TERRAIN_HEIGHT_M;
    final.data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return final;
}

/** input field -> metres, with a NaN guard */
function fieldToMetres(src, size) {
  const h = new Float32Array(size * size);
  const stride = src.channels;
  for (let i = 0; i < h.length; i++) {
    const v = src.data[i * stride];
    h[i] = (Number.isFinite(v) ? v : 0) * TERRAIN_HEIGHT_M;
  }
  return h;
}

/**
 * Multiscale particle erosion — the model behind Gaea's Erosion2 / EasyErosion.
 *
 * Gaea's `ParallelErosion` runs droplets through `flow(...)` on a `LaplacianLevel`
 * pyramid (`erode_level`, `reconstruct_previous_level`). This reproduces that structure:
 *
 *   1. Decompose the height field into a Laplacian pyramid.
 *   2. Erode the COARSEST level first. One droplet step there spans many fine cells, so
 *      droplets travel a long way in terrain terms and carve long, connected valleys —
 *      which a single-scale solver cannot do, because its droplets die after a few dozen
 *      cells and only manage short scratches.
 *   3. Walk finer: rebuild each level from the ERODED coarser level plus its own stored
 *      Laplacian band, then erode it. Detail comes back, and each level refines the
 *      drainage instead of inventing new large-scale structure.
 *
 * Droplet density falls towards the fine levels (0.3 at the finest, 1.0 at the coarsest)
 * because the coarse levels have already established the network and the fine levels only
 * add texture. That also keeps total cost near the single-scale solver's despite visiting
 * every level.
 *
 * Still labelled `model`, not `exact`: the pyramid structure and coarse-to-fine ordering
 * follow Gaea, but the per-level droplet arithmetic is the published Hansson formulation,
 * not a transcription of Gaea's SYCL kernels, which are compiled native code and were not
 * decompiled.
 */
export function hydraulicDropletMultiscale(ctx) {
  const { size, params, input, seed } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height', 0.5);

  // Parameters arrive in GAEA'S UNITS (Duration 1..200, Erosion Scale 1..20000, ...), not
  // as 0..1 dials. gaeaDial converts them; see its doc comment for what is calibration and
  // what is measured. The single-scale solver is kept on the same convention so the two
  // remain comparable.
  const duration = gaeaDial('Duration', P(params, 'Duration', 10));
  const downcutting = gaeaDial('Downcutting', P(params, 'Downcutting', 0.25));
  const erosionScale = gaeaDial('Erosion Scale', P(params, 'Erosion Scale', 1000));
  const noErosion = !!P(params, 'NoErosion', false);
  const suspended = gaeaDial('Suspended Load', P(params, 'Suspended Load', 1));
  const bedLoad = gaeaDial('Bed Load', P(params, 'Bed Load', 0));
  const coarse = gaeaDial('Coarse Sediments', P(params, 'Coarse Sediments', 0));
  const depBoost = P(params, 'DepositionBoost', 0);
  const extraBoost = P(params, 'ExtraDepositionBoost', 0);
  const shape = gaeaDial('Shape', P(params, 'Shape', 0.2));
  const shapeSharp = gaeaDial('Shape Sharpness', P(params, 'Shape Sharpness', 0.6));
  const shapeDetail = gaeaDial('Shape Detail Scale', P(params, 'Shape Detail Scale', 0.25));
  const enable = P(params, 'Enable', true);
  // Strength of the FUN_1801f2f30 flow gate: 1 is Gaea's full coupling, 0 disables it.
  // Taken from ctx so a test can isolate the gate's effect rather than infer it from output.
  const flowGateStrength = ctx.flowGate === undefined ? 1 : ctx.flowGate;
  // Height-weighted droplet seeding — Gaea's behaviour. Exposed so a test can isolate it.
  const heightWeightedSpawn = ctx.heightWeighted === undefined ? true : ctx.heightWeighted;

  const h = fieldToMetres(src, size);
  if (!enable || noErosion || duration <= 0) return metresToField(h, size);

  const rng = makeRng(seed);
  const levels = pyramidLevelsFor(size);
  const { fine, sizes, lap } = buildPyramid(h, size, levels);

  const inertia = 0.05;
  const capacityFactor = 1.0 + suspended * 4.0;
  const minCapacity = 0.01;
  const erodeRate = 0.1 + downcutting * 0.6;
  const depositRate = 0.08 + bedLoad * 0.55;
  const evaporate = 0.01 + (1 - suspended) * 0.02;
  const gravity = 1.4;
  const maxDepositPerStep = TERRAIN_HEIGHT_M * 0.004;
  const erosionRadius = Math.max(1, Math.min(4, Math.round(1 + erosionScale * 3)));
  const depositRadius = coarse < 0.34 ? 0 : coarse < 0.67 ? 1 : 2;
  const brush = makeBrush(erosionRadius);

  const last = fine.length - 1;
  for (let k = last; k >= 0; k--) {
    const n = sizes[k];
    // Every level gets the same droplets-per-cell density as the single-scale solver
    // (duration * 0.8). A taper towards the fine levels was tried first and measurably
    // failed: it cut total droplet-steps per cell to about 60% of the single-scale
    // solver, so the pyramid did LESS erosion work than the thing it replaced and the
    // drainage came out no more integrated (peak accumulation 82 vs 83). Uniform
    // density costs only the geometric series, about 1.33x, and keeps each level
    // properly eroded.
    const droplets = Math.max(
      2000,
      Math.min(2_000_000, Math.round(duration * 0.8 * n * n)),
    );
    // A droplet must be able to cross a good part of its own level, because at the
    // coarsest scale that reach IS the feature. The single-scale bound (0.35*size) was
    // deliberately short to keep channels crisp; here it would forbid long valleys.
    const maxSteps = Math.max(20, Math.min(220, Math.round(n * 0.7)));

    const before = Float32Array.from(fine[k]);

    erodeLevel(fine[k], n, {
      droplets, maxSteps, inertia, capacityFactor, minCapacity,
      erodeRate, depositRate, evaporate, gravity, maxDepositPerStep,
      brushOffsets: brush.offsets, brushSum: brush.sum, depositRadius, depBoost, extraBoost,
      heightWeightedSpawn,
    }, rng);

    // Optional instrumentation, off unless the caller asks. The multiscale run was found to
    // lose about 10% of the field's dynamic range (see tools/diagnose-multiscale.mjs), and the
    // first hypothesis — that the fixed deposition cap overwhelms the coarse levels' smaller
    // relief — was measured and REFUTED (tools/diagnose-levels.mjs: the coarsest level keeps
    // 96.9% of the finest level's standard deviation). Locating the loss needs a per-stage
    // reading, which is what this hook provides without changing any arithmetic.
    if (typeof ctx.trace === 'function') {
      ctx.trace('eroded', k, n, before, fine[k]);
    }

    // Couple the erosion to drainage, as FUN_1801f2f30 does: a cell can only export the
    // material its flow can carry away. Without this every cell erodes independently.
    applyFlowGate(fine[k], before, n, flowGateStrength);
    if (typeof ctx.trace === 'function') {
      ctx.trace('gated', k, n, before, fine[k]);
    }

    if (k > 0) {
      // Reconstruct the next finer level from the ERODED coarser one plus its stored
      // detail band. This is what carries coarse drainage down to fine resolution.
      const dst = fine[k - 1];
      const up = upsample2(fine[k], n, sizes[k - 1]);
      const band = lap[k - 1];
      for (let i = 0; i < dst.length; i++) dst[i] = up[i] + band[i];
      if (typeof ctx.trace === 'function') {
        ctx.trace('reconstructed', k - 1, sizes[k - 1], before, dst);
      }
    }
  }

  const shaped = applyShaping(fine[0], size, shape, shapeSharp, shapeDetail);
  if (typeof ctx.trace === 'function') ctx.trace('shaped', 0, size, null, shaped);
  return metresToField(shaped, size);
}

/**
 * The flow gate from `FUN_1801f2f30`: scale each cell's erosion by the flow value it can
 * route to a lower neighbour.
 *
 * TRANSCRIBED FROM THE BINARY
 *   cutAxial = centre - scale * 0.357736
 *   cutDiag  = centre - scale * 0.357736 * sqrt(2)
 *   weight   = max( flow[centre], max over lower neighbours of flow[k] )
 *   delta   *= weight
 *
 * THE SCALE IS THE WHOLE PROBLEM
 * `scale` in the binary is a height quantum in terrain units, and it sets the drop a
 * neighbour must have to count as a drainage direction. This solver works in metres, where
 * terrain relief runs to hundreds of metres, so the binary's own scale is not transferable:
 * passing `scale = 1` makes the cut 0.36 m, nearly every lower neighbour qualifies, the
 * weight saturates near its maximum everywhere and the gate becomes an identity — a silent
 * no-op that would look like a successful implementation.
 *
 * So `scale` is derived per level as the MEAN ABSOLUTE PER-CELL DROP. That makes the
 * threshold a fixed fraction of the terrain's own roughness: on smooth ground a small drop
 * already counts, on rough ground it takes more. This is a model choice, not a recovered
 * formula, and it is the single largest assumption in this function.
 *
 * The flow buffer is normalised to 0..1 by its own maximum before use, because Gaea's `B3`
 * is a normalised flow buffer and raw D8 accumulation here reaches N^2.
 *
 * @param {Float32Array} level   height field, modified in place
 * @param {Float32Array} before  the pre-erosion copy of `level`
 * @param {number} size
 * @param {number} strength      0 disables the gate, 1 is full Gaea weighting
 * @returns {number} the mean per-cell drop used as `scale`, for reporting
 */
function applyFlowGate(level, before, size, strength) {
  if (strength <= 0) return 0;

  // Mean absolute per-cell drop — the height quantum the threshold is expressed in.
  let dropSum = 0;
  let samples = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (x + 1 < size) { dropSum += Math.abs(before[i + 1] - before[i]); samples++; }
      if (y + 1 < size) { dropSum += Math.abs(before[i + size] - before[i]); samples++; }
    }
  }
  const scale = samples > 0 ? dropSum / samples : 0;
  // A perfectly flat level has no drainable direction; gating it would zero the erosion.
  if (!(scale > 0)) return 0;

  const { acc } = flowAccumulation(before, size);
  let maxAcc = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > maxAcc) maxAcc = acc[i];
  const norm = new Float32Array(acc.length);
  if (maxAcc > 0) {
    const inv = 1 / maxAcc;
    for (let i = 0; i < acc.length; i++) norm[i] = acc[i] * inv;
  }

  const weight = gaeaFlowReceiverMax({ height: before, flow: norm, size, scale });

  for (let i = 0; i < level.length; i++) {
    // strength blends between no gating (1) and the binary's full weighting.
    const g = 1 + strength * (weight[i] - 1);
    level[i] = before[i] + (level[i] - before[i]) * g;
  }
  return scale;
}

/** Deposit with an optional wider footprint ("Coarse Sediments"). */
function deposit(h, size, x, y, amount, radius, boost, extra) {
  const amt = amount * (1 + Math.max(0, boost) + Math.max(0, extra));
  if (radius <= 0) {
    const xi = clamp(Math.round(x), 0, size - 1), yi = clamp(Math.round(y), 0, size - 1);
    h[yi * size + xi] += amt;
    return;
  }
  let total = 0;
  const cells = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = Math.round(x) + dx, ny = Math.round(y) + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const w = 1 - Math.sqrt(dx * dx + dy * dy) / (radius + 1);
      if (w <= 0) continue;
      cells.push([ny * size + nx, w]); total += w;
    }
  }
  if (total <= 0) return;
  for (let i = 0; i < cells.length; i++) h[cells[i][0]] += amt * cells[i][1] / total;
}

/* ------------------------------------------------------------------ stream power */

/**
 * Stream-power erosion/deposition (the "Erosion" node).
 *
 * Classic detachment-limited incision with an implicit upwind solve:
 *    dh/dt = -K * A^m * S^n  +  D * deposition
 * plus optional precipitation bias by altitude/slope, base level, and downcutting limit.
 * This is the standard geomorphology model; Gaea's exact solver is not public.
 */
export function streamPower(ctx) {
  const { size, params, input, seed } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height', 0.5);

  const duration = Math.max(0, P(params, 'Duration', 0.5));
  const rockSoftness = clamp01(P(params, 'Rock Softness', 0.5));
  const strength = clamp01(P(params, 'Strength', 0.5));
  const downcutting = clamp01(P(params, 'Downcutting', 0.5));
  const inhibition = clamp01(P(params, 'Inhibition', 0.35));
  const baseLevel = P(params, 'Base Level', 0);
  const debris = clamp01(P(params, 'Debris', 0.35));
  const volume = clamp01(P(params, 'Volume', 0.5));
  const sedimentRemoval = clamp01(P(params, 'Sediment Removal', 0));
  const biasType = P(params, 'Bias Type', 'Altitude');
  const bias = clamp(P(params, 'Bias', 0), -1, 1);
  const reverse = !!P(params, 'Reverse', false);
  const aggressive = !!P(params, 'Aggressive Mode', false);

  const h = new Float32Array(size * size);
  const stride = src.channels;
  for (let i = 0; i < h.length; i++) h[i] = src.data[i * stride];

  if (duration <= 0 || strength <= 0) return { size, channel: 'height', channels: 1, data: h };

  const steps = Math.max(1, Math.min(64, Math.round(duration * 24)));
  const dt = (duration * 0.6) / steps;
  const K = 0.02 + strength * 0.35 + rockSoftness * 0.2;
  const m = 0.5;
  const n = 1.0 + downcutting * 0.6;
  const D = debris * 0.5;
  const dtClamped = aggressive ? dt : Math.min(dt, 0.05);

  const sed = new Float32Array(size * size);
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DD = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

  for (let it = 0; it < steps; it++) {
    const { acc, recv } = flowAccumulation(h, size);
    let maxAcc = 1;
    for (let i = 0; i < acc.length; i++) if (acc[i] > maxAcc) maxAcc = acc[i];
    const invLogMax = 1 / Math.log1p(maxAcc);
    const next = new Float32Array(h);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const r = recv[i];
        if (r < 0) continue;
        const slope = Math.max(0, h[i] - h[r]) / (size * 0.02 + 1e-6);
        const A = Math.log1p(acc[i]) * invLogMax;

        // precipitation bias
        let precip = 1;
        if (bias !== 0) {
          if (biasType === 'Altitude') precip *= 1 + bias * (h[i] - 0.5) * 2;
          else {
            const [gx, gy] = gradientAt(h, size, x, y);
            const s = Math.sqrt(gx * gx + gy * gy) * size * 0.5;
            precip *= 1 + bias * clamp01(s);
          }
        }
        precip = clamp(precip, 0, 3);

        const incise = K * Math.pow(A, m) * Math.pow(slope * size * 0.05 + 1e-6, n) * precip * dtClamped;

        // base level: stop incising below the floor
        const floor = baseLevel;
        let cut = Math.min(incise, Math.max(0, h[i] - floor));
        if (reverse) cut = -cut;
        next[i] -= cut;
        sed[r] += cut * (1 - sedimentRemoval);

        // deposition with inhibition (hillslope diffusion damping)
        if (D > 0) {
          const dep = sed[i] * D * (1 - inhibition);
          const take = Math.min(dep, sed[i]);
          next[i] += take * (0.4 + volume * 0.6);
          sed[i] -= take;
        }

        // lateral diffusion if inhibition > 0 (hillslope creep)
        if (inhibition > 0) {
          let lap = 0, cnt = 0;
          for (let k = 0; k < 8; k++) {
            const nx = x + DX[k], ny = y + DY[k];
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            lap += h[ny * size + nx]; cnt++;
          }
          if (cnt > 0) {
            const avg = lap / cnt;
            next[i] += (avg - h[i]) * inhibition * 0.08;
          }
        }
      }
    }
    for (let i = 0; i < h.length; i++) {
      const v = next[i];
      h[i] = Number.isFinite(v) ? (v < 0 ? 0 : v) : h[i];
    }
  }

  const f = createField(size, 'height');
  f.data.set(h);
  return f;
}

/* ------------------------------------------------------------------ thermal / talus */

/**
 * Thermal erosion (Gaea's Thermal / Thermal2): material moves downhill when the local slope
 * exceeds the talus angle. Implemented as iterative mass-conserving relaxation with an
 * optional flow-direction anisotropy and settling factor.
 */
export function thermalTalus(ctx) {
  const { size, params, input, seed } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height', 0.5);

  const duration = Math.max(0, P(params, 'Duration', 0.5));
  const strength = clamp01(P(params, 'Strength', 0.5));
  const anisotropy = clamp01(P(params, 'Anisotropy', 0));
  const angleDeg = P(params, 'Angle', 0);
  const settling = clamp01(P(params, 'Settling', 0.4));
  const removal = clamp01(P(params, 'Sediment Removal', 0));

  const h = new Float32Array(size * size);
  const stride = src.channels;
  for (let i = 0; i < h.length; i++) h[i] = src.data[i * stride];

  if (duration <= 0 || strength <= 0) return { size, channel: 'height', channels: 1, data: h };

  const talus = Math.max(0.001, 0.35 * (1 - strength) + 0.004);
  const steps = Math.max(1, Math.min(120, Math.round(duration * 40)));
  const ang = (angleDeg / 360) * Math.PI * 2;
  // anisotropy: transport is favoured along `angle`
  const ax = Math.cos(ang), ay = Math.sin(ang);
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DD = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

  const delta = new Float32Array(size * size);
  const total = size * size;

  for (let it = 0; it < steps; it++) {
    delta.fill(0);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const hc = h[i];
        // find downhill neighbours exceeding talus
        let moveTotal = 0;
        const moves = [];
        for (let k = 0; k < 8; k++) {
          const nx = x + DX[k], ny = y + DY[k];
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const j = ny * size + nx;
          const diff = hc - h[j];
          if (diff <= 0) continue;
          const dist = DD[k];
          const slope = diff / dist;
          if (slope <= talus) continue;
          // anisotropy weight
          let w = 1;
          if (anisotropy > 0) {
            const kx = DX[k] / dist, ky = DY[k] / dist;
            const align = kx * ax + ky * ay; // -1..1
            w = 1 + anisotropy * align * 0.9;
            if (w < 0.02) w = 0.02;
          }
          const excess = (slope - talus) * dist * 0.25 * (1 - settling);
          moves.push([j, excess * w]);
          moveTotal += excess * w;
        }
        if (moveTotal <= 0 || moves.length === 0) continue;
        // limit so we never dig below the lowest neighbour
        let lowest = Infinity;
        for (let m = 0; m < moves.length; m++) if (h[moves[m][0]] < lowest) lowest = h[moves[m][0]];
        let budget = Math.min(moveTotal, Math.max(0, (hc - lowest) * 0.5));
        if (budget <= 0) continue;
        budget *= (1 - removal);
        for (let m = 0; m < moves.length; m++) {
          const share = moves[m][1] / moveTotal;
          delta[moves[m][0]] += budget * share;
        }
        delta[i] -= budget;
      }
    }
    for (let i = 0; i < total; i++) {
      const v = h[i] + delta[i];
      h[i] = Number.isFinite(v) ? (v < 0 ? 0 : v) : h[i];
    }
  }

  const f = createField(size, 'height');
  f.data.set(h);
  return f;
}
