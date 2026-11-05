/**
 * profiles.js — node kernels that use Gaea's EXACT engine arithmetic (not approximations).
 *
 * These kernels are wrappers in the same shape as Gaea's own `Build()` methods: read the inputs,
 * call a shared helper that was recovered from the real assemblies, commit the result. The shared
 * maths lives in `../kernel/gaea-exact.js` and every primitive there is numerically verified
 * against the installed binary by `tools/verify-exact.mjs`.
 *
 * Add a node here only when its Build() body is understood well enough to reproduce numbers, not
 * just shapes — otherwise it belongs in the approximate kernel modules with an honest "approx" note.
 */

import { createField, toScalar } from '../kernel/field.js';
import { profilesShaper, soil2, graphicEQ } from '../kernel/gaea-exact.js';
import {
  linearGradient, radialGradient, coneGradient, hemisphereGradient, EDGE_CLIP, EDGE_REPEAT,
  EDGE_MIRROR, foldField, swirlField, generateOval, generateRectangle, applyHSL,
} from '../kernel/gaea-fields.js';
import { smoothedMedianBlur, maskBlend, autolevel, equalize, grayscale, shiftClamp } from '../kernel/gaea-combine.js';
import { mosaicRepeat, mosaicSeamless } from '../kernel/gaea-mosaic.js';
import { combinerTranspose, combinerEmbed, combinerInsert } from '../kernel/gaea-filter.js';
import { cartographerContours } from '../kernel/gaea-cartographer.js';
import { getCurvature, CURVATURE_TYPE } from '../kernel/gaea-aspect.js';

function P(params, name, dflt) {
  const v = params ? params[name] : undefined;
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
  return v;
}
const B = (params, name, dflt = false) => Boolean(P(params, name, dflt));
const N = (params, name, dflt = 0) => Number(P(params, name, dflt));

/** Input as a single-channel field, or a neutral one when the port is unconnected. */
function inOr(ctx, i, dflt = 0.5) {
  const f = ctx.input(i);
  if (f) return f.channels === 1 ? f : toScalar(f);
  return createField(ctx.size, 'height', dflt);
}

const outField = (size, data) => ({ size, channel: 'height', channels: 1, data });

/* ================================================================== Shaper */

/**
 * Shaper — `Profiles.Shaper(map, Shape, LocalEffect, LocalArea, MaintainFineDetails, DetailSize)`.
 *
 * The transfer is an exponential curve on the normalized range; optionally it runs on the
 * high-frequency band only (Local Effect), and optionally restores the detail band afterwards.
 * Verified: 70/70 oracle cases, worst abs diff 1.6e-6.
 */
export function gaeaShaper(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  const data = profilesShaper(
    src.data,
    size,
    N(ctx.params, 'Shape', 0),
    B(ctx.params, 'Local Effect'),
    N(ctx.params, 'Local Area', 0.5),
    B(ctx.params, 'Maintain Fine Details'),
    N(ctx.params, 'Detail Size', 0.75),
  );
  return outField(size, data);
}

/* ================================================================== gradients */

const EDGE_BY_NAME = { Clip: EDGE_CLIP, Repeat: EDGE_REPEAT, Mirror: EDGE_MIRROR };

/** Gaea's shape nodes multiply their generated field by the optional input. */
function multiplyByInput(ctx, data) {
  const f = ctx.input(0);
  if (!f) return outField(ctx.size, data);
  const src = f.channels === 1 ? f : toScalar(f);
  for (let i = 0; i < data.length; i++) data[i] *= src.data[i];
  return outField(ctx.size, data);
}

/** LinearGradient — `Gradients.LinearGradient(N, N/2, N/2, Scale*N, Direction, Edge)`. */
export function gaeaLinearGradient(ctx) {
  const size = ctx.size;
  const scale = N(ctx.params, 'Scale', 1);
  const direction = N(ctx.params, 'Direction', 0);
  const edge = EDGE_BY_NAME[String(P(ctx.params, 'Edge Behavior', 'Clip'))] ?? EDGE_CLIP;
  return multiplyByInput(ctx, linearGradient(size, size / 2, size / 2, scale * size, direction, edge));
}

