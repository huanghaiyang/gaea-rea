/**
 * imaging.js — the Gaea nodes that delegate to ImageMagick.
 *
 * ROUTING FINDING
 * A census of the decompiled managed assembly (`evidence/decompiled/Gaea.Nodes.whole.cs`)
 * finds 195 `Node` subclasses and 43 references to `MagickImage`. The pattern is uniform: a
 * node reads its input map into a `MagickImage`, calls one ImageMagick operation, and commits
 * the result back. `Gamma` is the clearest example:
 *
 *     MagickImage magickImage = <copy>(map);
 *     if (Automatic) magickImage.AutoGamma();
 *     else           magickImage.GammaCorrect(GammaValue);
 *     Commit(<toMap>(magickImage), true, true);
 *
 * THAT IS WHY THESE NODES HAVE NO NATIVE EXPORT
 * `Gaea.Native.dll` exports 20 symbols and none of them is a gamma, blur, resize or normalize
 * kernel, because the algorithm is not Gaea's — it is ImageMagick's, and it ships in the
 * managed layer. Trying to find these kernels in the native libraries would be a dead end.
 *
 * WHAT THIS MEANS FOR FIDELITY
 * The ImageMagick operations are published, deterministic formulas, so they can be reproduced
 * exactly on the normalised 0..1 values this app uses. The parameter metadata in the managed
 * source is authoritative — `[Parameter(0.44f, 0f, 4f)]` is the real default and range, not a
 * catalogue transcription.
 */

/**
 * ImageMagick's `GammaCorrect(gamma)`.
 *
 * The operation raises every sample to the power `1 / gamma`:
 *
 *     out = pow(clamp(v, 0, 1), 1 / gamma)
 *
 * The reciprocal is the part that is easy to get backwards. With `gamma > 1` the exponent is
 * below 1, which RAISES midtones — that is "gamma correction" as an image tool means it, and
 * inverting it produces the opposite of the intended look.
 *
 * The endpoints are fixed points for any gamma, which is a useful invariant: 0 and 1 cannot
 * move, so a gamma change never clips the terrain's floor or ceiling.
 *
 * @param {number} v sample, clamped to 0..1
 * @param {number} gamma must be positive; 1 is the identity
 * @returns {number}
 */
export function magickGammaCorrect(v, gamma) {
  const x = Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
  const g = Number.isFinite(gamma) && gamma > 0 ? gamma : 1;
  return Math.pow(x, 1 / g);
}

/**
 * The inverse of the gamma curve, for the AutoGamma computation.
 *
 * `GammaCorrect` maps input to output as `y = x^(1/g)`. Solving for the gamma that maps a
 * given mean to a target:
 *
 *     target = mean^(1/g)   =>   log(target) = log(mean) / g   =>   g = log(mean) / log(target)
 *
 * @param {number} mean normalised mean, in (0, 1)
 * @param {number} target where the mean should land, normally 0.5
 * @returns {number} the gamma, or 1 when the mean is degenerate
 */
export function magickGammaForMean(mean, target) {
  const m = Number.isFinite(mean) ? mean : 0;
  const t = Number.isFinite(target) ? target : 0.5;
  if (!(m > 0) || !(m < 1) || !(t > 0) || !(t < 1) || t === m) return 1;
  return Math.log(m) / Math.log(t);
}

/**
 * ImageMagick's `AutoGamma()`: choose the gamma that maps the image's mean to mid-grey.
 *
 * This is the whole content of the operation, and it is checkable rather than plausible —
 * applying `magickGammaCorrect(mean, autoGamma(mean))` must give 0.5, which is what "auto"
 * means. A test asserts exactly that, at several means.
 *
 * A mean at or beyond the ends has no finite solution, so it falls back to the identity. The
 * binary hits the same case through the underlying library's histogram guard.
 *
 * @param {number} mean normalised mean of the input
 * @returns {number} the gamma to apply
 */
export function magickAutoGamma(mean) {
  return magickGammaForMean(mean, 0.5);
}

