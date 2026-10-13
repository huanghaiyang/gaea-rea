/**
 * clut.js — Gaea's CLUTer: map a grayscale field through one of Gaea's own palette textures.
 *
 * THE NODE, from the managed `Build()`
 *
 *     if (GradientData != null) {
 *         base.Out.RenderIntent = (RenderIntent)2;                 // colour
 *         Map map = Migrated.ClutterProcess(
 *             input.GrayscaleConversion(2),
 *             GradientData, gradient, AutolevelInput, Reverse, Bias, Hue, Saturation, Lightness);
 *     }
 *
 * `GradientData` is the gradient the user picks in the UI's GradientEditor. The eight `.clut`
 * files in `Resources/Color` are Gaea's BUILT-IN presets for that editor, which is why they are
 * the thing worth extracting: they are the palettes the node actually offers.
 *
 * WHY PRELOAD AND CACHE
 * The assets are PNG textures, so reading one is `fetch` + `createImageBitmap` and therefore
 * ASYNC, while every kernel in this build is synchronous. Rather than make one node async and
 * ripple that through the evaluator, the textures are decoded once into flat lookup tables by
 * `preloadCLUTs()` and the kernel reads the cache synchronously. A node asked for a palette that
 * has not loaded falls back to a procedural grey ramp and says so through `clutStatus()`, so a
 * missing asset degrades visibly instead of silently producing a flat colour.
 *
 * Built for tests too: `installCLUT(name, table)` puts a table in the cache directly, so the
 * kernel can be exercised without a browser or a network.
 */

/** name -> { rows, cols, rgba: Uint8Array }. Populated by preload or by installCLUT. */
const CACHE = new Map();
/** name -> error string, for anything that failed to load. Surfaced by clutStatus(). */
const FAILURES = new Map();

/** Where the extraction wrote the textures, relative to the app root. */
export const CLUT_BASE = 'assets/color';

/** The eight presets Gaea ships, in the order the extraction reports them. */
export const CLUT_NAMES = ['2D', 'Blue', 'Color', 'Green', 'Masks', 'New', 'Rock', 'Sand'];

/** The 1D sample length every table is resampled onto, so sampling is a plain index. */
const LUT_SIZE = 1024;

/**
 * Install a table directly, bypassing the network.
 *
 * @param {string} name
 * @param {Uint8Array} rgba row-major RGBA, `cols * rows * 4` bytes
 * @param {number} cols
 * @param {number} rows
 */
export function installCLUT(name, rgba, cols, rows) {
  // A 1D lookup is all the node needs: Gaea's presets carry several ROWS of variant gradients,
  // and the default pick is the middle one. Keeping the 1D reduction here means the kernel does
  // no row arithmetic and a test can install a two-pixel table.
  const row = Math.floor(rows / 2);
  const lut = new Uint8Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const c = Math.min(cols - 1, Math.round((i / (LUT_SIZE - 1)) * (cols - 1)));
    const o = (row * cols + c) * 4;
    lut[i * 3] = rgba[o];
    lut[i * 3 + 1] = rgba[o + 1];
    lut[i * 3 + 2] = rgba[o + 2];
  }
  CACHE.set(name, { rows, cols, lut });
  FAILURES.delete(name);
}

/** Whether a palette is ready. */
export function hasCLUT(name) {
  return CACHE.has(name);
}

/** Load status for every preset, so a caller can report what is missing rather than guess. */
export function clutStatus() {
  return CLUT_NAMES.map((n) => ({
    name: n,
    loaded: CACHE.has(n),
    rows: CACHE.get(n)?.rows ?? null,
    cols: CACHE.get(n)?.cols ?? null,
    error: FAILURES.get(n) ?? null,
  }));
}