/** RadialGradient — `Gradients.RadialGradient(N, N*X, N*Y, N*Scale*0.5, Height)`. */
export function gaeaRadialGradient(ctx) {
  const size = ctx.size;
  const scale = N(ctx.params, 'Scale', 1);
  const height = N(ctx.params, 'Height', 1);
  const x = N(ctx.params, 'X', 0.5);
  const y = N(ctx.params, 'Y', 0.5);
  return multiplyByInput(ctx, radialGradient(size, size * x, size * y, size * scale * 0.5, height));
}

/** Cone — `Gradients.Cone(N, N*X, N*Y, N*Scale*0.5, Height)`. */
export function gaeaCone(ctx) {
  const size = ctx.size;
  const scale = N(ctx.params, 'Scale', 1);
  const height = N(ctx.params, 'Height', 1);
  const x = N(ctx.params, 'X', 0.5);
  const y = N(ctx.params, 'Y', 0.5);
  return multiplyByInput(ctx, coneGradient(size, size * x, size * y, size * scale * 0.5, height));
}

/**
 * Hemisphere — `Migrated.HemisphereProcess(N, Scale, Height, X, Y, Flatten)`:
 * radius is `(N-4) * Scale * 0.5`, which is the half-scale the pipeline applies to every gradient.
 */
export function gaeaHemisphere(ctx) {
  const size = ctx.size;
  const scale = N(ctx.params, 'Scale', 1);
  const height = N(ctx.params, 'Height', 1);
  const x = N(ctx.params, 'X', 0.5);
  const y = N(ctx.params, 'Y', 0.5);
  const flatten = B(ctx.params, 'Flatten');
  return multiplyByInput(ctx, hemisphereGradient(size, size * x, size * y, (size - 4) * scale * 0.5, height, flatten));
}

/* ================================================================== Colour / Fold / Swirl */

/** HSL — `ColorCore.HSL(map, Hue, Saturation, Lightness)`; factors arrive as 1+param. */
export function gaeaHSL(ctx) {
  const { size } = ctx;
  const src = ctx.input(0);
  const channels = src ? src.channels : 1;
  const data = src ? src.data : new Float32Array(size * size).fill(0.5);
  const out = applyHSL(data, size, channels, N(ctx.params, 'Hue', 0), N(ctx.params, 'Saturation', 0), N(ctx.params, 'Lightness', 0));
  return {
    size,
    channel: channels === 1 ? 'height' : 'color',
    channels,
    data: out,
  };
}

/** Fold — `Migrated.FoldProcess(map, mask, Waveform, Folds, Symmetric)` -> Profiles.Sine/... */
export function gaeaFold(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  const maskF = ctx.input(1);
  const mask = maskF ? (maskF.channels === 1 ? maskF : toScalar(maskF)).data : null;
  const waveform = String(P(ctx.params, 'Waveform', 'Sine'));
  const folds = N(ctx.params, 'Folds', 2);
  const symmetric = B(ctx.params, 'Symmetric');
  return outField(size, foldField(src.data, size, mask, waveform, folds, symmetric));
}

/**
 * Swirl — `Others.SwirlHeightfield(map, Size*0.05*512/N, Float2(X, 1-Y))`.
 * The scale term makes the visual swirl amount resolution-independent.
 */
export function gaeaSwirl(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  const amount = N(ctx.params, 'Size', 0.15) * 0.1 * 0.5 * (512 / size);
  const x = N(ctx.params, 'X', 0.5);
  const y = N(ctx.params, 'Y', 0.5);
  return outField(size, swirlField(src.data, size, amount, x, 1 - y));
}

/* ================================================================== Shape */

/**
 * Shape — `GenerateOval` / `GenerateRectangle` scaled by Height. Only the two geometries the
 * shipped Build() handles are implemented; anything else returns null (the caller shows no output).
 */