/**
 * The `Gamma` node as the app calls it.
 *
 * Parameter metadata is taken from the managed source, which is authoritative:
 *
 *     [Parameter(0.44f, 0f, 4f)] [Name("Gamma")]  GammaValue
 *     [Parameter(false, 0f, 1f)]                  Automatic
 *
 * so the default is 0.44 and the range is 0..4, NOT the 0..1 this build would have guessed.
 * `Automatic` wins when set, matching the `if (Automatic) ... else ...` in `Build`.
 */
export function gaeaGamma(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return null;
  const ch = src.channels || 1;
  const n = size * size;
  const out = new Float32Array(n * ch);
  const automatic = !!P(params, 'Automatic', false);
  const gammaValue = P(params, 'Gamma', 0.44);
  const gamma = automatic ? null : (Number.isFinite(gammaValue) && gammaValue > 0 ? gammaValue : 0.44);

  let mean = 0;
  if (automatic) {
    for (let i = 0; i < n; i++) mean += src.data[i * ch];
    mean /= n;
  }
  const g = automatic ? magickAutoGamma(mean) : gamma;

  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = src.data[i * ch + c];
      out[i * ch + c] = magickGammaCorrect(Number.isFinite(v) ? v : 0, g);
    }
  }
  return { data: out, channels: ch, size, channel: src.channel || 'height' };
}

/* -------------------------------------------------- BlobRemover (connected components) */

/**
 * Quantise a field to `levels` discrete values, which is what makes connected components
 * possible at all.
 *
 * WHY THIS IS NOT OPTIONAL
 * A height field normally has a distinct value in every cell, so "connected region of equal
 * value" would label every cell as its own component and the area threshold would remove the
 * entire image. Gaea's `BlobRemover` therefore exposes `EnforceQuantization` with a default of
 * 64 levels — the terracing is what creates regions to measure. Reading the node as "remove
 * small blobs from the raw field" is the mistake this function exists to prevent.
 *
 * @param {Float32Array} src
 * @param {number} levels
 * @returns {Float32Array}
 */
export function terraceField(src, levels) {
  const n = Number.isFinite(levels) && levels >= 2 ? Math.floor(levels) : 64;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = Number.isFinite(src[i]) ? src[i] : 0;
    const c = v < 0 ? 0 : v > 1 ? 1 : v;
    // Snap to the centre of its band so equal bands compare equal after float32 rounding.
    out[i] = Math.round(c * (n - 1)) / (n - 1);
  }
  return out;
}

/**
 * Label connected components of equal value.
 *
 * `connectivity` is 4 or 8, matching Gaea's `Connectivity` parameter whose range is literally
 * 4..8. The difference matters on a diagonal: two cells touching only at a corner are one
 * component at 8 and two at 4.
 *
 * @param {Float32Array} field
 * @param {number} size
 * @param {number} connectivity 4 or 8
 * @returns {{labels: Int32Array, areas: Int32Array, count: number}}
 */
export function labelComponents(field, size, connectivity) {
  const n = size * size;
  const labels = new Int32Array(n).fill(-1);
  const areas = [];
  const eight = connectivity >= 8;
  const NEI4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const NEI8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const NEI = eight ? NEI8 : NEI4;
  const stack = new Int32Array(n);

  let next = 0;
  for (let seed = 0; seed < n; seed++) {
    if (labels[seed] !== -1) continue;
    const value = field[seed];
    const id = next++;
    let sp = 0;
    stack[sp++] = seed;
    labels[seed] = id;
    let area = 0;
    while (sp > 0) {
      const c = stack[--sp];
      area++;
      const cx = c % size;
      const cy = (c / size) | 0;
      for (let k = 0; k < NEI.length; k++) {
        const nx = cx + NEI[k][0];
        const ny = cy + NEI[k][1];
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const j = ny * size + nx;
        if (labels[j] !== -1) continue;
        if (field[j] !== value) continue;
        labels[j] = id;
        stack[sp++] = j;
      }
    }
    areas.push(area);
  }
  return { labels, areas: Int32Array.from(areas), count: next };
}

