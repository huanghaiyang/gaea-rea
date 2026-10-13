/**
 * halftone.js — Gaea's Halftone node, backed by the extracted ordered-dither threshold maps.
 *
 * THE NODE, from the managed `Build()`
 *
 *     RenderAsMask(true);
 *     Map map = Migrated.HalftoneProcess(input, Posterize ? Depth : (-1), Pattern, maps);
 *
 * `maps` is the threshold-map set, and `Pattern` selects from it. The `HalftonePattern` enum has
 * eighteen values:
 *
 *     FloydSteinberg, Riemersma, O2X2, O3X3, O4X4, O8X8,
 *     H6X6A, H8X8A, H6X6O, H8X8O,
 *     C5X5B, C5X5W, C6X6B, C6X6W, C7X7B, C7X7W,
 *     DIAG, HLINE
 *
 * SIXTEEN OF THE EIGHTEEN ARE IMAGEMAGICK'S OWN THRESHOLD MAPS, lowercased. That is not a guess:
 * `tools/extract-magick.py` pulled 20 maps out of `Resources/Magick/thresholds.xml`, and the enum
 * value lowercased IS the map name for O2X2/O3X3/O4X4/O8X8, the four H-maps and the six C-maps.
 * Two more pair up by shape rather than by name: `DIAG` is `diag5x5` and `HLINE` is `hlines12x4`.
 *
 * The remaining two are not maps at all. `FloydSteinberg` is error diffusion and `Riemersma` is
 * its Hilbert-curve variant; neither can be expressed as a lookup, so they are implemented as
 * their published algorithms and labelled accordingly.
 *
 * WHY THE MAPS ARE LOADED RATHER THAN EMBEDDED
 * `web/assets/` is gitignored because it holds vendor bytes. Inlining the 20 matrices into this
 * module would commit ImageMagick's tables by the side door, so they are loaded the same way the
 * CLUTs are: an async preload into a synchronous cache.
 */

import { createField } from '../kernel/field.js';

/** name -> {width, height, divisor, cells}. Populated by preload or by installThresholds. */
const MAPS = new Map();
const FAILURES = new Map();

export const THRESHOLDS_URL = 'assets/magick/thresholds.json';

/**
 * The enum, and which extracted map each value uses.
 *
 * A null `map` means the pattern is not a lookup and is handled by an algorithm instead. The
 * `byName` entries exist because two enum values do not match their map's name.
 */
export const HALFTONE_PATTERNS = {
  FloydSteinberg: { map: null, algo: 'floyd' },
  Riemersma: { map: null, algo: 'riemersma' },
  O2X2: { map: 'o2x2' }, O3X3: { map: 'o3x3' }, O4X4: { map: 'o4x4' }, O8X8: { map: 'o8x8' },
  H6X6A: { map: 'h6x6a' }, H8X8A: { map: 'h8x8a' },
  H6X6O: { map: 'h6x6o' }, H8X8O: { map: 'h8x8o' },
  C5X5B: { map: 'c5x5b' }, C5X5W: { map: 'c5x5w' },
  C6X6B: { map: 'c6x6b' }, C6X6W: { map: 'c6x6w' },
  C7X7B: { map: 'c7x7b' }, C7X7W: { map: 'c7x7w' },
  // These two pair by shape, not by name -- the enum says DIAG, the map is called diag5x5.
  DIAG: { map: 'diag5x5', byName: true },
  HLINE: { map: 'hlines12x4', byName: true },
};

export const HALFTONE_PATTERN_NAMES = Object.keys(HALFTONE_PATTERNS);

/** Install the whole map set from a parsed thresholds.json payload. */
export function installThresholds(payload) {
  const src = payload && payload.thresholds ? payload.thresholds : payload;
  let n = 0;
  for (const [name, e] of Object.entries(src || {})) {
    if (!e || !e.width || !e.height || !Array.isArray(e.cells)) continue;
    MAPS.set(name, {
      width: e.width, height: e.height,
      divisor: e.divisor || (e.width * e.height),
      cells: Int32Array.from(e.cells),
      description: e.description || null,
    });
    n++;
  }
  return n;
}

export function hasThresholds() {
  return MAPS.size > 0;
}

/** Which patterns are ready, and which are missing. */
export function thresholdStatus() {
  return HALFTONE_PATTERN_NAMES.map((p) => {
    const spec = HALFTONE_PATTERNS[p];
    return {
      pattern: p,
      kind: spec.map ? 'ordered' : 'diffusion',
      map: spec.map,
      ready: spec.map ? MAPS.has(spec.map) : true,
      error: FAILURES.get(p) ?? null,
    };
  });
}

/** Decode the map set once. Safe to call repeatedly. */
export async function preloadThresholds(url = THRESHOLDS_URL) {
  if (MAPS.size) return { loaded: MAPS.size, failed: [] };
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const n = installThresholds(await res.json());
    return { loaded: n, failed: [] };
  } catch (e) {
    FAILURES.set('*', String(e && e.message ? e.message : e));
    return { loaded: 0, failed: [String(e && e.message ? e.message : e)] };
  }
}

/* ------------------------------------------------------------- the algorithms --- */

/**
 * Ordered dithering. The cell's value is compared with the map's threshold at its position in
 * the tile; the map's `divisor` normalises the raw integers to 0..1.
 *
 * The tile WRAPS (its position is the cell's coordinates modulo the map size), which is what
 * makes an ordered map tessellate. Using a clamp instead would put every cell outside the first
 * tile on the same threshold and produce a banded image rather than a dither.
 */