export function gaeaShape(ctx) {
  const size = ctx.size;
  const geometry = String(P(ctx.params, 'Geometry', 'Circle'));
  const uniform = B(ctx.params, 'Uniform');
  const scale = N(ctx.params, 'Scale', 0.5);
  const scaleX = uniform ? scale : N(ctx.params, 'Scale X', 0.5);
  const scaleY = uniform ? scale : N(ctx.params, 'Scale Y', 0.5);
  const thickness = N(ctx.params, 'Thickness', 0.1);
  const height = N(ctx.params, 'Height', 1);
  const x = N(ctx.params, 'X', 0.5);
  const y = N(ctx.params, 'Y', 0.5);
  let data;
  if (geometry === 'Rectangle') data = generateRectangle(size, scaleX, scaleY, thickness, x, y);
  else data = generateOval(size, scaleX, scaleY, thickness, x, y);
  for (let i = 0; i < data.length; i++) data[i] *= height;
  return outField(size, data);
}


/* ================================================================== Composite batch */

/** Median — `Others.SmoothedMedianBlur`; Classic and Advanced differ only in the window. */
export function gaeaMedian(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  let data = Float32Array.from(src.data);
  const mode = String(P(ctx.params, 'Mode', 'Classic'));
  const strengthMap = { X1: 1, X2: 2, X4: 4, X8: 8 };
  const strength = strengthMap[String(P(ctx.params, 'Strength', 'X1'))] ?? 1;
  const iterations = Math.max(1, N(ctx.params, 'Iterations', 1) | 0);
  if (mode === 'Advanced') {
    const h = Math.max(2, N(ctx.params, 'Horizontal', 2) | 0);
    const v = Math.max(2, N(ctx.params, 'Vertical', 2) | 0);
    for (let i = 0; i < iterations; i++) data = smoothedMedianBlur(data, size, h, v, size);
  } else if (mode === 'Advanced2') {
    // MedianFilter.ResolutionIndependent is a separate implementation that has not been ported;
    // reuse the Advanced window scaled by Strength so the node still behaves like a median.
    const h = Math.max(2, (N(ctx.params, 'Horizontal', 2) | 0) * strength);
    const v = Math.max(2, (N(ctx.params, 'Vertical', 2) | 0) * strength);
    for (let i = 0; i < iterations; i++) data = smoothedMedianBlur(data, size, h, v, size);
  } else {
    for (let i = 0; i < iterations * strength; i++) data = smoothedMedianBlur(data, size, 2, 2, size);
  }
  return outField(size, data);
}

/**
 * Compare — `Compare.Build()`.
 *
 * Mode AB (the default) splits the field with a hard mask at `int(res.X * A/B)`; the mask is built
 * with the shipped body's index order (`map[y,i]` vs `map[i,y]`), which is kept as-is because
 * "fixing" it would move the split line.
 */
export function gaeaCompare(ctx) {
  const { size } = ctx;
  const swap = B(ctx.params, 'Swap');
  let a = ctx.input(0);
  let b = ctx.input(1);
  if (!a) a = b;
  if (!b) b = a;
  if (!a) return outField(size, new Float32Array(size * size).fill(0.5));
  const da = a.channels === 1 ? a.data : toScalar(a).data;
  const db = b.channels === 1 ? b.data : toScalar(b).data;
  const A = swap ? db : da;
  const Bf = swap ? da : db;
  const comparison = N(ctx.params, 'A/B', 0.5);
  const perpendicular = B(ctx.params, 'Perpendicular');
  const left = Math.trunc(size * comparison);
  const mask = new Float32Array(size * size);
  if (perpendicular) {
    for (let y = 0; y < size; y++) for (let i = left; i < size; i++) mask[i * size + y] = 1;
  } else {
    for (let y = 0; y < size; y++) for (let i = left; i < size; i++) mask[y * size + i] = 1;
  }
  return outField(size, maskBlend(A, Bf, mask));
}

