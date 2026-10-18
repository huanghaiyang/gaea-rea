/**
 * Field generators and colour maths ported from the recovered Gaea source.
 *
 * Every formula here is a direct transcription of the constant-resolved decompile
 * (`evidence/decompiled/Gaea.Nodes.resolved.cs`): `Gradients.*`, `ColorCore.HSL`,
 * `Profiles.Sine/Triangle/Sawtooth`, `Others.SwirlHeightfield`, `Shape.Generate*`.
 * The numeric checks live in `tools/verify-exact.mjs`, which runs the shipped assemblies.
 *
 * Conventions that matter:
 *  - Map.Generate's `ProcessContext.X/Y` are pixel coordinates (column, row), not UV.
 *  - Gaea colour maps are 3-channel; this app stores RGBA interleaved, so colour ports read
 *    components 0/1/2 and leave alpha untouched.
 */

/* ================================================================== gradients */

const DEG = 0.017453292; // the shipped float constant, not Math.PI/180

export const EDGE_CLIP = 0;
export const EDGE_REPEAT = 1;
export const EDGE_MIRROR = 2;

/**
 * `Gradients.LinearGradient(N, CenterX, CenterY, Length, Azimuth, Edge)`.
 * azimuth 0 puts height 1 at the top and 0 at the bottom (derived from -sin / cos).
 *
 * Every intermediate is rounded to float32 here, because the shipped loop is single precision.
 * Edge=Repeat wraps with `floor`, so a value that is 1 - 1e-7 in double but exactly 1.0f in float
 * lands on the opposite side of the wrap; doing this in double produced a visible seam.
 */