/** Decode one palette texture into the cache. Returns true on success. */
export async function loadCLUT(name, base = CLUT_BASE) {
  try {
    const res = await fetch(`${base}/${encodeURIComponent(name)}.png`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const g = canvas.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const img = g.getImageData(0, 0, bmp.width, bmp.height);
    installCLUT(name, new Uint8Array(img.data.buffer), bmp.width, bmp.height);
    bmp.close?.();
    return true;
  } catch (e) {
    FAILURES.set(name, String(e && e.message ? e.message : e));
    return false;
  }
}

/**
 * Decode every preset. Safe to call more than once; already-loaded palettes are skipped.
 *
 * @returns {Promise<{loaded: number, failed: string[]}>}
 */
export async function preloadCLUTs(names = CLUT_NAMES, base = CLUT_BASE) {
  const failed = [];
  let loaded = 0;
  for (const n of names) {
    if (CACHE.has(n)) { loaded++; continue; }
    const ok = await loadCLUT(n, base);
    if (ok) loaded++;
    else failed.push(n);
  }
  return { loaded, failed };
}

/**
 * Sample a palette.
 *
 * `t` is clamped rather than wrapped: a field slightly outside 0..1 should take the end colour,
 * not jump to the other end of the gradient, which is what a wrap would do and what a height
 * field must never do.
 *
 * @returns {{r: number, g: number, b: number}} 0..1
 */
export function sampleCLUT(name, t) {
  const entry = CACHE.get(name);
  if (!entry) return null;
  const x = t <= 0 ? 0 : t >= 1 ? LUT_SIZE - 1 : Math.round(t * (LUT_SIZE - 1));
  const o = x * 3;
  return { r: entry.lut[o] / 255, g: entry.lut[o + 1] / 255, b: entry.lut[o + 2] / 255 };
}

/** A grey ramp, used when the requested palette is not available. */
export function fallbackSample(t) {
  const v = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return { r: v, g: v, b: v };
}

/* ------------------------------------------------------------------ the node --- */

import { createField } from './kernel/field.js';

function P(params, name, dflt) {
  if (!params) return dflt;
  const v = params[name];
  return v === undefined || v === null ? dflt : v;
}

/** RGB to HSL and back, so the three adjustments can be applied in the space they name. */
function rgb2hsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hue2rgb(p, q, t) {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

function hsl2rgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/**
 * The `CLUTer` node.
 *
 * The five parameters are Gaea's own, defaults and ranges from the assembly:
 *
 *     [Parameter(Parameters.GradientEditor)] GradientData
 *     [Parameter(0f, -1f, 1f)] Bias
 *     [Parameter(0f, -1f, 1f)] Hue
 *     [Parameter(0f, -1f, 1f)] Saturation
 *     [Parameter(0f, -1f, 1f)] Lightness
 *
 * `Bias` shifts the lookup position before sampling, which darkens or lightens without changing
 * the palette; the other three are applied in HSL AFTER the lookup, which is the order the
 * managed call implies (the gradient is fixed, then the colour is adjusted).
 *
 * The output is a colour field, matching `RenderIntent = 2` in the managed code.
 */
export function gaeaCLUTer(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return null;
  const n = size * size;
  const ch = src.channels || 1;

  const name = String(P(params, 'GradientData', 'Rock'));
  const bias = Number(P(params, 'Bias', 0));
  const hue = Number(P(params, 'Hue', 0));
  const sat = Number(P(params, 'Saturation', 0));
  const light = Number(P(params, 'Lightness', 0));

  // `CHANNELS.color` is 4, i.e. RGBA, and `createField`'s third argument is a FILL VALUE rather
  // than a length -- the first version passed `n * 3`, which would have been interpreted as the
  // value to fill every component with.
  const out = createField(size, 'color');
  // A palette that never loaded falls back to grey, and `clutStatus()` is how a caller finds out
  // which ones did. Silent fallback would make a missing asset look like a desaturated image.
  const havePalette = hasCLUT(name);

  for (let i = 0; i < n; i++) {
    let v = src.data[i * ch];
    v = Number.isFinite(v) ? v : 0;
    // Bias shifts the sample position; it is a lookup offset, not an HSL lightness change, which
    // is what makes it distinct from the Lightness parameter below.
    const t = v + bias * 0.5;
    const c = havePalette ? sampleCLUT(name, t) : fallbackSample(t);
    if (hue === 0 && sat === 0 && light === 0) {
      out.data[i * 4] = c.r;
      out.data[i * 4 + 1] = c.g;
      out.data[i * 4 + 2] = c.b;
      out.data[i * 4 + 3] = 1;
      continue;
    }
    const [h0, s0, l0] = rgb2hsl(c.r, c.g, c.b);
    let h = h0 + hue * 0.5;
    h -= Math.floor(h);
    const s = Math.max(0, Math.min(1, s0 + sat * 0.5));
    const l = light >= 0
      ? l0 + (1 - l0) * light
      : l0 * (1 + light);
    const [r, g, b] = hsl2rgb(h, s, Math.max(0, Math.min(1, l)));
    out.data[i * 4] = r;
    out.data[i * 4 + 1] = g;
    out.data[i * 4 + 2] = b;
    out.data[i * 4 + 3] = 1;
  }
  return out;
}