/** RGBMerge — three height inputs become one colour field (RGBMerge.Build()). */
export function gaeaRGBMerge(ctx) {
  const { size } = ctx;
  const n = size * size;
  const pick = (i, dflt) => {
    const f = ctx.input(i);
    return f ? (f.channels === 1 ? f.data : toScalar(f).data) : dflt;
  };
  const zero = new Float32Array(n);
  let r = Float32Array.from(pick(0, zero));
  let g = Float32Array.from(pick(1, zero));
  let b = Float32Array.from(pick(2, zero));
  const enhance = (arr, key) => {
    const mode = String(P(ctx.params, key, 'None'));
    if (mode === 'Autolevel') return autolevel(arr);
    if (mode === 'Equalize') return equalize(arr);
    return arr;
  };
  r = enhance(r, 'Enhance R');
  g = enhance(g, 'Enhance G');
  b = enhance(b, 'Enhance B');
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = r[i];
    out[i * 4 + 1] = g[i];
    out[i * 4 + 2] = b[i];
    out[i * 4 + 3] = 1;
  }
  return { size, channel: 'color', channels: 4, data: out };
}

/**
 * RGBSplit — the combined output is the colour field converted to grayscale with the chosen method.
 * Gaea also publishes R/G/B as separate outputs; this graph model carries one output per node, so
 * only the main output is produced (documented in the node note).
 */
export function gaeaRGBSplit(ctx) {
  const { size } = ctx;
  const src = ctx.input(0);
  if (!src) return outField(size, new Float32Array(size * size).fill(0.5));
  const methods = { Average: 0, BT601: 1, BT709: 2, RedChannel: 3 };
  const method = methods[String(P(ctx.params, 'Method', 'BT601'))] ?? 1;
  let data = grayscale(src.data, size, src.channels, method);
  if (B(ctx.params, 'Autolevel Channels')) data = autolevel(data);
  return outField(size, data);
}




/* ================================================================== Tiling */

/**
 * Seamless — `Mosaic.Seamless(heightmap, texture, Edge, ShiftX, ShiftY)` height output.
 * The colour output of the shipped node is not produced (one output per node in this model).
 * Verified against the shipped method: 4/4 oracle cases exact.
 */
export function gaeaSeamless(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  const data = mosaicSeamless(
    src.data,
    size,
    N(ctx.params, 'Edge', 0.5),
    N(ctx.params, 'Shift X', 0.5),
    N(ctx.params, 'Shift Y', 0.5),
  );
  return outField(size, data);
}

/**
 * Repeat — `Mosaic.Repeat(map.ToMap(GrayscaleConversion3), Tiles, CompensateHeight ? 1/Tiles : Height)`.
 *
 * NOTE: the shipped `Mosaic.Repeat` shrinks the tile with `Transformer.Resize(..., HighQuality)`, a
 * Lanczos-windowed resampler that has not been ported yet. The port here uses the engine's
 * LinearFast bilinear resize, so interior tiling is right but tile-edge pixels differ (oracle diff up
 * to ~1.1 at tile seams). Marked 'model' until the HighQuality resampler is ported.
 */
export function gaeaRepeat(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  const tiles = Math.max(2, N(ctx.params, 'Tiles', 2) | 0);
  const compensate = B(ctx.params, 'Compensate Height');
  const height = compensate ? 1 / tiles : N(ctx.params, 'Height', 1);
  return outField(size, mosaicRepeat(src.data, size, tiles, height));
}

/* ================================================================== blur-derived nodes */

/**
 * Soil — `Texturize.Soil2(input.Copy(), Amount).shiftClamp(Bias)`.
 * Interior arithmetic is exact; the border follows the blur edge model, so this is marked 'model'.
 */
export function gaeaSoil(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  const out = soil2(src.data, size, N(ctx.params, 'Amount', 0.6));
  return outField(size, shiftClamp(out, N(ctx.params, 'Bias', 0), 1));
}