export function linearGradient(N, centerX, centerY, length, azimuthDeg, edgeBehaviour = EDGE_CLIP) {
  const f = Math.fround;
  const out = new Float32Array(N * N);
  const lenInv = f(1 / f(length));
  const az = f(f(azimuthDeg) * f(DEG));
  const azX = f(-f(Math.sin(az)));
  const azY = f(Math.cos(az));
  for (let y = 0; y < N; y++) {
    const dy = f(f(y) - f(centerY));
    for (let x = 0; x < N; x++) {
      const dx = f(f(x) - f(centerX));
      let v = f(f(-f(f(f(dx * azX) + f(dy * azY)))) * lenInv);
      v = f(v + 0.5);
      if (edgeBehaviour === EDGE_REPEAT) {
        v = f(v - Math.floor(v));
      } else if (edgeBehaviour === EDGE_MIRROR) {
        v = f(v * 0.5);
        v = f(v - Math.floor(v));
        v = f(v * 2);
        if (v > 1) v = f(2 - v);
      } else {
        v = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      out[y * N + x] = v;
    }
  }
  return out;
}

/** `Gradients.RadialGradient(N, CenterX, CenterY, radius, height)`. */
export function radialGradient(N, centerX, centerY, radius, height = 1) {
  const out = new Float32Array(N * N);
  const rInv = 1 / radius;
  for (let y = 0; y < N; y++) {
    const dy = y - centerY;
    for (let x = 0; x < N; x++) {
      const dx = x - centerX;
      let a = 1 - Math.sqrt(dx * dx + dy * dy) * rInv;
      a = a < 0 ? 0 : a;
      a *= a * (3 - 2 * a);
      out[y * N + x] = a * height;
    }
  }
  return out;
}

/** `Gradients.Cone(N, CenterX, CenterY, radius, height)` — linear falloff, not smoothstepped. */
export function coneGradient(N, centerX, centerY, radius, height = 1) {
  const out = new Float32Array(N * N);
  const rInv2 = 1 / (radius * radius);
  for (let y = 0; y < N; y++) {
    const dy = y - centerY;
    for (let x = 0; x < N; x++) {
      const dx = x - centerX;
      let a = (dx * dx + dy * dy) * rInv2;
      a = a > 1 ? 1 : a;
      a = 1 - Math.sqrt(a);
      out[y * N + x] = a * height;
    }
  }
  return out;
}

/** `Gradients.Hemisphere(variant)(N, CenterX, CenterY, radius, height)`. */
export function hemisphereGradient(N, centerX, centerY, radius, height = 1, flatten = false) {
  const out = new Float32Array(N * N);
  const rInv2 = 1 / (radius * radius);
  for (let y = 0; y < N; y++) {
    const dy = y - centerY;
    for (let x = 0; x < N; x++) {
      const dx = x - centerX;
      let a = (dx * dx + dy * dy) * rInv2;
      a = a > 1 ? 1 : a;
      a = flatten ? Math.sqrt(1 - a * a) : Math.sqrt(1 - a);
      out[y * N + x] = a * height;
    }
  }
  return out;
}

/* ================================================================== waves / folds */

/**
 * `Profiles.Sine / Triangle / Sawtooth` with the optional folds mask.
 * `a` is the heightfield value and `fm` the mask value (1 when no mask is connected).
 * The mask multiplies the fold count, which is what lets a mask localise the folding.
 */
export function foldField(src, N, mask, waveform, folds, symmetric) {
  const out = new Float32Array(N * N);
  const TAU = 6.2831855;
  const fmOf = (i) => (mask ? mask[i] : 1);
  for (let i = 0; i < N * N; i++) {
    const a = src[i];
    const fm = fmOf(i);
    let v;
    if (waveform === 'Triangle') {
      const base = symmetric ? (a - 0.5) * folds * fm : a * folds * fm;
      v = 1 - Math.abs(fract(base + 0.25) * 2 - 1);
    } else if (waveform === 'Sawtooth') {
      const base = symmetric ? (a - 0.5) * folds * fm : a * folds * fm;
      v = fract(base + 0.5);
    } else {
      const base = symmetric ? (a - 0.5) * folds * fm : a * fm * folds;
      v = Math.sin(base * TAU) * 0.5 + 0.5;
    }
    out[i] = v;
  }
  return out;
}

function fract(v) {
  return v - Math.floor(v);
}

/* ================================================================== swirl */

/**
 * `Others.SwirlHeightfield(map, amount, center)` — rotate each sample around the centre by an
 * angle proportional to its radius, then bilinearly resample with Gaea's mirrored border.
 */
export function swirlField(src, N, swirlAmount, centerX, centerY) {
  const out = new Float32Array(N * N);
  const cx = centerX * N;
  const cy = centerY * N;
  for (let i = 0; i < N; i++) {
    const dy = i - cy;
    for (let j = 0; j < N; j++) {
      const dx = j - cx;
      const r = Math.sqrt(dx * dx + dy * dy);
      const ang = swirlAmount * r;
      const s = Math.sin(ang);
      const c = Math.cos(ang);
      const sx = c * dx - s * dy + cx;
      const sy = s * dx + c * dy + cy;
      out[i * N + j] = interpolateHeightMirror(src, N, sx, sy);
    }
  }
  return out;
}

/** Gaea's `InterpolateHeight` + `MirrorCoordinate` pair, verbatim in effect. */
export function interpolateHeightMirror(src, N, x, y) {
  x = mirrorCoordinate(x, N);
  y = mirrorCoordinate(y, N);
  const xi = x | 0;
  const yi = y | 0;
  const x1 = Math.min(xi + 1, N - 1);
  const y1 = Math.min(yi + 1, N - 1);
  const tx = x - xi;
  const ty = y - yi;
  const v00 = src[yi * N + xi];
  const v10 = src[yi * N + x1];
  const v01 = src[y1 * N + xi];
  const v11 = src[y1 * N + x1];
  const top = v00 + (v10 - v00) * tx;
  const bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

function mirrorCoordinate(c, N) {
  if (c < 0) c = -c;
  else if (c >= N) c = 2 * N - c - 1;
  return Math.max(0, Math.min(N - 1, c));
}

/* ================================================================== Shape */

/** `Shape.GenerateOval` — an elliptical ring of thickness `thickness` (fraction of the radius). */
export function generateOval(N, sizeX, sizeY, thickness, centerX, centerY) {
  const out = new Float32Array(N * N);
  const half = N / 2;
  const rx = sizeX * half;
  const ry = sizeY * half;
  const thx = (thickness * rx) / 2;
  const thy = (thickness * ry) / 2;
  const inX = rx - thx;
  const inY = ry - thy;
  const outX = rx + thx;
  const outY = ry + thy;
  const cx = centerX * N;
  const cy = centerY * N;
  for (let i = 0; i < N; i++) {
    const dy = i + 0.5 - cy;
    for (let j = 0; j < N; j++) {
      const dx = j + 0.5 - cx;
      const inner = (dx * dx) / (inX * inX) + (dy * dy) / (inY * inY);
      const outer = (dx * dx) / (outX * outX) + (dy * dy) / (outY * outY);
      out[i * N + j] = inner >= 1 && outer <= 1 ? 1 : 0;
    }
  }
  return out;
}

/** `Shape.GenerateRectangle` — rectangular ring, thickness a fraction of the smaller half-size. */
export function generateRectangle(N, sizeX, sizeY, thickness, centerX, centerY) {
  const out = new Float32Array(N * N);
  const half = N / 2;
  const hx = (sizeX * half) / 2;
  const hy = (sizeY * half) / 2;
  const t = thickness * Math.min(hx, hy);
  const cx = centerX * N;
  const cy = centerY * N;
  const oL = cx - hx, oR = cx + hx, oT = cy - hy, oB = cy + hy;
  const iL = cx - hx + t, iR = cx + hx - t, iT = cy - hy + t, iB = cy + hy - t;
  for (let y = 0; y < N; y++) {
    const py = y + 0.5;
    for (let i = 0; i < N; i++) {
      const px = i + 0.5;
      const outer = px >= oL && px <= oR && py >= oT && py <= oB;
      const inner = px >= iL && px <= iR && py >= iT && py <= iB;
      out[y * N + i] = outer && !inner ? 1 : 0;
    }
  }
  return out;
}

/* ================================================================== HSL */

/**
 * `ColorCore.ModifyHSL` — hue is an absolute shift in turns (0..1), saturation and lightness are
 * factors applied as `1 + param`. Operates on interleaved RGB triplets.
 */
export function modifyHSL(r, g, b, hueShift, saturationFactor, lightnessFactor) {
  const mx = Math.max(r, Math.max(g, b));
  const mn = Math.min(r, Math.min(g, b));
  const delta = mx - mn;
  let h = 0;
  let s = 0;
  let l = (mx + mn) / 2;
  if (delta > 0) {
    s = delta / (l > 0.5 ? 2 - mx - mn : mx + mn);
    h =
      mx === r
        ? (g - b) / delta + (g < b ? 6 : 0)
        : mx === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
    h /= 6;
  }
  h = (h + hueShift) % 1;
  if (h < 0) h += 1;
  s = clamp01(s * saturationFactor);
  l = clamp01(l * lightnessFactor);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRGB(p, q, h + 0.33333334), hueToRGB(p, q, h), hueToRGB(p, q, h - 0.33333334)];
}

function hueToRGB(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 0.16666667) return p + (q - p) * 6 * t;
  if (t < 0.5) return q;
  if (t < 0.6666667) return p + (q - p) * (0.6666667 - t) * 6;
  return p;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Apply HSL to an interleaved colour field. `data` is RGBA per pixel; a single-channel (grey)
 * input is expanded to r=g=b so the node is still usable.
 */
export function applyHSL(data, N, channels, hue, saturation, lightness) {
  const out = new Float32Array(data.length);
  const satF = 1 + saturation;
  const litF = 1 + lightness;
  for (let i = 0; i < N * N; i++) {
    const o = i * (channels === 1 ? 1 : 4);
    let r, g, b;
    if (channels === 1) {
      r = g = b = data[i];
    } else {
      r = data[o];
      g = data[o + 1];
      b = data[o + 2];
    }
    const [nr, ng, nb] = modifyHSL(r, g, b, hue, satF, litF);
    if (channels === 1) {
      out[i] = nr;
    } else {
      out[o] = nr;
      out[o + 1] = ng;
      out[o + 2] = nb;
      out[o + 3] = data[o + 3];
    }
  }
  return out;
}