/**
 * The `BlobRemover` node.
 *
 * Transcribed from the managed `Build()`:
 *
 *     ConnectedComponentsSettings {
 *         Connectivity  = (uint)Connectivity,
 *         AreaThreshold = new Threshold(resolution.X * Range),
 *         MeanColor     = true
 *     }
 *     magickImage.ConnectedComponents(settings);
 *     magickImage.Grayscale();
 *
 * so the area threshold is **`resolution.X * Range`**, not a cell count and not an area
 * fraction — it scales with the grid's width, which is what keeps the node's behaviour
 * resolution-independent.
 *
 * FIDELITY: `approx`
 * The labelling, the connectivity parameter, the terracing and the threshold formula are all
 * transcribed. What is INFERRED is what replaces a removed component. ImageMagick's
 * `AreaThreshold` merges a below-threshold component into its surroundings; the exact merge
 * rule is inside the library. This implementation assigns each removed component the value of
 * whichever labelled neighbour is largest, which is the standard reading and is stated as a
 * choice rather than presented as recovered.
 */
export function gaeaBlobRemover(ctx) {
  const { size, params, input } = ctx;
  const src = input(0);
  if (!src) return null;
  const ch = src.channels || 1;
  const n = size * size;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = src.data[i * ch];
    raw[i] = Number.isFinite(v) ? v : 0;
  }

  // The vendor catalogue names this `Enforce Quantization`, WITH a space — the C# property is
  // `EnforceQuantization` and the attribute carries no name, so the UI label differs from the
  // identifier. Reading the identifier here would silently leave terracing off, exactly the
  // way the earlier `Enable` toggle left the erosion solver off. Both spellings are accepted
  // so the kernel works whether it is driven by the catalogue or by the C# property name.
  const enforce = !!(P(params, 'Enforce Quantization', undefined)
    ?? P(params, 'EnforceQuantization', false));
  const quantization = P(params, 'Quantization', 64);
  const field = enforce ? terraceField(raw, quantization) : Float32Array.from(raw);

  // Connectivity is 4 or 8; the parameter's own range is 4..8, so it is taken literally.
  const cRaw = P(params, 'Connectivity', 4);
  const connectivity = Number(cRaw) >= 6 ? 8 : 4;
  const range = Math.max(0, P(params, 'Range', 0.05));
  const areaThreshold = size * range;

  const { labels, areas } = labelComponents(field, size, connectivity);

  // Which components survive.
  const survive = new Uint8Array(areas.length);
  for (let i = 0; i < areas.length; i++) survive[i] = areas[i] >= areaThreshold ? 1 : 0;

  // For each removed component, find the largest surviving neighbour to adopt. This is the
  // inferred step; see the fidelity note above.
  const adopt = new Int32Array(areas.length).fill(-1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const id = labels[i];
      if (survive[id]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const nid = labels[ny * size + nx];
          if (!survive[nid]) continue;
          if (adopt[id] < 0 || areas[nid] > areas[adopt[id]]) adopt[id] = nid;
        }
      }
    }
  }

  const out = new Float32Array(n * ch);
  // The representative value of each label, taken from wherever that label first appears.
  const remap = new Float32Array(areas.length);
  const seen = new Uint8Array(areas.length);
  for (let i = 0; i < n; i++) {
    const id = labels[i];
    if (!seen[id]) { seen[id] = 1; remap[id] = field[i]; }
  }

  for (let i = 0; i < n; i++) {
    const id = labels[i];
    const target = survive[id] ? id : adopt[id];
    const v = target >= 0 ? remap[target] : field[i];
    for (let c = 0; c < ch; c++) out[i * ch + c] = v;
  }
  return { data: out, channels: ch, size, channel: src.channel || 'height' };
}

/* -------------------------------------------------- BlobRemover (end) */

function P(params, name, dflt) {
  if (!params) return dflt;
  const v = params[name];
  return v === undefined || v === null ? dflt : v;
}
