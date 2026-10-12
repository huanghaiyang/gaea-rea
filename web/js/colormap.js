/**
 * colormap.js — height-field colour ramps shared by the 2D map, the 3D view and the legend.
 *
 * Every ramp is a list of RGB stops in LINEAR space. `rampRGB` returns 0..255 sRGB values
 * because both the canvas fallback and the exported PNG are sRGB surfaces.
 */

const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** stops: [t, r, g, b] with t ascending in 0..1 and rgb linear 0..1 */
export const RAMPS = {
  terrain: [
    [0.00, 0.020, 0.055, 0.098],
    [0.18, 0.055, 0.153, 0.196],
    [0.34, 0.145, 0.278, 0.180],
    [0.48, 0.310, 0.400, 0.196],
    [0.60, 0.482, 0.443, 0.259],
    [0.70, 0.600, 0.520, 0.365],
    [0.79, 0.678, 0.612, 0.510],
    [0.87, 0.760, 0.735, 0.690],
    [0.94, 0.870, 0.880, 0.880],
    [1.00, 0.980, 0.990, 1.000],
  ],
  gray: [
    [0.0, 0, 0, 0],
    [1.0, 1, 1, 1],
  ],
  flow: [
    [0.00, 0.010, 0.030, 0.075],
    [0.35, 0.030, 0.140, 0.290],
    [0.65, 0.060, 0.360, 0.520],
    [0.85, 0.320, 0.680, 0.700],
    [1.00, 0.880, 0.980, 0.960],
  ],
  heat: [
    [0.00, 0.020, 0.000, 0.090],
    [0.25, 0.290, 0.000, 0.380],
    [0.50, 0.800, 0.130, 0.180],
    [0.75, 0.980, 0.600, 0.060],
    [1.00, 1.000, 1.000, 0.780],
  ],
};

/** Sample a ramp at t in [0,1]; writes r,g,b (0..255) into `out` at `off`. */
export function rampRGB(ramp, t, out, off) {
  const stops = RAMPS[ramp] || RAMPS.terrain;
  let x = t;
  if (!Number.isFinite(x)) x = 0;
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
  const a = stops[i], b = stops[i + 1];
  const span = b[0] - a[0];
  const f = span <= 1e-9 ? 0 : (x - a[0]) / span;
  const r = a[1] + (b[1] - a[1]) * f;
  const g = a[2] + (b[2] - a[2]) * f;
  const bl = a[3] + (b[3] - a[3]) * f;
  out[off] = (srgb(r) * 255) | 0;
  out[off + 1] = (srgb(g) * 255) | 0;
  out[off + 2] = (srgb(bl) * 255) | 0;
}

/**
 * Paint a scalar field into an ImageData-like {data} buffer.
 * `shade` optionally multiplies brightness by a per-pixel 0..1 shading factor.
 */
export function paintField(field, imageData, opts = {}) {
  const ramp = opts.ramp || 'terrain';
  const min = opts.min !== undefined ? opts.min : 0;
  const max = opts.max !== undefined ? opts.max : 1;
  const gamma = opts.gamma || 1;
  const invert = !!opts.invert;
  const size = field.size;
  const src = field.data;
  const channels = field.channels || 1;
  const out = imageData.data;
  const scale = max - min > 1e-9 ? 1 / (max - min) : 0;
  const rgb = new Uint8ClampedArray(3);

  if (channels === 4) {
    for (let i = 0; i < size * size; i++) {
      const o = i * 4;
      out[o] = (src[o] * 255) | 0;
      out[o + 1] = (src[o + 1] * 255) | 0;
      out[o + 2] = (src[o + 2] * 255) | 0;
      out[o + 3] = 255;
    }
    return imageData;
  }

  for (let i = 0; i < size * size; i++) {
    let t = (src[i] - min) * scale;
    if (invert) t = 1 - t;
    if (gamma !== 1) t = Math.pow(t < 0 ? 0 : t > 1 ? 1 : t, gamma);
    rampRGB(ramp, t, rgb, 0);
    if (opts.shade) {
      const s = opts.shade[i];
      rgb[0] = (rgb[0] * s) | 0; rgb[1] = (rgb[1] * s) | 0; rgb[2] = (rgb[2] * s) | 0;
    }
    const o = i * 4;
    out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = 255;
  }
  return imageData;
}

/** CSS gradient string for a ramp (used on the viewport legend). */
export function rampCSS(ramp) {
  const stops = RAMPS[ramp] || RAMPS.terrain;
  const parts = stops.map((s) => {
    const r = (srgb(s[1]) * 255) | 0, g = (srgb(s[2]) * 255) | 0, b = (srgb(s[3]) * 255) | 0;
    return `rgb(${r},${g},${b}) ${(s[0] * 100).toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}