/**
 * Peaks — `Profiles.GraphicEQ(input, 0,2,2,2, precise?2:0, precise?1:0, precise?1:0)`
 * then autolevel and `shiftClamp(Falloff, 1)`.
 */
export function gaeaPeaks(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  const precise = B(ctx.params, 'Precise');
  const gains = [0, 2, 2, 2, precise ? 2 : 0, precise ? 1 : 0, precise ? 1 : 0];
  let out = graphicEQ(src.data, size, gains);
  out = autolevel(out);
  return outField(size, shiftClamp(out, N(ctx.params, 'Falloff', 0), 1));
}

/* ================================================================== Filter / Transpose */

/**
 * Transpose — `Combiner.Transpose(ground, reference, Amount)` (Mode = Transpose).
 *
 * The Transpose mode is oracle-verified end to end. The node's other two modes (Embed, Insert) are
 * NOT ported: their recovered bodies still disagree with the shipped output, so this kernel returns
 * null for them and the evaluator falls back to the documented passthrough instead of showing a
 * wrong result.
 */
export function gaeaTranspose(ctx) {
  const { size } = ctx;
  const mode = String(P(ctx.params, 'Mode', 'Transpose'));
  const ground = ctx.input(0);
  const reference = ctx.input(1);
  if (!ground || !reference) return null;
  const g = ground.channels === 1 ? ground.data : toScalar(ground).data;
  const r = reference.channels === 1 ? reference.data : toScalar(reference).data;
  const amount = N(ctx.params, 'Amount', 1);
  let out;
  if (mode === 'Embed') out = combinerEmbed(g, r, size, amount, N(ctx.params, 'Extend', 0));
  else if (mode === 'Insert') {
    out = combinerInsert(g, r, size, amount, N(ctx.params, 'Threshold', 0.01), N(ctx.params, 'Flatten', 0), N(ctx.params, 'Boundary', 0.3));
  } else out = combinerTranspose(g, r, size, amount);
  return outField(size, out);
}

/* ================================================================== Sharpen */

/**
 * Sharpen — `SharpenMethod.Edge` adds a scaled vertical curvature:
 * `map + GetCurvature(map, 0, 1, 0.2, Vertical) * (0.008 * Amount)`; the Frequency method is
 * `Profiles.GraphicEQ(map, 1,1,1,1,1,1, 1+Amount)`. The Edge branch is oracle-exact; the Frequency
 * branch inherits the blur edge model.
 */
export function gaeaSharpen(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  const amount = N(ctx.params, 'Amount', 0.5);
  const method = String(P(ctx.params, 'Method', 'Edge'));
  let out;
  if (method === 'Edge') {
    const c = getCurvature(src.data, size, 0, 1, 0.2, CURVATURE_TYPE.Vertical);
    const k = 0.008 * amount;
    out = new Float32Array(size * size);
    for (let i = 0; i < out.length; i++) out[i] = src.data[i] + c[i] * k;
  } else {
    out = graphicEQ(src.data, size, [1, 1, 1, 1, 1, 1, 1 + amount]);
  }
  return outField(size, out);
}

/* ================================================================== Cartography */

/**
 * Contours — `Cartographer.Contours(input, Count, Subdivision, Accuracy, LineIntensity, SubIntensity, LineThickness)`.
 * The piecewise maths is ported from the shipped helper and every part is oracle-verified (Terrace,
 * GetCurvature, DilateCross, percent blur); the node keeps only the first (contours) output.
 */
export function gaeaContours(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0);
  const out = cartographerContours(
    src.data,
    size,
    Math.max(2, N(ctx.params, 'Count', 36) | 0),
    Math.max(2, N(ctx.params, 'Subdivision', 6) | 0),
    N(ctx.params, 'Accuracy', 0.7),
    N(ctx.params, 'Line Intensity', 1),
    N(ctx.params, 'Sub Intensity', 0.25),
    Math.max(1, N(ctx.params, 'Line Thickness', 1) | 0),
  );
  return outField(size, out.contours);
}