function ordered(map, x, y, v, levels) {
  const t = map.cells[(y % map.height) * map.width + (x % map.width)] / map.divisor;
  // THE QUANTISER NEEDS (levels - 1), NOT levels. With `levels` in the divisor, a two-level
  // dither came out as {0, 0.5, 1} -- three values, none of them binary -- because
  // `floor(v * 2) / 2` already spans two steps before the threshold term is added. Dividing by
  // `levels - 1` makes N levels mean exactly N distinct outputs: 2 gives {0,1}, 5 gives fifths.
  const n = Math.max(2, levels);
  const steps = n - 1;
  return Math.floor(v * steps + t) / steps;
}

/**
 * Floyd–Steinberg error diffusion over one scanline order.
 *
 * The error at each cell is pushed to four neighbours with the classic 7/16, 3/16, 5/16, 1/16
 * weights. This cannot be a lookup because each cell's threshold depends on the error carried
 * into it from cells already visited.
 */
function floydSteinberg(src, size, levels) {
  const buf = Float32Array.from(src);
  const out = new Float32Array(size * size);
  const L = Math.max(2, levels);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const old = buf[i];
      const q = Math.round(old * (L - 1)) / (L - 1);
      out[i] = q;
      const err = old - q;
      const put = (xx, yy, w) => {
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) return;
        buf[yy * size + xx] += err * w;
      };
      put(x + 1, y, 7 / 16);
      put(x - 1, y + 1, 3 / 16);
      put(x, y + 1, 5 / 16);
      put(x + 1, y + 1, 1 / 16);
    }
  }
  return out;
}

/**
 * Riemersma dithers along a Hilbert curve, carrying the error to the single next cell rather than
 * spreading it to four.
 *
 * The curve order is the whole point -- it keeps the error close to where it came from in two
 * dimensions -- so it is generated properly rather than approximated by a scanline walk. Labelled
 * `approx` in the registry because the binary's exact variant was not read.
 */
function riemersma(src, size, levels) {
  const out = new Float32Array(size * size);
  const L = Math.max(2, levels);
  // A curve order has to be a power of two; round up and clamp writes outside the grid.
  let order = 1;
  while ((1 << order) < size) order++;
  const n = 1 << order;

  // Standard Hilbert d2xy.
  const d2xy = (d) => {
    let rx = 0;
    let ry = 0;
    let t = d;
    let x = 0;
    let y = 0;
    for (let s = 1; s < n; s *= 2) {
      rx = 1 & (t / 2);
      ry = 1 & (t ^ rx);
      // rotate
      if (ry === 0) {
        if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
        const tmp = x; x = y; y = tmp;
      }
      x += s * rx;
      y += s * ry;
      t = Math.floor(t / 4);
    }
    return [x, y];
  };

  let err = 0;
  for (let d = 0; d < n * n; d++) {
    const [x, y] = d2xy(d);
    if (x >= size || y >= size) continue;
    const i = y * size + x;
    const want = src[i] + err;
    const q = Math.round(Math.max(0, Math.min(1, want)) * (L - 1)) / (L - 1);
    out[i] = q;
    err = (want - q) * 0.5;      // a single carried error, which is Riemersma's structure
  }
  return out;
}

/* ------------------------------------------------------------------ the node --- */

function P(params, name, dflt) {
  if (!params) return dflt;
  const v = params[name];
  return v === undefined || v === null ? dflt : v;
}

/**
 * The `Halftone` node.
 *
 * Parameters, defaults and ranges from the assembly:
 *
 *     [Parameter(Parameters.OptionsGridDehumanized, HalftonePattern.FloydSteinberg, 0f, 1f)] Pattern
 *     [Parameter(false, 0f, 1f)] Posterize
 *     [Parameter(5f, 2f, 64f)]   Depth
 *
 * `Posterize` false is passed as `-1`, which the managed code uses as the "do not posterise"
 * sentinel. So `Depth` only takes effect when Posterize is set, and a test can pin exactly that.
 *
 * Rendered as a mask, so the output is a single channel despite the patterns being pictorial.
 */
export function gaeaHalftone(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height');
  const ch = src.channels || 1;
  const d = new Float32Array(size * size);
  for (let i = 0; i < d.length; i++) {
    const v = src.data[i * ch];
    d[i] = Number.isFinite(v) ? v : 0;
  }

  const pattern = String(P(params, 'Pattern', 'FloydSteinberg'));
  const posterize = !!P(params, 'Posterize', false);
  const depth = Math.max(2, Math.min(64, Math.round(Number(P(params, 'Depth', 5)))));
  // `Posterize ? Depth : -1` -- the sentinel means the height field is dithered to black and
  // white rather than to `Depth` levels.
  const levels = posterize ? depth : 2;

  const spec = HALFTONE_PATTERNS[pattern];
  if (!spec) {
    // An unknown pattern gets the diffusion default rather than a blank field, and the registry
    // documents that the enum is closed.
    return wrap(floydSteinberg(d, size, levels), size);
  }
  if (spec.algo === 'floyd') return wrap(floydSteinberg(d, size, levels), size);
  if (spec.algo === 'riemersma') return wrap(riemersma(d, size, levels), size);

  const map = MAPS.get(spec.map);
  if (!map) {
    // Reported through `thresholdStatus()`; falling back keeps the node usable.
    return wrap(floydSteinberg(d, size, levels), size);
  }
  const out = createField(size, 'height');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out.data[y * size + x] = ordered(map, x, y, d[y * size + x], levels);
    }
  }
  return out;
}

function wrap(arr, size) {
  const out = createField(size, 'height');
  out.data.set(arr);
  return out;
}
