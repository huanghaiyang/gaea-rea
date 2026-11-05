/**
 * remaining.js — 盖亚剩余节点的补全实现。
 *
 * 这里收录的节点大多缺少完整可验证的反编译语义：有的是复杂模拟（Shatter / Hillify /
 * Sediments），有的是 3D 导出节点（Mesher / PointCloud），还有的依赖尚未恢复的
 * FastNoise 风格噪声。实现沿用项目其它 kernel 的约定：
 *
 *   - 输入通过 ctx.input(i) 读取；未连接时给出中性值。
 *   - 输出统一为 { size, channel, channels, data } 的 Field。
 *   - 每个算法的保真度以 registry 里的 note 标注：exact / approx / model / stub。
 *
 * 对于可以直接从反编译 Build() 读出公式的节点（Grid、MathX、Tint、Splat 等），实现
 * 尽量贴近原意；对于噪声/模拟类节点则使用本项目的确定性噪声与近似流程，保证可复现。
 */

import {
  createField, cloneField, toScalar, clamp01, clamp, lerp, smoothstep, safeDiv,
  gaussianBlur, slopeMagnitude, equalizeInPlace, autolevelInPlace,
} from '../kernel/field.js';
import { perlin2, value2, worley2, fractalSum, ridged2 } from '../kernel/noise.js';
import { hash2f, mix32 } from '../kernel/hash.js';
import { sampleBilinear } from '../kernel/coords.js';
import {
  linearGradient, applyHSL, EDGE_CLIP,
} from '../kernel/gaea-fields.js';
import { profileTerrace } from '../kernel/gaea-terrace.js';
import { cartographerContours } from '../kernel/gaea-cartographer.js';
import { flowAccumulation } from '../kernels/erosion.js';
import { occlusion } from '../kernels/features.js';
import { fileStub } from '../kernels/generators.js';

/* ------------------------------------------------------------------ 通用工具 */

/** 读取参数；缺失或非法时返回默认值。 */
function P(params, name, dflt) {
  const v = params ? params[name] : undefined;
  if (v === undefined || v === null) return dflt;
  if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
  return v;
}
const B = (params, name, dflt = false) => Boolean(P(params, name, dflt));
const NUM = (params, name, dflt = 0) => Number(P(params, name, dflt));
const ENUM = (params, name, dflt) => String(P(params, name, dflt));

/** Float2 参数可能是单个数字，也可能是 [x, y]。 */
function F2(params, name, dflt) {
  const v = P(params, name, dflt);
  if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0];
  const n = Number(v);
  return [Number.isFinite(n) ? n : dflt, Number.isFinite(n) ? n : dflt];
}

/** 输入端口 0..i 的标量版本；缺省时返回常量 height 场。 */
function inOr(ctx, i, dflt = 0.5) {
  const f = ctx.input(i);
  if (!f) return createField(ctx.size, 'height', dflt);
  return f.channels === 1 ? f : toScalar(f);
}

/** 输出一个 height/mask 场。 */
function outField(size, data, channel = 'height') {
  return { size, channel, channels: 1, data };
}

/** 创建 RGBA 颜色场，alpha 预置为 1。 */
function colorField(size) {
  const f = createField(size, 'color');
  for (let i = 0; i < size * size; i++) f.data[i * 4 + 3] = 1;
  return f;
}

/** 颜色参数统一成 [r,g,b,a]，允许 3 分量或 hex 字符串。 */
function colorParam(v, dflt) {
  if (Array.isArray(v) && v.length >= 3) {
    return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0, v[3] === undefined ? 1 : Number(v[3])];
  }
  if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v)) {
    const s = v.replace('#', '');
    return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255,
      parseInt(s.slice(4, 6), 16) / 255, 1];
  }
  return dflt;
}

function deg2rad(d) { return (d * Math.PI) / 180; }

/** 旋转坐标：(u,v) 绕中心旋转 -angle 度。 */
function rot(u, v, angleDeg) {
  const a = deg2rad(angleDeg);
  const c = Math.cos(a), s = Math.sin(a);
  return [u * c - v * s, u * s + v * c];
}

/** 高度场的中心差分梯度（以像素为单位，已按场宽归一化）。 */
function gradientAt(data, size, x, y) {
  const xm = x > 0 ? x - 1 : x, xp = x < size - 1 ? x + 1 : x;
  const ym = y > 0 ? y - 1 : y, yp = y < size - 1 ? y + 1 : y;
  const dx = (data[y * size + xp] - data[y * size + xm]) * 0.5;
  const dy = (data[yp * size + x] - data[ym * size + x]) * 0.5;
  return [dx * size, dy * size];
}

/** 山体阴影：返回 0..1 的受光强度。 */
function hillshadeAt(data, size, x, y, azimuthDeg, elevationDeg, scale = 4) {
  const [gx, gy] = gradientAt(data, size, x, y);
  const nx = -gx * scale, ny = -gy * scale, nz = 1;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const az = deg2rad(azimuthDeg), el = deg2rad(elevationDeg);
  const lx = Math.cos(az) * Math.cos(el);
  const ly = Math.sin(az) * Math.cos(el);
  const lz = Math.sin(el);
  const dot = (nx / len) * lx + (ny / len) * ly + (nz / len) * lz;
  return clamp01(0.5 + dot * 0.5);
}

/** 迭代式洼地填充：把局部低点抬到相邻可排水的水平。 */
function fillPits(src, size, passes = 32) {
  const h = Float32Array.from(src);
  for (let p = 0; p < passes; p++) {
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        let mn = Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const v = h[(y + dy) * size + (x + dx)];
            if (v < mn) mn = v;
          }
        }
        if (h[i] < mn) h[i] = mn;
      }
    }
  }
  return h;
}

/** 简单热力侵蚀传输（用于 Hillify / Crumble / Wizard 等近似节点）。 */
function thermalPass(src, size, steps, talus, anisotropy = 0, angleDeg = 0, removal = 0) {
  const h = Float32Array.from(src);
  const delta = new Float32Array(size * size);
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DD = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];
  const ax = Math.cos(deg2rad(angleDeg)), ay = Math.sin(deg2rad(angleDeg));
  for (let it = 0; it < steps; it++) {
    delta.fill(0);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        const hc = h[i];
        let total = 0;
        const moves = [];
        for (let k = 0; k < 8; k++) {
          const j = (y + DY[k]) * size + (x + DX[k]);
          const diff = hc - h[j];
          if (diff <= 0) continue;
          const slope = diff / DD[k];
          if (slope <= talus) continue;
          let w = 1;
          if (anisotropy > 0) {
            const kx = DX[k] / DD[k], ky = DY[k] / DD[k];
            w = Math.max(0.02, 1 + anisotropy * (kx * ax + ky * ay) * 0.9);
          }
          const excess = (slope - talus) * DD[k] * 0.25;
          moves.push([j, excess * w]);
          total += excess * w;
        }
        if (total <= 0) continue;
        let lowest = Infinity;
        for (const m of moves) if (h[m[0]] < lowest) lowest = h[m[0]];
        let budget = Math.min(total, Math.max(0, (hc - lowest) * 0.5)) * (1 - removal);
        if (budget <= 0) continue;
        for (const m of moves) delta[m[0]] += budget * (m[1] / total);
        delta[i] -= budget;
      }
    }
    for (let i = 0; i < h.length; i++) {
      const v = h[i] + delta[i];
      h[i] = Number.isFinite(v) ? (v < 0 ? 0 : v) : h[i];
    }
  }
  return h;
}

/* ------------------------------------------------------------------ 调色板 */

/** 颜色停靠点：[位置, r, g, b]。 */
const PALETTES = {
  Rock: [[0, 0.09, 0.08, 0.07], [0.35, 0.28, 0.25, 0.21], [0.7, 0.55, 0.51, 0.44], [1, 0.86, 0.83, 0.77]],
  Sand: [[0, 0.24, 0.17, 0.10], [0.4, 0.63, 0.49, 0.31], [0.75, 0.85, 0.72, 0.51], [1, 0.96, 0.90, 0.75]],
  Green: [[0, 0.06, 0.14, 0.06], [0.35, 0.20, 0.38, 0.14], [0.68, 0.45, 0.56, 0.24], [1, 0.82, 0.85, 0.55]],
  Blue: [[0, 0.04, 0.09, 0.18], [0.4, 0.12, 0.28, 0.48], [0.75, 0.36, 0.55, 0.72], [1, 0.80, 0.90, 0.95]],
  Color: [[0, 0.10, 0.10, 0.35], [0.25, 0.18, 0.55, 0.42], [0.5, 0.80, 0.62, 0.20], [0.72, 0.62, 0.34, 0.18], [1, 0.92, 0.92, 0.92]],
};

function sampleStops(stops, t) {
  const x = clamp01(t);
  if (x <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const k = smoothstep(a[0], b[0], x);
      return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)];
    }
  }
  const z = stops[stops.length - 1];
  return [z[1], z[2], z[3]];
}

function writeRGB(out, i, r, g, b) {
  out.data[i * 4] = clamp01(r);
  out.data[i * 4 + 1] = clamp01(g);
  out.data[i * 4 + 2] = clamp01(b);
  out.data[i * 4 + 3] = 1;
}

/* ================================================================== 结构 / 形态 */

/** Shatter：Voronoi 碎裂 + 裂缝 + 细节抖动。 */
export function shatter(ctx) {
  const { size, params, seed } = ctx;
  const count = Math.max(2, NUM(params, 'Shatters', 6) | 0);
  const scale = clamp(NUM(params, 'Size', 0.8), 0.05, 2);
  const coverage = clamp01(NUM(params, 'Coverage', 0.5));
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const w = worley2(u * count * scale, v * count * scale, seed, { jitter: 0.9 });
      const cellH = ((w.id >>> 8) & 0xffff) / 65535;
      const edge = smoothstep(0, 0.08 + coverage * 0.2, w.f2 - w.f1);
      const detail = fractalSum(perlin2, u * 10, v * 10, seed + 17, 4, 2, 0.5, 'Standard') * 0.5 + 0.5;
      let h = (0.22 + 0.55 * cellH) * (0.58 + 0.42 * edge);
      h += (detail - 0.5) * (0.15 + coverage * 0.2);
      d[y * size + x] = clamp01(lerp(0.5, h, coverage));
    }
  }
  return f;
}

/** VariableBlur：按局部起伏混合原图与高斯模糊。 */
export function variableBlur(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0);
  const radius = clamp(NUM(params, 'Radius', 0.01), 0, 1);
  const px = Math.max(1, Math.round(radius * size * 3));
  const blurred = gaussianBlur(src, px);
  const out = createField(size, 'height');
  for (let i = 0; i < out.data.length; i++) {
    const t = clamp01(Math.abs(src.data[i] - 0.5) * 2.4);
    out.data[i] = lerp(src.data[i], blurred.data[i], t);
  }
  return out;
}

/** Grid：等距网格线，Line 与 Sub 两级。 */
export function gridNode(ctx) {
  const { size, params } = ctx;
  const sub = Math.max(1, NUM(params, 'Subdivision', 2) | 0);
  const lineI = clamp01(NUM(params, 'Line Intensity', 1));
  const subI = clamp01(NUM(params, 'Sub Intensity', 0.25));
  const thick = Math.max(1, NUM(params, 'Line Thickness', 1));
  const f = createField(size, 'mask');
  const d = f.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const lineDist = Math.abs((u * sub) % 1 - 0.5) * 2; // 0..1，0 在格线上
      const subDist = Math.abs((u * sub * 2) % 1 - 0.5) * 2;
      const lineX = Math.exp(-Math.pow((1 - lineDist) * sub * size / thick, 2));
      const lineY = Math.exp(-Math.pow((1 - Math.abs((v * sub) % 1 - 0.5) * 2) * sub * size / thick, 2));
      const subX = Math.exp(-Math.pow((1 - subDist) * sub * 2 * size / thick, 2));
      const subY = Math.exp(-Math.pow((1 - Math.abs((v * sub * 2) % 1 - 0.5) * 2) * sub * 2 * size / thick, 2));
      d[y * size + x] = clamp01(Math.max(lineI * Math.max(lineX, lineY), subI * Math.max(subX, subY)));
    }
  }
  return f;
}

/** Hillify：低频丘陵 + 热力蠕变；Surface 决定是否平滑。 */
export function hillify(ctx) {
  const { size, params, seed } = ctx;
  const coverage = clamp01(NUM(params, 'Coverage', 0.5));
  const creep = ENUM(params, 'Creep', 'Moderate');
  const surface = ENUM(params, 'Surface', 'Smooth');
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let n = fractalSum(perlin2, u * 3.2, v * 3.2, seed, 6, 2, 0.5, 'Standard') * 0.5 + 0.5;
      n += (value2(u * 8, v * 8, seed + 5) - 0.5) * 0.25;
      d[y * size + x] = clamp01(lerp(0.5, n, coverage));
    }
  }
  let h = d;
  const steps = creep === 'Aggressive' ? 14 : 5;
  h = thermalPass(h, size, steps, Math.max(0.002, 0.12 * (1 - coverage)), 0, 0, 0);
  const out = createField(size, 'height');
  if (surface === 'Smooth') {
    const b = gaussianBlur(outField(size, h), Math.max(1, Math.round(size * 0.004)));
    out.data.set(b.data);
  } else {
    out.data.set(h);
  }
  return out;
}

/** Stratify：分层阶地 + 倾斜。 */
export function stratify(ctx) {
  const { size, params, seed } = ctx;
  const spacing = clamp(NUM(params, 'Spacing', 0.1), 0, 1);
  const octaves = clamp(NUM(params, 'Octaves', 12) | 0, 1, 12);
  const intensity = clamp01(NUM(params, 'Intensity', 0.5));
  const shape = clamp(NUM(params, 'Shape', 0), -1, 1);
  const tilt = clamp01(NUM(params, 'Tilt Amount', 0.5));
  const dir = NUM(params, 'Direction', 0);
  const base = createField(size, 'height');
  const d = base.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let n = fractalSum(perlin2, u * 4, v * 4, seed, 6, 2, 0.5, 'Standard') * 0.5 + 0.5;
      n += (value2(u * 12, v * 12, seed + 31) - 0.5) * 0.15;
      d[y * size + x] = clamp01(n);
    }
  }
  const terraced = profileTerrace(d, Math.max(2, octaves), 1 - spacing, intensity, 1, seed, false);
  const out = createField(size, 'height');
  const grad = linearGradient(size, size * 0.5, size * 0.5, size, dir, EDGE_CLIP);
  for (let i = 0; i < out.data.length; i++) {
    let v = terraced[i] + (grad[i] - 0.5) * tilt * 0.35 * (1 - Math.abs(shape) * 0.6);
    if (shape < 0) v = lerp(v, 1 - v, -shape * 0.5);
    out.data[i] = clamp01(v);
  }
  return out;
}

/** Island：径向岛屿遮罩 + 海岸噪声。 */
export function island(ctx) {
  const { size, params, seed } = ctx;
  const isize = clamp(NUM(params, 'Size', 0.25), 0.0001, 1);
  const chaos = clamp01(NUM(params, 'Chaos', 0.25));
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const r = Math.sqrt((u - 0.5) * (u - 0.5) + (v - 0.5) * (v - 0.5));
      const coast = fractalSum(perlin2, u * 6, v * 6, seed, 4, 2, 0.5, 'Standard') * chaos * 0.25;
      const mask = 1 - smoothstep(isize * 0.55, isize * 1.35, r + coast);
      const relief = fractalSum(perlin2, u * 10, v * 10, seed + 11, 5, 2, 0.5, 'Standard') * 0.5 + 0.5;
      d[y * size + x] = clamp01(mask * (0.35 + relief * 0.55) + mask * chaos * (value2(u * 24, v * 24, seed) - 0.5) * 0.3);
    }
  }
  return f;
}

/** MountainRange：拉长的山脊带 + 分形山脊。 */
export function mountainRange(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Scale', 0.5), 0, 1);
  const height = clamp(NUM(params, 'Height', 0.5), 0.25, 3);
  const style = ENUM(params, 'Style', 'Basic');
  const bulk = ENUM(params, 'Bulk', 'Medium');
  const angle = (seed % 360);
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const bulkK = bulk === 'Low' ? 1.3 : bulk === 'High' ? 0.75 : 1;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv - 0.5;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv - 0.5;
      const [rx, ry] = rot(u, v, angle);
      const across = Math.abs(ry - Math.sin(rx * 4 + seed) * 0.03);
      const band = Math.exp(-Math.pow(across / (0.16 + scale * 0.1), 2));
      let ridge = fractalSum(perlin2, rx * (5 + scale * 6), ry * (1.2 + scale * 2), seed, 7, 2.05, 0.52, 'Ridged');
      ridge = Math.pow(clamp01(ridge), style === 'Alpine' ? 0.8 : 1.15);
      let h = 0.5 + ridge * band * height * bulkK * 0.5;
      // Stratified：把高度量化到 8 层，模拟水平岩层。
      if (style === 'Stratified') {
        const bands = 8;
        h = (Math.round(h * bands) / bands) * 0.7 + h * 0.3;
      }
      d[y * size + x] = clamp01(h);
    }
  }
  if (style === 'Eroded' || style === 'Alpine') {
    const eroded = thermalPass(d, size, style === 'Alpine' ? 8 : 5, 0.012, 0.2, 45, 0);
    d.set(eroded);
  }
  return f;
}

/** Plates：板块状 Voronoi + 断崖。 */
export function plates(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Scale', 0.5), 0.0001, 0.9999);
  const range = clamp01(NUM(params, 'Range', 0.5));
  const falloff = clamp01(NUM(params, 'Falloff', 0.5));
  const warp = clamp01(NUM(params, 'Warp', 0.5));
  const angle = NUM(params, 'Angle', 0);
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const freq = 1 + scale * 7;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let wu = u, wv = v;
      if (warp > 0) {
        wu += (perlin2(u * 4 + 1, v * 4, seed) * 0.25) * warp;
        wv += (perlin2(u * 4, v * 4 + 1, seed) * 0.25) * warp;
      }
      const w = worley2(wu * freq, wv * freq, seed, { jitter: 0.7, anisotropy: 0.2, angle: deg2rad(angle) });
      const plate = ((w.id >>> 7) & 0xff) / 255;
      const edge = smoothstep(0, 0.05 + falloff * 0.25, w.f2 - w.f1);
      const h = (0.3 + plate * 0.45 * range) * (0.55 + edge * 0.45);
      d[y * size + x] = clamp01(h);
    }
  }
  return f;
}

/** 方向性高斯采样，供 SlopeBlur / SlopeWarp 使用。 */
function slopeDirection(gx, gy, directionDeg) {
  const base = Math.atan2(gy, gx);
  const a = base + deg2rad(directionDeg);
  return [Math.cos(a), Math.sin(a)];
}

/** SlopeBlur：沿坡度方向进行不对称模糊。 */
export function slopeBlur(ctx) {
  const { size, params } = ctx;
  const guide = inOr(ctx, 0);
  const intensity = clamp01(NUM(params, 'Intensity', 0.25));
  const iterations = Math.max(1, NUM(params, 'Iterations', 1) | 0);
  const direction = NUM(params, 'Direction', 0);
  const asymmetry = clamp(NUM(params, 'Asymmetry', 1), -1, 1);
  const bell = ENUM(params, 'Window', 'Bell') === 'Bell';
  const maxPx = Math.max(1, Math.round(intensity * 0.08 * size));
  let cur = cloneField(guide);
  for (let it = 0; it < iterations; it++) {
    const out = createField(size, 'height');
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const [gx, gy] = gradientAt(cur.data, size, x, y);
        const [dx, dy] = slopeDirection(gx, gy, direction);
        let sum = 0, wsum = 0;
        for (let s = -maxPx; s <= maxPx; s++) {
          const t = s / maxPx;
          let w = bell ? Math.exp(-t * t * 3) : 1;
          w *= s > 0 ? 1 + asymmetry * 0.5 : 1 - asymmetry * 0.5;
          if (w <= 0) continue;
          const v = sampleBilinear(cur.data, size, x + dx * s, y + dy * s, 0);
          sum += v * w;
          wsum += w;
        }
        out.data[i] = wsum > 0 ? sum / wsum : cur.data[i];
      }
    }
    cur = out;
  }
  return cur;
}

/** SlopeWarp：沿坡度方向位移。 */
export function slopeWarp(ctx) {
  const { size, params } = ctx;
  const guide = inOr(ctx, 0);
  const intensity = clamp01(NUM(params, 'Intensity', 0.25));
  const iterations = Math.max(1, NUM(params, 'Iterations', 1) | 0);
  const direction = NUM(params, 'Direction', 0);
  const maxPx = intensity * 0.12 * size;
  let cur = cloneField(guide);
  for (let it = 0; it < iterations; it++) {
    const out = createField(size, 'height');
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const [gx, gy] = gradientAt(cur.data, size, x, y);
        const [dx, dy] = slopeDirection(gx, gy, direction);
        const amt = Math.min(1, Math.sqrt(gx * gx + gy * gy)) * maxPx;
        out.data[i] = sampleBilinear(cur.data, size, x + dx * amt, y + dy * amt, 0);
      }
    }
    cur = out;
  }
  return cur;
}

/* ================================================================== 沉积 / 沙丘 */

/** Sandstone：水平层理 + 起伏掩码 + 崩落碎屑。 */
export function sandstone(ctx) {
  const { size, params, seed } = ctx;
  const passes = clamp(NUM(params, 'Passes', 1) | 0, 1, 10);
  const iterations = clamp(NUM(params, 'Iterations', 10) | 0, 5, 30);
  const spacing = clamp(NUM(params, 'Spacing', 0.1), 0, 1);
  const intensity = clamp01(NUM(params, 'Intensity', 0.5));
  const convexity = clamp(NUM(params, 'Convexity', 0), -1, 1);
  const tilt = clamp01(NUM(params, 'Tilt', 0.5));
  const dir = NUM(params, 'Direction', 0);
  const chaos = clamp(NUM(params, 'Chaos', 0.15), 0.01, 0.4);
  const chipped = B(params, 'Chipped');
  const chipping = clamp(NUM(params, 'Chipping', 0.45), 0.1, 0.5);
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const grad = linearGradient(size, size * 0.5, size * 0.5, size, dir, EDGE_CLIP);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let base = fractalSum(perlin2, u * 5, v * 5, seed, 6, 2, 0.5, 'Standard') * 0.5 + 0.5;
      base += (grad[y * size + x] - 0.5) * tilt * 0.3;
      let h = base;
      // 层理量化：Iterations 控制层数，Intensity 控制台阶感。
      const step = 1 / iterations;
      const led = Math.abs(Math.floor(base / step + 0.5) * step);
      for (let p = 0; p < passes; p++) {
        const shake = (perlin2(u * 9 + p * 5, v * 9, seed + p * 7) * 0.5 + 0.5) * step * (spacing * 0.5);
        h = lerp(h, led + shake, intensity * (0.65 / (p + 1)));
      }
      const c = fractalSum(perlin2, u * 4 + 3, v * 4, seed + 5, 3, 2, 0.5, 'Standard') * 0.5 + 0.5;
      const convexMask = convexity >= 0 ? smoothstep(0.55, 0.8, c) : smoothstep(0.45, 0.2, c);
      h = lerp(h, h * (1 + convexity * 0.25), Math.abs(convexity) * 0.6 * convexMask);
      h += (value2(u * 18, v * 18, seed) - 0.5) * chaos;
      if (chipped) {
        const crack = Math.abs(fractalSum(perlin2, u * 8, v * 8, seed + 9, 4, 2, 0.5, 'Standard'));
        h -= Math.max(0, 1 - crack / chipping) * 0.08;
      }
      d[y * size + x] = clamp01(h);
    }
  }
  return f;
}

/** Sunlight：全年太阳光照积分（山体阴影的累积）。 */
export function sunlight(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const north = NUM(params, 'North', 0);
  const year = F2(params, 'Year', [0, 1]);
  const lat = clamp(NUM(params, 'Latitude', 60), -90, 90);
  const y0 = clamp01(year[0]);
  const y1 = clamp01(year[1]);
  const f = createField(size, 'mask');
  const samples = 16;
  const acc = new Float32Array(size * size);
  const maxEl = Math.max(5, 90 - Math.abs(lat));
  for (let s = 0; s < samples; s++) {
    const k = samples === 1 ? 0 : s / (samples - 1);
    const az = north + (y0 + (y1 - y0) * k) * 360;
    const el = maxEl * (0.35 + 0.65 * Math.sin(k * Math.PI));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        acc[y * size + x] += hillshadeAt(src.data, size, x, y, az, el, 5);
      }
    }
  }
  for (let i = 0; i < acc.length; i++) f.data[i] = clamp01(acc[i] / samples);
  return f;
}

/** DuneSea：方向性沙丘场。 */
export function duneSea(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Scale', 0.25), 0.1, 0.5);
  const type = ENUM(params, 'Dune Type', 'A');
  const chaos = ENUM(params, 'Chaos', 'None');
  const undulation = ENUM(params, 'Undulation', 'None');
  const direction = NUM(params, 'Direction', 0);
  const height = clamp(NUM(params, 'Height', 0.25), 0.01, 1);
  const softness = clamp(NUM(params, 'Softness', 10), 5, 50);
  const sharpness = clamp01(NUM(params, 'Sharpness', 0.25));
  const chaosK = { None: 0, Low: 0.08, Medium: 0.16, High: 0.26 }[chaos] || 0;
  const undK = { None: 0, Low: 0.1, Medium: 0.2, High: 0.32 }[undulation] || 0;
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const freq = 8 + scale * 36;
  const asym = { A: 1, B: 0.7, C: 1.4, D: 0.45 }[type] || 1;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const [rx, ry] = rot(u, v, direction);
      const warpNoise = fractalSum(perlin2, rx * 3, ry * 3, seed, 4, 2, 0.5, 'Standard') * chaosK;
      const phase = rx * freq * asym + warpNoise * 8;
      let dune = Math.sin(phase) * 0.5 + 0.5;
      dune = Math.pow(dune, 1 + sharpness * 3);
      const und = fractalSum(perlin2, u * 4, v * 4, seed + 13, 4, 2, 0.5, 'Standard') * 0.5 + 0.5;
      let h = (dune * 0.75 + und * 0.25) * height;
      h += undK * und * 0.25;
      d[y * size + x] = clamp01(h);
    }
  }
  return gaussianBlur(f, Math.max(0, Math.round(softness / 10)));
}

/** Sand：细颗粒方向性噪声。 */
export function sand(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp01(NUM(params, 'Scale', 0.5));
  const direction = NUM(params, 'Direction', 0);
  const chaos = clamp(NUM(params, 'Chaos', 0.5), 0.1, 1);
  const softness = clamp01(NUM(params, 'Softness', 0.5));
  const height = clamp(NUM(params, 'Height', 0.25), 0.1, 1);
  const warp = B(params, 'Warp by Terrain');
  const src = inOr(ctx, 0, 0.5);
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const freq = 12 + scale * 40;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const [rx, ry] = rot(u, v, direction);
      const grain = fractalSum(perlin2, rx * freq, ry * freq * 0.6, seed, 5, 2.2, 0.55, 'Standard') * chaos;
      let h = 0.5 + grain * height * 0.5;
      if (warp) {
        const [gx, gy] = gradientAt(src.data, size, x, y);
        h += (gx + gy) * 0.02;
      }
      d[y * size + x] = clamp01(h);
    }
  }
  return gaussianBlur(f, Math.round(softness * 2));
}

/** WaveShine：水面波光/焦散遮罩。 */
export function waveShine(ctx) {
  const { size, params, seed } = ctx;
  const frame = NUM(params, 'Frame', 0);
  const octaves = clamp(NUM(params, 'Octaves', 4) | 0, 1, 5);
  const speed = NUM(params, 'Animation Speed', 1);
  const sizeParam = clamp(NUM(params, 'Size', 30), 10, 50);
  const amplitude = clamp01(NUM(params, 'Amplitude', 0.5));
  const direction = NUM(params, 'Direction', 0);
  const drift = NUM(params, 'Speed', 0.1) * frame;
  const intensity = clamp01(NUM(params, 'Intensity', 0));
  const contrast = clamp(NUM(params, 'Contrast', 2), 0, 6);
  const brightness = clamp(NUM(params, 'Brightness', 1), 0, 5);
  const sunAz = NUM(params, 'Sun Azimuth', 315);
  const sunEl = NUM(params, 'Sun Elevation', 30);
  const f = createField(size, 'mask');
  const d = f.data;
  const inv = 1 / size;
  const freq = sizeParam / 10;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const [rx, ry] = rot(u + drift * 0.003, v, direction);
      let sum = 0;
      for (let o = 0; o < octaves; o++) {
        const fr = freq * Math.pow(2, o);
        sum += Math.abs(perlin2(rx * fr + frame * speed * 0.02, ry * fr, seed + o * 97));
      }
      let h = sum / octaves;
      h = Math.pow(clamp01(h * (1 + amplitude)), contrast);
      const glint = hillshadeAt(f.data, size, x, y, sunAz, sunEl, 2);
      d[y * size + x] = clamp01((h * brightness * 0.6 + glint * 0.4) * (0.4 + intensity));
    }
  }
  return f;
}

/** Stones：高度场上散布的石块。 */
export function stones(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const scale = clamp01(NUM(params, 'Scale', 0.6));
  const height = clamp(NUM(params, 'Height', 1), 0.0001, 3);
  const density = clamp(NUM(params, 'Density', 0.5), 0.0001, 1);
  const f = createField(size, 'height');
  f.data.set(src.data);
  const freq = 4 + scale * 24;
  const radius = 0.22 + scale * 0.35;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const w = worley2(u * freq, v * freq, seed, { jitter: 0.9, density });
      if (w.f1 < radius) {
        const bump = Math.pow(1 - w.f1 / radius, 2) * height * 0.25;
        f.data[y * size + x] = clamp01(f.data[y * size + x] + bump);
      }
    }
  }
  return f;
}

/** HydroFix：洼地填充 + 下切修正。 */
export function hydroFix(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const down = clamp01(NUM(params, 'Downcutting', 0.1));
  const filled = fillPits(src.data, size, 48);
  const { acc } = flowAccumulation(filled, size);
  let maxAcc = 1;
  for (let i = 0; i < acc.length; i++) if (acc[i] > maxAcc) maxAcc = acc[i];
  const f = createField(size, 'height');
  for (let i = 0; i < filled.length; i++) {
    const channel = Math.pow(acc[i] / maxAcc, 0.35);
    f.data[i] = clamp01(filled[i] - down * channel * 0.12);
  }
  return f;
}

/* ================================================================== 颜色 / 纹理 */

/** SuperColor：基于高度 + 纹理 + 流向的程序化配色。 */
export function superColor(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const texture = ENUM(params, 'Texture', 'None');
  const strength = clamp01(NUM(params, 'Strength', 0.5));
  const warp = clamp01(NUM(params, 'Warp', 0));
  const library = ENUM(params, 'Library', 'Rock');
  const range = F2(params, 'Range', [0, 1]);
  const bias = clamp(NUM(params, 'Bias', 0), -1, 1);
  const reverse = B(params, 'Reverse');
  const process = ENUM(params, 'Process', 'Basic');
  const out = colorField(size);
  const inv = 1 / size;
  const stops = PALETTES[library] || PALETTES.Rock;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const i = y * size + x;
      let h = clamp01(src.data[i]);
      h = clamp01(lerp(range[0], range[1], h) + bias * 0.3);
      if (reverse) h = 1 - h;
      let t = h;
      if (warp > 0) t += perlin2(u * 5, v * 5, seed) * warp * 0.12;
      if (process === 'Erosion') t = Math.pow(clamp01(t), 0.8);
      if (texture !== 'None' && strength > 0) {
        let tex = 0;
        if (texture === 'Texture') tex = fractalSum(perlin2, u * 30, v * 30, seed, 3, 2, 0.5, 'Standard');
        else if (texture === 'Peaks') tex = ridged2(u * 12, v * 12, seed);
        else tex = (value2(u * 16, v * 16, seed) - 0.5) * 2;
        t += tex * strength * 0.12;
      }
      const c = sampleStops(stops, clamp01(t));
      writeRGB(out, i, c[0], c[1], c[2]);
    }
  }
  return out;
}

/** DriftNoise：受风向驱动的双尺度漂移噪声。 */
export function driftNoise(ctx) {
  const { size, params, seed } = ctx;
  const passes = clamp(NUM(params, 'Passes', 2) | 0, 2, 10);
  const chaos = clamp01(NUM(params, 'Chaos', 0.25));
  const scaleL = clamp(NUM(params, 'Scale Large', 0.4), 0.05, 1);
  const scaleS = clamp(NUM(params, 'Scale Small', 0.4), 0.05, 1);
  const turbL = clamp(NUM(params, 'Turbulence Large', 0.4), 0.15, 1);
  const turbS = clamp(NUM(params, 'Turbulence Small', 0.4), 0.1, 1);
  const windL = NUM(params, 'Wind Direction Large', 0);
  const windS = NUM(params, 'Wind Direction Small', 0);
  const overlap = B(params, 'Overlap Shapes');
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const [lx, ly] = rot(u, v, windL);
      const [sx, sy] = rot(u, v, windS);
      const large = fractalSum(perlin2, lx * (2 + scaleL * 6), ly * (1 + scaleL * 3), seed, 4, 2, 0.5, 'Standard');
      const small = fractalSum(perlin2, sx * (8 + scaleS * 20), sy * (2 + scaleS * 6), seed + 77, 3, 2, 0.55, 'Standard');
      let h = (large * turbL + small * turbS * chaos) * 0.5 + 0.5;
      for (let p = 1; p < passes; p++) {
        const n = fractalSum(perlin2, u * (4 + p * 3), v * (2 + p * 2), seed + p * 17, 3, 2, 0.5, 'Standard');
        h += (n * chaos * 0.12) * (overlap ? 1 : 1 / (p + 1));
      }
      d[y * size + x] = clamp01(h);
    }
  }
  return f;
}

/** GroundTexture：岩石/粗糙地表纹理。 */
export function groundTexture(ctx) {
  const { size, params, seed } = ctx;
  const method = ENUM(params, 'Method', 'Harsh');
  const strength = clamp01(NUM(params, 'Strength', 0.25));
  const coverage = clamp01(NUM(params, 'Coverage', 0.33));
  const density = clamp(NUM(params, 'Density', 0), -1, 1);
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const oct = method === 'Harsh' ? 5 : method === 'Rocky' ? 4 : 3;
  const freq = method === 'Rough' ? 18 : method === 'Rocky' ? 24 : 40;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let n = fractalSum(perlin2, u * freq, v * freq, seed, oct, 2.1, 0.55, 'Standard') * 0.5 + 0.5;
      n = Math.pow(clamp01(n + density * 0.15), method === 'Harsh' ? 0.6 : 1);
      const mask = smoothstep(1 - coverage, 1, n);
      d[y * size + x] = clamp01(mask * strength + n * (1 - strength) * 0.35);
    }
  }
  return f;
}

/* ================================================================== 散布 / 地形 */

/** PointCloud：Gaea 的 3D 导出节点；在 2D 场里以高度直通近似。 */
export function pointCloud(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Trees：按高度/坡度/水体筛出树木分布遮罩。 */
export function trees(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const water = ctx.input(1);
  const debris = ctx.input(2);
  const patches = clamp(NUM(params, 'Patches', 0.4), 0.0001, 1);
  const spread = clamp01(NUM(params, 'Spread', 0));
  const chaos = clamp01(NUM(params, 'Chaos', 0.5));
  const slopePair = F2(params, 'Slope', [0, 0.5]);
  const slopeFall = clamp(NUM(params, 'Slope Falloff', 10), 0, 90);
  const altPair = F2(params, 'Altitude', [0.05, 0.9]);
  const altFall = clamp(NUM(params, 'Altitude Falloff', 1), 0, 1);
  const snowline = clamp01(NUM(params, 'Snowline', 0.1));
  const blurEdges = clamp(NUM(params, 'Blur Edges', 0), 0, 1);
  const f = createField(size, 'mask');
  const slope = slopeMagnitude(src);
  const sMin = slopePair[0] > 0 ? slopePair[0] / 90 : 0.05;
  const sMax = slopePair[1] > 0 ? slopePair[1] / 90 : 1;
  const aMin = Math.min(altPair[0], altPair[1]);
  const aMax = Math.max(altPair[0], altPair[1]) || 0.9;
  for (let i = 0; i < f.data.length; i++) {
    const x = i % size, y = (i / size) | 0;
    let m = 1;
    if (water) m *= smoothstep(0.05, 0.15, toScalar(water).data[i]);
    if (debris) m *= 1 - clamp01(toScalar(debris).data[i]);
    m *= smoothstep(sMax + 0.12, sMin + slopeFall * 0.001, slope.data[i]);
    m *= smoothstep(aMin - 0.06, aMin + 0.06, src.data[i]);
    m *= smoothstep(aMax + 0.06, aMax - 0.06, src.data[i]);
    if (snowline > 0) m *= 1 - smoothstep(snowline, snowline + 0.08, src.data[i]);
    const p = perlin2((x / size) * (4 + spread * 20), (y / size) * (4 + spread * 20), seed) * 0.5 + 0.5;
    m *= smoothstep(1 - patches - chaos * 0.1, 1.02 - patches - chaos * 0.1, p);
    m *= 1 + altFall * (src.data[i] - 0.5) * 0.2;
    f.data[i] = clamp01(m);
  }
  if (blurEdges > 0) {
    const b = gaussianBlur(f, Math.max(1, Math.round(blurEdges * 6)));
    f.data.set(b.data);
  }
  return f;
}

/** Rockscape：Voronoi 岩块 + 裂隙 + 粗糙度。 */
export function rockscape(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Size', 0.5), 0, 1);
  const erosion = clamp(NUM(params, 'Erosion', 0.5), 0, 1);
  const breakage = clamp(NUM(params, 'Breakage', 0.25), 0.01, 1);
  const roughness = clamp(NUM(params, 'Roughness', 0.7), 0, 1);
  const jitter = clamp(NUM(params, 'Jitter', 0.5), 0, 1);
  const clusters = ENUM(params, 'Clusters', 'Off');
  const relief = ENUM(params, 'Relief', 'Sharp');
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const freq = (3 + scale * 9) * (clusters === 'Small' ? 1.6 : clusters === 'Large' ? 0.6 : 1);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const w = worley2(u * freq, v * freq, seedS, { jitter: 0.6 + jitter * 0.4, density: 1 - breakage * 0.5 });
      const idH = ((w.id >>> 4) & 0xfff) / 4095;
      const edge = w.f2 - w.f1;
      let h;
      if (relief === 'Sharp') h = Math.pow(smoothstep(0, 0.18, edge), 0.55);
      else if (relief === 'Soft') h = smoothstep(0, 0.38, edge);
      else h = (0.45 + idH * 0.55) * smoothstep(0, 0.22, edge);
      if (clusters === 'Shattered') h *= Math.pow(smoothstep(0.05, 0.3, edge), 0.5);
      const grain = fractalSum(perlin2, u * 18, v * 18, seedS + 9, 4, 2, 0.55, 'Standard') * 0.5 + 0.5;
      h = lerp(h, grain, roughness * 0.4);
      d[y * size + x] = clamp01(h * (1 - erosion * 0.2));
    }
  }
  return f;
}

/** CraterField：规律分布的陨石坑（坑底 + 隆起坑缘）。 */
export function craterField(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Scale', 1), 0.0001, 6);
  const depth = clamp(NUM(params, 'Depth', 0.25), 0, 1);
  const density = clamp(NUM(params, 'Density', 0.5), 0.0001, 1);
  const ox = clamp(NUM(params, 'X', 0.5), 0, 1);
  const oy = clamp(NUM(params, 'Y', 0.5), 0, 1);
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  const cells = Math.max(2, Math.round(2 + scale * 4));
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let h = 0;
      for (let cy = -1; cy <= 1; cy++) {
        for (let cx = -1; cx <= 1; cx++) {
          const gc = Math.floor(u * cells) + cx;
          const gr = Math.floor(v * cells) + cy;
          const px = (gc + 0.15 + hash2f(gc * 7 + 3, gr * 5 + 11, seed) * 0.7) / cells;
          const py = (gr + 0.15 + hash2f(gc * 13 + 7, gr * 3 + 2, seed + 1) * 0.7) / cells;
          const r = (0.08 + ((mix32(gc * 131 + gr * 71 + seed) >>> 8) & 0xff) / 255 * 0.18) * density * 2;
          const dist = Math.sqrt((u - px) * (u - px) + (v - py) * (v - py));
          if (dist < r) {
            const t = dist / r;
            const bowl = -(1 - t * t) * depth;
            const rim = Math.exp(-Math.pow((t - 0.92) / 0.08, 2)) * depth * 0.45;
            h += bowl + rim;
          }
        }
      }
      // 以 X/Y 为中心叠加整体起伏，避免完全扁平。
      const base = 0.55 + fractalSum(perlin2, u * 4, v * 4, seed + 4, 4, 2, 0.5, 'Standard') * 0.12;
      d[y * size + x] = clamp01(base + h + (ox - 0.5) * (u - 0.5) * 0.1 + (oy - 0.5) * (v - 0.5) * 0.1);
    }
  }
  return f;
}

/** Gabor：Gabor 纹理调制输入高度。 */
export function gabor(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const sizeParam = clamp(NUM(params, 'Size', 0.5), 0, 1);
  const entropy = clamp01(NUM(params, 'Entropy', 0.5));
  const anisotropy = clamp01(NUM(params, 'Anisotropy', 1));
  const azimuth = NUM(params, 'Azimuth', 0);
  const gain = clamp(NUM(params, 'Gain', 0.5), 0.0001, 1);
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'height');
  const inv = 1 / size;
  const frequency = 3 + (1 - sizeParam) * 18;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const [rx, ry] = rot(u, v, azimuth);
      const k = frequency * (0.4 + anisotropy * 1.2);
      const g = Math.cos(rx * k * Math.PI * 2 + perlin2(u * 3, v * 3, seedS) * entropy * 6)
        * Math.exp(-(rx * rx + (ry * (0.2 + anisotropy)) * (ry * (0.2 + anisotropy))) * 10);
      f.data[y * size + x] = clamp01(src.data[y * size + x] + g * gain * 0.35);
    }
  }
  return f;
}

/** Slump：滑坡/崩塌地形。 */
export function slump(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Scale', 0.5), 0, 1);
  const style = ENUM(params, 'Style', 'A');
  const f = createField(size, 'height');
  const d = f.data;
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let wu = u, wv = v;
      const warpK = 0.15 + scale * 0.2;
      wu += perlin2(u * 3, v * 3, seed) * warpK;
      wv += perlin2(u * 3 + 4, v * 3, seed) * warpK;
      let n = fractalSum(perlin2, wu * (2 + scale * 4), wv * (2 + scale * 4), seed, 5, 2, 0.5, 'Standard') * 0.5 + 0.5;
      if (style === 'A') {
        const step = 0.08;
        n = Math.floor(n / step) * step + (n % step) * 0.3;
      } else if (style === 'B') {
        n = Math.pow(n, 1.6);
      } else if (style === 'C') {
        n = Math.pow(n, 0.7);
      } else {
        n = smoothstep(0.25, 0.75, n);
      }
      d[y * size + x] = clamp01(n);
    }
  }
  const h = thermalPass(d, size, 6, 0.02, 0, 0, 0);
  d.set(h);
  return f;
}

/** ThermalShaper：按 Shape/Scale 参数化的热力整形。 */
export function thermalShaper(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const influence = clamp01(NUM(params, 'Influence', 0.5));
  const shape = clamp(NUM(params, 'Shape', -0.25), -1, 1);
  const scale = clamp(NUM(params, 'Scale', 20), 1, 250);
  const preserve = clamp01(NUM(params, 'Microdetail Preservation', 0.5));
  const steps = Math.max(1, Math.round(3 + influence * 9));
  const talus = Math.max(0.002, (1 - influence) * 0.18 + 0.02);
  const h = thermalPass(src.data, size, steps, talus, Math.abs(shape) * 0.5, shape * 90, 0);
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const shaped = shape < 0 ? Math.pow(clamp01(h[i]), 0.8 + scale * 0.002) : clamp01(h[i]) * 1.08;
    out[i] = clamp01(lerp(h[i], shaped, influence) + (src.data[i] - h[i]) * preserve * 0.25);
  }
  return outField(size, out);
}

/** Mesher：3D 网格导出节点；2D 场中直通。 */
export function mesher(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Thermal2：带各向异性的热力侵蚀。 */
export function thermal2(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const mask = ctx.input(1);
  const duration = clamp(NUM(params, 'Duration', 1), 0, 30);
  const strength = clamp(NUM(params, 'Strength', 0.3), 0, 1);
  const anisotropy = clamp(NUM(params, 'Anisotropy', 0), 0, 1);
  const angle = NUM(params, 'Angle', 0);
  const removal = clamp01(NUM(params, 'Sediment Removal', 1));
  const feature = clamp(NUM(params, 'Feature Scale', 0.5), 0.1, 1);
  const steps = Math.max(1, Math.round(duration));
  const talus = Math.max(0.001, (1 - strength) * 0.18 * feature);
  let h = thermalPass(src.data, size, steps, talus, anisotropy, angle, removal * 0.6);
  if (mask) {
    const m = toScalar(mask).data;
    for (let i = 0; i < h.length; i++) h[i] = lerp(src.data[i], h[i], clamp01(m[i]));
  }
  return outField(size, h);
}

/** MathX：逐像素表达式求值（安全地暴露 a/b/u/v/x/y）。 */
export function mathX(ctx) {
  const { size, params } = ctx;
  const aIn = inOr(ctx, 0, 0.5);
  const bIn = inOr(ctx, 1, 0.5);
  const expr = String(P(params, 'Expression', 'a'));
  const normalized = B(params, 'Normalized Coordinates', false);
  let fn;
  try {
    // 仅暴露命名参数；表达式非法时回退为直通。
    fn = new Function('a', 'b', 'u', 'v', 'x', 'y', `"use strict"; return (${expr});`);
  } catch {
    return cloneField(aIn);
  }
  const f = createField(size, 'height');
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      let r;
      try { r = Number(fn(aIn.data[i], bIn.data[i], u, v, normalized ? u : x, normalized ? v : y)); } catch { r = aIn.data[i]; }
      if (!Number.isFinite(r)) r = aIn.data[i];
      f.data[i] = clamp01(r);
    }
  }
  return f;
}

/** Scree：在陡坡下缘堆积碎石。 */
export function scree(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const maskIn = ctx.input(1);
  const scale = clamp(NUM(params, 'Scale', 0.5), 0.05, 1);
  const density = clamp(NUM(params, 'Density', 0.5), 0, 1);
  const height = clamp(NUM(params, 'Height', 0.5), 0, 1);
  const f = createField(size, 'height');
  f.data.set(src.data);
  const slope = slopeMagnitude(src);
  const inv = 1 / size;
  const freq = 8 + scale * 30;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const sl = smoothstep(0.35, 0.85, slope.data[i]);
      const w = worley2((x / size) * freq, v * freq, seed, { jitter: 0.9, density });
      const pile = Math.max(0, 1 - w.f1 * 3) * sl;
      let add = pile * height * 0.12;
      if (maskIn) add *= clamp01(toScalar(maskIn).data[i]);
      f.data[i] = clamp01(f.data[i] + add);
    }
  }
  return f;
}

/** Reseed：Gaea 上层重播种节点；此处在场级别生成新的噪声底。 */
export function reseed(ctx) {
  const { size, seed } = ctx;
  const f = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      f.data[y * size + x] = clamp01(fractalSum(perlin2, u * 5, v * 5, seed, 5, 2, 0.5, 'Standard') * 0.5 + 0.5);
    }
  }
  return f;
}

/** Match：把输入直方图匹配到参考输入。 */
export function match(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const ref = inOr(ctx, 1, 0.5);
  const mode = ENUM(params, 'Mode', 'Height');
  const f = createField(size, 'height');
  if (mode === 'Height') {
    let sMin = 1, sMax = 0, rMin = 1, rMax = 0;
    for (let i = 0; i < src.data.length; i++) {
      sMin = Math.min(sMin, src.data[i]); sMax = Math.max(sMax, src.data[i]);
      rMin = Math.min(rMin, ref.data[i]); rMax = Math.max(rMax, ref.data[i]);
    }
    for (let i = 0; i < f.data.length; i++) {
      const t = safeDiv(src.data[i] - sMin, sMax - sMin);
      f.data[i] = clamp01(lerp(rMin, rMax, t));
    }
    return f;
  }
  // Histogram：用 64 桶 CDF 做秩匹配近似。
  const bins = 64;
  const cdf = (arr) => {
    const hist = new Float32Array(bins);
    for (let i = 0; i < arr.length; i++) hist[Math.min(bins - 1, Math.max(0, Math.floor(arr[i] * bins)))]++;
    let run = 0;
    for (let i = 0; i < bins; i++) { run += hist[i]; hist[i] = run / arr.length; }
    return hist;
  };
  const sc = cdf(src.data), rc = cdf(ref.data);
  for (let i = 0; i < f.data.length; i++) {
    const c = sc[Math.min(bins - 1, Math.floor(clamp01(src.data[i]) * bins))];
    let b = 0;
    while (b < bins - 1 && rc[b] < c) b++;
    f.data[i] = (b + 0.5) / bins;
  }
  return f;
}

/** Normals：把高度场转为法线颜色。 */
export function normals(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const type = ENUM(params, 'Type', 'Tangent');
  const detail = clamp(NUM(params, 'Detail Size', 0.5), 0, 1);
  const strength = type === 'Object' ? 0.2 : 0.5;
  const out = colorField(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const [gx, gy] = gradientAt(src.data, size, x, y);
      const nx = -gx * strength * (0.04 + detail * 0.04), ny = -gy * strength * (0.04 + detail * 0.04), nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      writeRGB(out, i, nx / len * 0.5 + 0.5, ny / len * 0.5 + 0.5, nz / len);
    }
  }
  return out;
}

/** Unity：引擎导出节点；2D 场中直通。 */
export function unity(ctx) {
  return cloneFileFromInput(ctx);
}

function cloneFileFromInput(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Pattern：线/等距刻痕/点阵图案。 */
export function patternNode(ctx) {
  const { size, params } = ctx;
  const type = ENUM(params, 'Type', 'Lines');
  const sizeParam = clamp01(NUM(params, 'Size', 0.2));
  const dotSize = clamp01(NUM(params, 'Dot Size', 1));
  const spacing = clamp(NUM(params, 'Spacing', 0.1), 0, 1);
  const steps = clamp(NUM(params, 'Steps', 256) | 0, 10, 4096);
  const direction = NUM(params, 'Direction', 0);
  const f = createField(size, 'mask');
  const inv = 1 / size;
  const freq = Math.max(1, Math.round(2 + sizeParam * 30 + spacing * 10));
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const [rx, ry] = rot(u, v, direction * 3.6);
      let val = 0;
      if (type === 'Lines') {
        val = Math.abs((ry * freq) % 1 - 0.5) * 2;
      } else if (type === 'Engraving') {
        val = Math.pow(Math.abs((ry * freq) % 1 - 0.5) * 2, 1.5);
      } else if (type === 'Grid') {
        const dx = Math.abs((rx * freq) % 1 - 0.5) * 2;
        const dy = Math.abs((ry * freq) % 1 - 0.5) * 2;
        val = Math.max(dx, dy);
      } else {
        const dx = Math.abs((rx * freq) % 1 - 0.5) * 2;
        const dy = Math.abs((ry * freq) % 1 - 0.5) * 2;
        val = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(2);
      }
      const on = 1 - smoothstep(0, Math.max(0.01, dotSize * 0.5), val);
      // Steps / Pixel Size 影响锯齿，本实现以 512 内部精度近似。
      const aa = steps >= 1024 ? 0.85 : 0.65;
      f.data[y * size + x] = clamp01(on * aa + 0.15 * (1 - aa));
    }
  }
  return f;
}

/** Transform3D：高度场的平移/缩放/旋转。 */
export function transform3D(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const offX = NUM(params, 'Offset X', 0);
  const offY = NUM(params, 'Offset Y', 0);
  const yaw = NUM(params, 'Yaw', 0);
  const pitch = NUM(params, 'Pitch', 0);
  const scale = Math.max(0.001, NUM(params, 'Scale', 1));
  const f = createField(size, 'height');
  const inv = 1 / size;
  const rotateDeg = yaw;
  const [ca, sa] = [Math.cos(deg2rad(rotateDeg)), Math.sin(deg2rad(rotateDeg))];
  const lift = NUM(params, 'Offset Z', 0) + pitch * 0.002;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv - 0.5 - offX;
      const v = (y + 0.5) * inv - 0.5 - offY;
      const rx = (u * ca - v * sa) / scale;
      const ry = (u * sa + v * ca) / scale;
      f.data[y * size + x] = clamp01(sampleBilinear(src.data, size, (rx + 0.5) * size, (ry + 0.5) * size, 0) + lift * 0.1);
    }
  }
  return f;
}

/** Rugged：粗犷、脊状的分形起伏。 */
export function rugged(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Scale', 0.5), 0.05, 1);
  const style = ENUM(params, 'Style', 'Basic');
  const f = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let n = fractalSum(perlin2, u * (4 + scale * 10), v * (4 + scale * 10), seed, 6, 2, 0.55, 'Ridged');
      if (style === 'Heavy') n = Math.pow(clamp01(n), 0.7);
      if (style === 'Spiky') n = Math.abs(n * 2 - 1);
      n = clamp01(n);
      f.data[y * size + x] = n;
    }
  }
  return f;
}

/** Tint：两端颜色渐变着色。 */
export function tint(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const start = colorParam(P(params, 'Start', null), [0.08, 0.1, 0.14, 1]);
  const end = colorParam(P(params, 'End', null), [0.92, 0.86, 0.72, 1]);
  // Gaea 的 Hue/Saturation/Lightness 都是增量：0 表示不改变。
  const hue = NUM(params, 'Hue', 0);
  const sat = NUM(params, 'Saturation', 0);
  const light = NUM(params, 'Lightness', 0);
  const enhance = ENUM(params, 'Enhance', 'None');
  const out = colorField(size);
  for (let i = 0; i < out.data.length; i++) {
    let t = clamp01(src.data[i]);
    if (enhance === 'Autolevel') t = clamp01(t * 1.15);
    const c = [lerp(start[0], end[0], t), lerp(start[1], end[1], t), lerp(start[2], end[2], t)];
    writeRGB(out, i, c[0], c[1], c[2]);
  }
  const tinted = applyHSL(out.data, size, 4, hue, sat, light);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i * 4] = tinted[i * 4];
    out.data[i * 4 + 1] = tinted[i * 4 + 1];
    out.data[i * 4 + 2] = tinted[i * 4 + 2];
  }
  return out;
}

/** Var：Gaea 的变量节点；可带表达式，默认直通。 */
export function varNode(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const expr = String(P(params, 'Expression', '')).trim();
  if (!expr) return cloneField(src);
  const f = createField(size, 'height');
  let fn;
  try {
    fn = new Function('a', 'u', 'v', `"use strict"; return (${expr});`);
  } catch { return cloneField(src); }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let r;
      try { r = Number(fn(src.data[i], x / size, y / size)); } catch { r = src.data[i]; }
      f.data[i] = clamp01(Number.isFinite(r) ? r : src.data[i]);
    }
  }
  return f;
}

/** Volcano：锥形火山 + 火山口。 */
export function volcano(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Scale', 1), 0.0001, 4);
  const height = clamp(NUM(params, 'Height', 1), 0.0001, 1);
  const mouth = clamp01(NUM(params, 'Mouth', 0.15));
  const bulk = clamp(NUM(params, 'Bulk', -0.2), -1, 1);
  const surface = ENUM(params, 'Surface', 'Smooth');
  const cx = clamp01(NUM(params, 'X', 0.5));
  const cy = clamp01(NUM(params, 'Y', 0.5));
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const r = Math.sqrt((u - cx) * (u - cx) + (v - cy) * (v - cy)) / (0.12 + scale * 0.35);
      const cone = Math.max(0, 1 - r);
      let h = Math.pow(cone, 1.15 - bulk * 0.5) * height;
      const cpos = Math.max(0, 1 - r / (0.12 + mouth * 0.4));
      h -= Math.pow(cpos, 2.2) * height * (0.3 + mouth);
      const chaos = surface === 'Eroded' ? 0.22 : 0.06;
      h += fractalSum(perlin2, u * 12, v * 12, seedS, 4, 2, 0.5, 'Standard') * chaos * 0.25 * cone;
      f.data[y * size + x] = clamp01(h);
    }
  }
  return f;
}

/* ================================================================== 侵蚀 / 生成 */

/** Texturizer：程序化表面纹理遮罩。 */
export function texturizer(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const style = ENUM(params, 'Style', 'A');
  const factor = clamp01(NUM(params, 'Factor', 0.5));
  const secondary = clamp01(NUM(params, 'Secondary', 0));
  const flows = clamp01(NUM(params, 'Flows', 0.33));
  const slopeK = clamp01(NUM(params, 'Slope', 0.33));
  const soil = clamp01(NUM(params, 'Soil', 0.33));
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'mask');
  const slope = slopeMagnitude(src);
  const inv = 1 / size;
  const freq = 10 + factor * 50;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const i = y * size + x;
      let n;
      if (style === 'A' || style === 'E') n = Math.pow(clamp01(fractalSum(perlin2, u * freq, v * freq, seedS, 4, 2.2, 0.5, 'Standard') * 0.5 + 0.5), 0.7);
      else if (style === 'B') n = value2(u * freq * 1.5, v * freq * 1.5, seedS);
      else n = fractalSum(perlin2, u * freq, v * freq, seedS, 3, 2, 0.5, 'Ridged');
      const slopeMask = slope.data[i] * slopeK * 2;
      const soilMask = (1 - clamp01(src.data[i])) * soil * 2;
      f.data[i] = clamp01(n * factor * (0.4 + slopeMask * 0.3 + soilMask * 0.3) + secondary * 0.2 + flows * 0.1);
    }
  }
  return f;
}

/** TextureBaker：把高度烘焙为纹理；2D 场中直通。 */
export function textureBaker(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Crumble：崩解/碎屑化，热力 + 裂缝。 */
export function crumble(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const maskIn = ctx.input(1);
  const duration = clamp01(NUM(params, 'Duration', 0.25));
  const strength = clamp01(NUM(params, 'Strength', 0.5));
  const coverage = clamp01(NUM(params, 'Coverage', 0.75));
  const downcutting = clamp01(NUM(params, 'Downcutting', 0));
  const depth = clamp01(NUM(params, 'Depth', 0.2));
  const f = createField(size, 'height');
  const steps = Math.max(1, Math.round(1 + duration * 12));
  const h = thermalPass(src.data, size, steps, Math.max(0.002, (1 - strength) * 0.15), 0.2, 30, 0.2);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const crack = Math.abs(fractalSum(perlin2, u_(x, size, 10), v * 10, seed, 4, 2, 0.5, 'Standard'));
      const crumble = Math.max(0, 1 - crack / (0.08 + coverage * 0.12)) * strength;
      let hv = h[i] - crumble * depth * 0.12 - downcutting * Math.pow(crumble, 0.5) * 0.05;
      if (maskIn) hv = lerp(src.data[i], hv, clamp01(toScalar(maskIn).data[i]));
      f.data[i] = clamp01(hv);
    }
  }
  return f;
}

function u_(x, size, scale) { return ((x + 0.5) / size) * scale; }

/** Meshify：网格导出节点；2D 场中直通。 */
export function meshify(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Uplift：抬升/隆起作用。 */
export function uplift(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Scale', 0.5), 0.05, 1);
  const height = clamp(NUM(params, 'Height', 0.5), 0.05, 2);
  const direction = NUM(params, 'Direction', 0);
  const f = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const [rx, ry] = rot(u, v, direction);
      const ridge = fractalSum(perlin2, rx * (3 + scale * 7), ry * (2 + scale * 4), seed, 5, 2, 0.5, 'Ridged');
      const center = Math.exp(-((u - 0.5) * (u - 0.5) + (v - 0.5) * (v - 0.5)) / 0.18);
      f.data[y * size + x] = clamp01(0.5 + (ridge - 0.5) * height * center);
    }
  }
  return f;
}

/** Synth：由采样点插值出的分形合成场。 */
export function synth(ctx) {
  const { size, params, seed } = ctx;
  // Samples 是 Enum（_8.._2048），去掉下划线后转成采样点数。
  const sampleKey = ENUM(params, 'Samples', '_128');
  const samples = clamp(Number(String(sampleKey).replace('_', '')) || 128, 8, 2048);
  const f = createField(size, 'height');
  const inv = 1 / size;
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const x = hash2f(i * 3 + 1, i * 5 + 2, seed) * size;
    const y = hash2f(i * 7 + 3, i * 11 + 4, seed + 1) * size;
    const h = hash2f(i * 13 + 5, i * 17 + 6, seed + 2);
    pts.push([x, y, h]);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, wsum = 0;
      for (let p = 0; p < pts.length; p++) {
        const d = (x - pts[p][0]) * (x - pts[p][0]) + (y - pts[p][1]) * (y - pts[p][1]);
        const w = 1 / (1 + d * 0.002);
        sum += pts[p][2] * w;
        wsum += w;
      }
      let h = sum / (wsum || 1);
      h += fractalSum(perlin2, (x * inv) * 8, (y * inv) * 8, seed, 3, 2, 0.5, 'Standard') * 0.15;
      f.data[y * size + x] = clamp01(h);
    }
  }
  return f;
}

/** MacroPort：宏端口直通。 */
export function macroPort(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Wizard：预设流程（分形底 + 热力侵蚀 + 河道下切）。 */
export function wizard(ctx) {
  const { size, params, seed } = ctx;
  const src = ctx.input(0);
  const f = createField(size, 'height');
  if (src) f.data.set(toScalar(src).data);
  else {
    const inv = 1 / size;
    for (let y = 0; y < size; y++) {
      const v = (y + 0.5) * inv;
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) * inv;
        f.data[y * size + x] = clamp01(fractalSum(perlin2, u * 5, v * 5, seed, 6, 2, 0.5, 'Standard') * 0.5 + 0.5);
      }
    }
  }
  const eroded = thermalPass(f.data, size, 8, 0.015, 0, 0, 0);
  const { acc } = flowAccumulation(eroded, size);
  let maxAcc = 1;
  for (let i = 0; i < acc.length; i++) maxAcc = Math.max(maxAcc, acc[i]);
  for (let i = 0; i < f.data.length; i++) {
    f.data[i] = clamp01(eroded[i] - Math.pow(acc[i] / maxAcc, 0.4) * 0.08);
  }
  return f;
}

/** Noise：Gaea 基础噪声发生器。 */
export function noiseNode(ctx) {
  const { size, params, seed } = ctx;
  const type = ENUM(params, 'Noise Type', 'Perlin');
  const height = clamp01(NUM(params, 'Height', 1));
  const density = clamp01(NUM(params, 'Density', 0.5));
  const relative = B(params, 'Relative Density', false);
  const blend = ENUM(params, 'Blend Mode', 'Add');
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'height');
  const inv = 1 / size;
  const freq = 1 + (1 - density) * 9;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let n;
      if (type === 'Fixed') n = 0.5;
      else if (type === 'Gaussian' || type === 'Random') n = hash2f(x, y, seedS);
      else if (type === 'Micro') n = value2(u * 64, v * 64, seedS);
      else n = fractalSum(perlin2, u * freq * 4, v * freq * 4, seedS, 4, 2, 0.5, 'Standard') * 0.5 + 0.5;
      n *= height;
      if (relative) n *= 0.5;
      if (blend === 'Multiply') n = lerp(0.5, n, density);
      else if (blend === 'Subtract') n = 0.5 - (n - 0.5) * density;
      else n = n * density + (1 - density) * 0.5;
      f.data[y * size + x] = clamp01(n);
    }
  }
  return f;
}

/** Sediments：沉积物堆积（流向扇面）。 */
export function sediments(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const maskIn = ctx.input(1);
  const type = ENUM(params, 'Type', 'Classic');
  const passes = clamp(NUM(params, 'Passes', 1) | 0, 1, 10);
  const scale = clamp(NUM(params, 'Scale', 0.5), 0, 1);
  const angle = NUM(params, 'Angle', 32);
  const grainy = B(params, 'Grainy Deposits');
  const { acc } = flowAccumulation(src.data, size);
  const f = createField(size, 'height');
  const inv = 1 / size;
  let maxAcc = 1;
  for (let i = 0; i < acc.length; i++) maxAcc = Math.max(maxAcc, acc[i]);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const fan = Math.pow(acc[i] / maxAcc, 0.5);
      const [dx, dy] = rot(x / size, v, angle);
      let grain = fractalSum(perlin2, dx * (8 + scale * 30), dy * (4 + scale * 12), seed, 4, 2, 0.5, 'Standard') * 0.5 + 0.5;
      if (type === 'Bulky') grain = Math.pow(grain, 0.6);
      else if (type === 'Fine') grain *= 0.6;
      let add = fan * grain * (0.12 + scale * 0.2) * passes * 0.5;
      if (grainy) add += (value2((x / size) * 48, v * 48, seed) - 0.5) * 0.02;
      if (maskIn) add *= clamp01(toScalar(maskIn).data[i]);
      f.data[i] = clamp01(src.data[i] + add);
    }
  }
  return f;
}

/** Switch：按 Route 在两个输入间切换。 */
export function switchNode(ctx) {
  const { params } = ctx;
  const route = B(params, 'Switch Route', false);
  return cloneField(inOr(ctx, route ? 1 : 0, 0.5));
}

/** FlowMapClassic：生成高度并计算汇流图。 */
export function flowMapClassic(ctx) {
  const { size, seed } = ctx;
  const base = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      base.data[y * size + x] = clamp01(fractalSum(perlin2, u * 4, v * 4, seed, 5, 2, 0.5, 'Standard') * 0.5 + 0.5);
    }
  }
  const { acc } = flowAccumulation(base.data, size);
  let maxAcc = 1;
  for (let i = 0; i < acc.length; i++) maxAcc = Math.max(maxAcc, acc[i]);
  const f = createField(size, 'height');
  for (let i = 0; i < acc.length; i++) f.data[i] = clamp01(Math.pow(acc[i] / maxAcc, 0.35));
  return f;
}

/** ColorErosion：按汇流/沉积对颜色场做加深/提亮。 */
export function colorErosion(ctx) {
  const { size, params } = ctx;
  const height = inOr(ctx, 0, 0.5);
  const colorIn = ctx.input(1);
  const transport = clamp01(NUM(params, 'Transport Distance', 0.5));
  const sediment = clamp01(NUM(params, 'Sediment Density', 0.5));
  const blend = clamp01(NUM(params, 'Blend', 0.5));
  const hold = clamp01(NUM(params, 'Color Hold', 0.5));
  const out = colorField(size);
  const { acc } = flowAccumulation(height.data, size);
  let maxAcc = 1;
  for (let i = 0; i < acc.length; i++) maxAcc = Math.max(maxAcc, acc[i]);
  if (colorIn && colorIn.channels >= 3) {
    for (let i = 0; i < out.data.length; i++) {
      const flow = Math.pow(acc[i] / maxAcc, 0.4);
      const dark = 1 - flow * transport * 0.45;
      const lift = 1 + flow * sediment * 0.2;
      const mix = lerp(1, blend, hold * 0.3);
      out.data[i * 4] = clamp01(colorIn.data[i * 4] * dark * lift * mix);
      out.data[i * 4 + 1] = clamp01(colorIn.data[i * 4 + 1] * dark * lift * mix);
      out.data[i * 4 + 2] = clamp01(colorIn.data[i * 4 + 2] * dark * lift * mix);
      out.data[i * 4 + 3] = 1;
    }
  } else {
    const stops = PALETTES.Rock;
    for (let i = 0; i < out.data.length; i++) {
      const flow = Math.pow(acc[i] / maxAcc, 0.4);
      const c = sampleStops(stops, clamp01(height.data[i] - flow * transport * 0.2));
      writeRGB(out, i, c[0], c[1], c[2]);
    }
  }
  return out;
}

/** RockNoise：岩石/层理噪声。 */
export function rockNoise(ctx) {
  const { size, params, seed } = ctx;
  const sizeParam = F2(params, 'Size', [0.2, 0.2]);
  const variety = clamp(NUM(params, 'Variety', 1) | 0, 1, 10);
  const octaves = clamp(NUM(params, 'Octaves', 50) | 0, 2, 40);
  const style = ENUM(params, 'Style', 'A');
  const seedS = NUM(params, 'Seed', seed);
  const scale = clamp(sizeParam[0] || 0.2, 0.01, 1);
  const f = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let n = fractalSum(perlin2, u * (6 + scale * 20), v * (2 + scale * 8), seedS, Math.min(8, octaves), 2.1, 0.5, 'Standard') * 0.5 + 0.5;
      n = Math.pow(clamp01(n), 1 + variety * 0.15);
      if (style === 'B') n = Math.abs(n * 2 - 1);
      else if (style === 'C') n = smoothstep(0.3, 0.7, n);
      f.data[y * size + x] = n;
    }
  }
  return f;
}

/** LoopBegin：循环起始占位（场直通）。 */
export function loopBegin(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Bomber：多轮陨石轰炸。 */
export function bomber(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const count = clamp(NUM(params, 'Iterations', 20) | 0, 1, 60);
  const sizeParam = F2(params, 'Size', [0.2, 0.2]);
  const depth = F2(params, 'Height', [0.8, 0.8]);
  const jitter = clamp(NUM(params, 'Jitter', 0), 0, 1);
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'height');
  f.data.set(src.data);
  for (let b = 0; b < count; b++) {
    const jx = (hash2f(b * 11 + 3, seedS, 5) - 0.5) * jitter;
    const jy = (hash2f(b * 13 + 7, seedS, 9) - 0.5) * jitter;
    const cx = (0.5 + jx) * size;
    const cy = (0.5 + jy) * size;
    const sizeK = Math.max(0.01, sizeParam[0] || 0.2);
    const r = (0.2 + hash2f(b * 17 + 1, seedS, 15) * 0.6) * sizeK * 0.25 * size;
    const ring = Math.max(0, 1 - hash2f(b * 19 + 2, seedS, 21));
    const depthK = Math.max(0.05, depth[0] || 0.8);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(size - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(size - 1, Math.ceil(cx + r)); x++) {
        const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / r;
        if (dist >= 1) continue;
        const bowl = -(1 - dist * dist) * depthK * 0.15;
        const rim = Math.exp(-Math.pow((dist - 0.9) / 0.08, 2)) * depthK * ring * 0.06;
        const i = y * size + x;
        f.data[i] = clamp01(f.data[i] + bowl + rim);
      }
    }
  }
  return f;
}

/** Layers：最多七层高度的叠加混合，每层权重来自 Blend Layer N。 */
export function layers(ctx) {
  const { size, params } = ctx;
  const f = createField(size, 'height');
  f.data.fill(0);
  let weights = 0;
  for (let i = 0; i < 7; i++) {
    const input = ctx.input(i);
    if (!input) continue;
    const w = clamp(NUM(params, `Blend Layer ${i + 1}`, 1), -1, 1);
    const d = toScalar(input).data;
    for (let k = 0; k < f.data.length; k++) f.data[k] += d[k] * w;
    weights += Math.abs(w);
  }
  if (weights > 0) for (let k = 0; k < f.data.length; k++) f.data[k] /= weights;
  else f.data.fill(0.5);
  for (let k = 0; k < f.data.length; k++) f.data[k] = clamp01(f.data[k]);
  return f;
}

/* ================================================================== 遮罩 / 上色 */

/** Distress：扰动/风化型噪声。 */
export function distress(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const octaves = clamp(NUM(params, 'Octaves', 4) | 0, 1, 8);
  const scale = clamp(NUM(params, 'Scale', 20), 1, 250);
  const depth = clamp01(NUM(params, 'Depth', 0.5));
  const influence = clamp01(NUM(params, 'Influence', 0.5));
  // Formation 是 0..1 的数值强度，不是枚举。
  const formation = clamp01(NUM(params, 'Formation', 0.8));
  const scaleX = clamp(NUM(params, 'Scale X', 1), 0.1, 10);
  const scaleY = clamp(NUM(params, 'Scale Y', 1), 0.1, 10);
  const f = createField(size, 'mask');
  const inv = 1 / size;
  const freq = Math.max(1, scale / 10);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const i = y * size + x;
      const n = Math.abs(fractalSum(perlin2, u * freq * scaleX, v * freq * scaleY, seed, octaves, 2, 0.5, 'Standard'));
      const pattern = smoothstep(depth - 0.15, depth + formation * 0.6 + 0.05, n);
      f.data[i] = clamp01(lerp(src.data[i], pattern, influence));
    }
  }
  return f;
}

/** AO：基于高度场的环境光遮蔽。 */
export function ao(ctx) {
  return occlusion(ctx);
}

/** Object：3D 对象导出节点；场直通。 */
export function objectNode(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Draw：绘制/笔刷节点；场直通。 */
export function draw(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** LineNoise：方向性线状噪声。 */
export function lineNoise(ctx) {
  const { size, params, seed } = ctx;
  // Bucket Size 是 Enum（X1..X4），映射到实际的线密度。
  const bucketKey = ENUM(params, 'Bucket Size', 'X1');
  const bucket = { X1: 8, X2: 16, X3: 32, X4: 64 }[bucketKey] || 8;
  const style = ENUM(params, 'Style', 'Sharp');
  const clampAmt = clamp01(NUM(params, 'Clamp', 1));
  const direction = NUM(params, 'Direction', 0);
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const [rx, ry] = rot(u, v, direction);
      const warp = perlin2(rx * bucket, ry * bucket, seedS) * 0.4;
      let line = Math.abs(((ry + warp) * bucket) % 1 - 0.5) * 2;
      if (style === 'Soft') line = Math.pow(line, 0.5);
      else if (style === 'Flat') line = 1 - line;
      else if (style === 'Vague') line = smoothstep(0.25, 0.85, line);
      // Clamp（0.0001..1）作为线条对比度。
      line = clamp01(0.5 + (line - 0.5) * (0.4 + clampAmt * 1.2));
      f.data[y * size + x] = line;
    }
  }
  return f;
}

/** Unreal：引擎导出节点；场直通。 */
export function unreal(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Debris：碎石/残骸散布遮罩。 */
export function debris(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const maskIn = ctx.input(1);
  const amount = clamp01(NUM(params, 'Debris Amount', 0.5));
  const multiplier = clamp(NUM(params, 'Amount Multiplier', 1), 0, 5);
  const scale = clamp(NUM(params, 'Scale', 0.5), 0, 1);
  const friction = clamp01(NUM(params, 'Friction', 0.5));
  const sizeP = F2(params, 'Size', [0.2, 0.2]);
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'mask');
  const inv = 1 / size;
  const freq = 6 + scale * 30;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const w = worley2((x / size) * freq, v * freq, seedS, { jitter: 0.9, density: 0.5 + friction * 0.5 });
      const dot = Math.max(0, 1 - w.f1 * (1.5 + (1 - friction) * 1.5));
      let m = dot * smoothstep(0.25, 0.6, src.data[i]);
      m *= amount * multiplier * (0.6 + sizeP[0] * 0.8);
      if (maskIn) m *= clamp01(toScalar(maskIn).data[i]);
      f.data[i] = clamp01(m);
    }
  }
  return f;
}

/** TileInput：外部平铺输入节点；无文件时退化为平铺噪声。 */
export function tileInput(ctx) {
  const { size, seed } = ctx;
  const stub = fileStub(ctx);
  if (stub) return stub;
  const f = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      f.data[y * size + x] = clamp01(value2(u * 8, v * 8, seed));
    }
  }
  return f;
}

/** Mixer：按层权重混合颜色贴图（无颜色输入时退化为灰度）。 */
export function mixer(ctx) {
  const { size, params } = ctx;
  const base = ctx.input(0);
  // Blend Layers 是一个逗号/空格分隔的权重串。
  const raw = String(P(params, 'Blend Layers', '0.5'));
  const weights = raw.split(/[^0-9.\-]+/).map(Number).filter((n) => Number.isFinite(n) && n !== 0);
  if (!weights.length) weights.push(0.5);

  const out = colorField(size);
  if (base && base.channels >= 3) {
    out.data.set(base.data);
  } else {
    const mon = inOr(ctx, 0, 0.5);
    for (let k = 0; k < size * size; k++) writeRGB(out, k, mon.data[k], mon.data[k], mon.data[k]);
  }

  for (let i = 1; i < 6; i++) {
    const input = ctx.input(i);
    if (!input) continue;
    const w = clamp01(weights[i - 1] === undefined ? weights[weights.length - 1] : weights[i - 1]);
    const d = input.data;
    const colored = input.channels >= 3;
    for (let k = 0; k < size * size; k++) {
      if (colored) {
        out.data[k * 4] = lerp(out.data[k * 4], d[k * 4], w);
        out.data[k * 4 + 1] = lerp(out.data[k * 4 + 1], d[k * 4 + 1], w);
        out.data[k * 4 + 2] = lerp(out.data[k * 4 + 2], d[k * 4 + 2], w);
      } else {
        const s = d[k];
        out.data[k * 4] = lerp(out.data[k * 4], s, w);
        out.data[k * 4 + 1] = lerp(out.data[k * 4 + 1], s, w);
        out.data[k * 4 + 2] = lerp(out.data[k * 4 + 2], s, w);
      }
    }
  }
  return out;
}

/** TextureBase：地表纹理基础遮罩。 */
export function textureBase(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const slopeW = clamp01(NUM(params, 'Slope', 0.25));
  const flowsW = clamp01(NUM(params, 'Flows', 0.15));
  const soilW = clamp01(NUM(params, 'Soil', 0.6));
  const patchesW = clamp01(NUM(params, 'Patches', 0.4));
  const chaosW = clamp01(NUM(params, 'Chaos', 0.1));
  const peaks = clamp(NUM(params, 'Peaks', 0), -1, 1);
  const accentuate = ENUM(params, 'Accentuate', 'Off');
  const enhance = ENUM(params, 'Enhance', 'None');
  const reverse = B(params, 'Reverse');
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'mask');
  const slope = slopeMagnitude(src);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      const patch = fractalSum(perlin2, u * 8, v * 8, seedS, 4, 2, 0.5, 'Standard') * 0.5 + 0.5;
      let n = slope.data[i] * slopeW + (1 - src.data[i]) * soilW + patch * patchesW;
      n += Math.abs(perlin2(u * 20, v * 20, seedS)) * flowsW;
      n += (value2(u * 30, v * 30, seedS) - 0.5) * chaosW;
      n += (src.data[i] - 0.5) * peaks * 0.6;
      if (accentuate === 'New') n = Math.pow(clamp01(n), 0.8);
      else if (accentuate === 'Old') n = Math.pow(clamp01(n), 1.3);
      if (enhance === 'Autolevel') n = clamp01((n - 0.35) / 0.3);
      if (reverse) n = 1 - n;
      f.data[i] = clamp01(n);
    }
  }
  return f;
}

/** IceFloe：浮冰/冰面遮罩。 */
export function iceFloe(ctx) {
  const { size, params, seed } = ctx;
  const maskIn = ctx.input(0);
  const sizeParam = clamp(NUM(params, 'Size', 0.5), 0, 1);
  const density = clamp(NUM(params, 'Density', 0.5), 0, 1);
  const layers = clamp(NUM(params, 'Layers', 1) | 0, 1, 6);
  const thickness = clamp(NUM(params, 'Thickness', 0.5), 0, 1);
  const shaper1 = clamp(NUM(params, 'Shaper 1', 0.5), 0, 1);
  const reverse = B(params, 'Reverse');
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'mask');
  const inv = 1 / size;
  const freq = 2 + sizeParam * 8;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let wu = u, wv = v;
      const warp = shaper1 * 0.2;
      wu += perlin2(u * 4, v * 4, seedS) * warp;
      wv += perlin2(u * 4 + 5, v * 4, seedS) * warp;
      const w = worley2(wu * freq * layers, wv * freq * layers, seedS, { jitter: 0.8, density });
      let m = smoothstep(0, 0.12 + thickness * 0.2, w.f2 - w.f1);
      if (reverse) m = 1 - m;
      if (maskIn) m *= clamp01(toScalar(maskIn).data[y * size + x]);
      f.data[y * size + x] = clamp01(m);
    }
  }
  return f;
}

/** WaterColor：按水面遮罩在地表色上叠加浅/深水色。 */
export function waterColor(ctx) {
  const { size, params } = ctx;
  const mask = inOr(ctx, 0, 0.5);
  const baseIn = ctx.input(1);
  const shadeIn = ctx.input(2);
  const palette = ENUM(params, 'Palette', 'Generic');
  const presets = {
    Generic: [[0.2, 0.58, 0.62], [0.03, 0.12, 0.28]],
    Jungle: [[0.36, 0.52, 0.18], [0.08, 0.16, 0.12]],
    Oasis: [[0.25, 0.62, 0.55], [0.04, 0.18, 0.36]],
    Dirty: [[0.42, 0.45, 0.28], [0.12, 0.15, 0.14]],
    OceanGreen: [[0.18, 0.55, 0.42], [0.02, 0.15, 0.25]],
    OceanBlue: [[0.16, 0.48, 0.62], [0.02, 0.10, 0.35]],
    Murky: [[0.35, 0.38, 0.32], [0.08, 0.10, 0.12]],
    Muddy: [[0.48, 0.40, 0.25], [0.14, 0.12, 0.08]],
  };
  const preset = presets[palette] || presets.Generic;
  const shallow = colorParam(P(params, 'Shallow', null), [preset[0][0], preset[0][1], preset[0][2], 1]);
  const deep = colorParam(P(params, 'Deep', null), [preset[1][0], preset[1][1], preset[1][2], 1]);
  const reverse = B(params, 'Reverse');
  const colorBias = clamp(NUM(params, 'Color Bias', 0), -1, 1);
  const maskBias = clamp(NUM(params, 'Mask Bias', 0), -1, 1);
  const stillwater = clamp01(NUM(params, 'Stillwater', 0));
  const riversAmount = clamp01(NUM(params, 'Rivers', 0));
  const hue = clamp(NUM(params, 'Hue', 0), -1, 1);
  const sat = clamp(NUM(params, 'Saturation', 0), -1, 1);
  const light = clamp(NUM(params, 'Lightness', 0), -1, 1);
  const out = colorField(size);
  for (let i = 0; i < out.data.length; i++) {
    let r, g, b;
    if (baseIn && baseIn.channels >= 3) {
      r = baseIn.data[i * 4]; g = baseIn.data[i * 4 + 1]; b = baseIn.data[i * 4 + 2];
    } else {
      r = g = b = 0.5;
    }
    const water = clamp01(mask.data[i] + maskBias * 0.2);
    let depth = clamp01(water + colorBias * 0.2);
    if (reverse) depth = 1 - depth;
    const wr = lerp(shallow[0], deep[0], depth);
    const wg = lerp(shallow[1], deep[1], depth);
    const wb = lerp(shallow[2], deep[2], depth);
    const a = clamp01(water * (1 - stillwater * 0.2) + riversAmount * 0.05);
    writeRGB(out, i, lerp(r, wr, a), lerp(g, wg, a), lerp(b, wb, a));
    if (shadeIn && shadeIn.channels >= 3) {
      out.data[i * 4] = lerp(out.data[i * 4], shadeIn.data[i * 4], 0.15);
      out.data[i * 4 + 1] = lerp(out.data[i * 4 + 1], shadeIn.data[i * 4 + 1], 0.15);
      out.data[i * 4 + 2] = lerp(out.data[i * 4 + 2], shadeIn.data[i * 4 + 2], 0.15);
    }
  }
  if (hue || sat || light) {
    const tinted = applyHSL(out.data, size, 4, hue, sat, light);
    out.data.set(tinted);
  }
  return out;
}

/** Shrubs：灌木分布遮罩（比 Trees 更宽松、更低矮）。 */
export function shrubs(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const maskIn = ctx.input(1);
  const health = clamp01(NUM(params, 'Health', 0.5));
  const spread = clamp01(NUM(params, 'Spread', 0.1));
  const random = clamp01(NUM(params, 'Random', 0.5));
  const slopePair = F2(params, 'Slope', [0, 0.4]);
  const altPair = F2(params, 'Altitude', [0.05, 0.8]);
  const f = createField(size, 'mask');
  const slope = slopeMagnitude(src);
  const inv = 1 / size;
  const sMax = slopePair[1] > 0 ? slopePair[1] / 90 : 0.7;
  for (let i = 0; i < f.data.length; i++) {
    const x = i % size, y = (i / size) | 0;
    const p = perlin2((x / size) * (5 + spread * 20), (y / size) * (5 + spread * 20), seed) * 0.5 + 0.5;
    const patch = smoothstep(0.9 - spread, 1.1 - spread, p);
    let m = patch * smoothstep(sMax + 0.2, 0.2, slope.data[i]);
    m *= smoothstep(altPair[0] || 0.05, (altPair[0] || 0.05) + 0.05, src.data[i]);
    m *= smoothstep(altPair[1] || 0.8, (altPair[1] || 0.8) - 0.05, src.data[i]);
    if (maskIn) m *= clamp01(toScalar(maskIn).data[i]);
    f.data[i] = clamp01(m * health * (0.6 + random * 0.4));
  }
  return f;
}

/** LightX：基于高度/可选法线的渲染光照色。 */
export function lightX(ctx) {
  const { size, params } = ctx;
  const height = inOr(ctx, 0, 0.5);
  const selection = ENUM(params, 'Direction Selection', 'Manual');
  const north = NUM(params, 'North', 0);
  const latitude = NUM(params, 'Latitude', 60);
  const azimuthParam = NUM(params, 'Sun Azimuth', 0);
  const elevationParam = NUM(params, 'Sun Elevation', 30);
  // Geographic 模式下由纬度/季节推导太阳方位；Manual 直接使用参数。
  const azimuth = selection === 'Geographic' ? north + 180 + latitude * 0.3 : azimuthParam;
  const elevation = selection === 'Geographic' ? Math.max(5, 90 - Math.abs(latitude)) * 0.6 : elevationParam;
  const exposure = clamp(NUM(params, 'Exposure', 1), 0, 4);
  const sunIntensity = clamp(NUM(params, 'Sun Intensity', 1), 0, 4);
  const ambient = clamp(NUM(params, 'Ambient Intensity', 1), 0, 4);
  const sunColor = colorParam(P(params, 'Sun Color', null), [1, 0.94, 0.82, 1]);
  const ambientColor = colorParam(P(params, 'Ambient Color', null), [0.32, 0.42, 0.58, 1]);
  const out = colorField(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const shade = hillshadeAt(height.data, size, x, y, azimuth, elevation, 5);
      const lit = shade * sunIntensity * exposure;
      writeRGB(out, i,
        sunColor[0] * lit + ambientColor[0] * ambient * 0.35,
        sunColor[1] * lit + ambientColor[1] * ambient * 0.35,
        sunColor[2] * lit + ambientColor[2] * ambient * 0.35);
    }
  }
  return out;
}

/** Wizard2：第二次预设流程（侵蚀 + 沉积 + 河道）。 */
export function wizard2(ctx) {
  const { size, seed } = ctx;
  const src = ctx.input(0);
  const f = createField(size, 'height');
  if (src) f.data.set(toScalar(src).data);
  else {
    const inv = 1 / size;
    for (let y = 0; y < size; y++) {
      const v = (y + 0.5) * inv;
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) * inv;
        f.data[y * size + x] = clamp01(0.5 + fractalSum(perlin2, u * 4, v * 4, seed, 6, 2, 0.5, 'Standard') * 0.35);
      }
    }
  }
  const eroded = thermalPass(f.data, size, 12, 0.01, 0.15, 45, 0.1);
  const { acc } = flowAccumulation(eroded, size);
  let maxAcc = 1;
  for (let i = 0; i < acc.length; i++) maxAcc = Math.max(maxAcc, acc[i]);
  for (let i = 0; i < f.data.length; i++) {
    const channel = Math.pow(acc[i] / maxAcc, 0.3);
    f.data[i] = clamp01(eroded[i] - channel * 0.1);
  }
  return f;
}

/* ================================================================== 水系 / 天气 */

/** Anastomosis：网状河道（辫状水系）。 */
export function anastomosis(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const maskIn = ctx.input(1);
  const impact = clamp01(NUM(params, 'Impact', 0.1));
  const width = clamp01(NUM(params, 'Width', 0.1));
  const depth = clamp01(NUM(params, 'Depth', 0.2));
  const downcutting = ENUM(params, 'Downcutting', 'Destructive');
  const smoothEdges = B(params, 'Smooth Edges', true);
  const { acc } = flowAccumulation(src.data, size);
  let maxAcc = 1;
  for (let i = 0; i < acc.length; i++) maxAcc = Math.max(maxAcc, acc[i]);
  const f = createField(size, 'height');
  const inv = 1 / size;
  const freq = 8 + impact * 22;
  const smoothK = smoothEdges ? 0.1 : 0.02;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) * inv;
      const net = Math.abs(perlin2(u * freq, v * freq * 2, seed) + (perlin2(u * freq * 2 + 3, v * freq, seed + 5) * 0.5));
      const channel = Math.max(0, 1 - net / (0.06 + width * 0.22));
      const flow = Math.pow(acc[i] / maxAcc, 0.4);
      const flowK = downcutting.indexOf('River') >= 0 ? 0.8 : downcutting.indexOf('Flood') >= 0 ? 0.5 : 0.35;
      const carve = Math.max(smoothstep(0, smoothK, channel), flow * flowK) * depth * 0.12;
      let h = src.data[i] - carve;
      if (maskIn) h = lerp(src.data[i], h, clamp01(toScalar(maskIn).data[i]));
      f.data[i] = clamp01(h);
    }
  }
  return f;
}

/** Dusting：积雪/沙尘覆盖遮罩。 */
export function dusting(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const strength = clamp01(NUM(params, 'Strength', 1));
  const snowline = clamp01(NUM(params, 'Snowline', 0.5));
  const falloff = clamp01(NUM(params, 'Falloff', 0.5));
  const coverage = clamp01(NUM(params, 'Coverage', 0.15));
  const melt = clamp01(NUM(params, 'Melt', 0.4));
  const gritty = B(params, 'Gritty');
  const slopeCoverage = F2(params, 'Slope Coverage', [0, 0.5]);
  const direction = NUM(params, 'Direction', 0);
  const seedS = NUM(params, 'Seed', seed);
  const f = createField(size, 'mask');
  const slope = slopeMagnitude(src);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) * inv;
      const [rx, ry] = rot(u, v, direction);
      const n = fractalSum(perlin2, rx * 14, ry * 14, seedS, 4, 2, 0.5, 'Standard') * 0.5 + 0.5;
      const line = smoothstep(snowline, snowline + Math.max(0.02, falloff * 0.4), src.data[i]);
      const sMax = slopeCoverage[1] > 0 ? slopeCoverage[1] / 90 : 0.6;
      const flat = smoothstep(sMax + 0.15, 0.2, slope.data[i]);
      let m = (line * flat + n * coverage) * strength;
      m -= melt * smoothstep(0.4, 0.8, src.data[i]) * 0.25;
      if (gritty) m += (value2(u * 40, v * 40, seedS) - 0.5) * 0.08;
      f.data[i] = clamp01(m);
    }
  }
  return f;
}

/** SatMap：卫星影像风格的配色。 */
export function satMap(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const water = ctx.input(1);
  const library = ENUM(params, 'Library', 'Rock');
  const range = F2(params, 'Range', [0, 1]);
  const bias = clamp(NUM(params, 'Bias', 0), -1, 1);
  const enhance = ENUM(params, 'Enhance', 'None');
  const reverse = B(params, 'Reverse');
  const rough = ENUM(params, 'Rough', 'None');
  const hue = clamp(NUM(params, 'Hue', 0), -1, 1);
  const saturation = clamp(NUM(params, 'Saturation', 0), -1, 1);
  const lightness = clamp(NUM(params, 'Lightness', 0), -1, 1);
  const roughFreq = { None: 0, Low: 8, Med: 18, High: 34, Ultra: 60 }[rough] || 0;

  // 先算出色带位置（0..1），Autolevel / Equalize 必须在整幅图上做，所以分两步。
  const tone = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let t = clamp01(lerp(range[0], range[1], src.data[i]));
      if (roughFreq > 0) {
        // 粗糙度：叠加一层高频 value 噪声，让色带边缘不那么"干净"。
        t = clamp01(t + (value2(x * inv * roughFreq, v * roughFreq, seed + 3) - 0.5) * 0.1);
      }
      tone.data[i] = clamp01(t + bias * 0.15);
    }
  }
  if (enhance === 'Autolevel') autolevelInPlace(tone);
  else if (enhance === 'Equalize') equalizeInPlace(tone);

  const stops = PALETTES[library] || PALETTES.Rock;
  const out = colorField(size);
  const wd = water ? toScalar(water).data : null;
  for (let i = 0; i < size * size; i++) {
    let t = clamp01(tone.data[i]);
    if (reverse) t = 1 - t;
    const c = sampleStops(stops, t);
    let r = c[0], g = c[1], b = c[2];
    if (wd) {
      // 水掩膜把对应区域压向深蓝灰。
      const w = clamp01(wd[i]);
      r = lerp(r, 0.12, w); g = lerp(g, 0.22, w); b = lerp(b, 0.35, w);
    }
    writeRGB(out, i, r, g, b);
  }
  if (hue || saturation || lightness) {
    // applyHSL 返回新数组（hue 是圈数增量，sat/light 是 1+增量的倍数）。
    out.data = applyHSL(out.data, size, 4, hue, saturation, lightness);
  }
  return out;
}

/** DataExtractor：从输入中提取边界/差异/修改器遮罩。 */
export function dataExtractor(ctx) {
  const { size, params } = ctx;
  const mode = ENUM(params, 'Data', 'ModifierMask');
  const layer = clamp(NUM(params, 'Layer', 1) | 0, 1, 6);
  const level = clamp01(NUM(params, 'Level', 0.03));
  // Layer 指定从哪个输入端口取数据；0 号端口通常是主地形。
  const a = inOr(ctx, layer - 1, 0.5);
  const b = ctx.input(0);
  const f = createField(size, 'mask');
  if (mode === 'Boundary') {
    // 边界：坡度的软阈值，输出 0..1 的轮廓强度。
    const slope = slopeMagnitude(a);
    for (let i = 0; i < f.data.length; i++) f.data[i] = clamp01(Math.pow(clamp01(slope.data[i] / 0.5), 0.6));
    return f;
  }
  if (mode === 'Difference') {
    if (!b) { f.data.fill(0); return f; }
    const bd = toScalar(b).data;
    for (let i = 0; i < f.data.length; i++) f.data[i] = clamp01(Math.abs(a.data[i] - bd[i]) * 2);
    return f;
  }
  if (mode === 'MixerMask') {
    // MixerMask：Level 以下保留，作为混合器的保护遮罩。
    for (let i = 0; i < f.data.length; i++) f.data[i] = clamp01(1 - smoothstep(level, level + 0.12, a.data[i]));
    return f;
  }
  // ModifierMask：Level 以上暴露，用于修饰器的作用范围。
  for (let i = 0; i < f.data.length; i++) f.data[i] = clamp01(smoothstep(level, level + 0.12, a.data[i]));
  return f;
}

/** Weathering：风化/侵蚀残留的颜色变化（脏污、褪色、环境磨损）。 */
export function weathering(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const scale = clamp01(NUM(params, 'Scale', 0.1));
  const creep = clamp01(NUM(params, 'Creep', 0.1));
  const amount = clamp01(NUM(params, 'Amount', 0.8));
  const washedOut = B(params, 'Washed Out');
  const inverse = B(params, 'Inverse');
  const dirt = clamp01(NUM(params, 'Dirt', 0.01));
  const darker = B(params, 'Darker');
  const hue = clamp(NUM(params, 'Hue', 0), -1, 1);
  const saturation = clamp(NUM(params, 'Saturation', 0), -1, 1);
  const lightness = clamp(NUM(params, 'Lightness', 0), -1, 1);

  const slope = slopeMagnitude(src);
  const out = colorField(size);
  const inv = 1 / size;
  const freq = 6 + scale * 50;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const n = fractalSum(perlin2, (x * inv) * freq, v * freq, seed, 4, 2.1, 0.55, 'Standard') * 0.5 + 0.5;
      // 陡坡上的岩屑蠕动（Creep）会增加风化量。
      const creepMask = smoothstep(0.35, 0.9, slope.data[i]) * creep;
      let wear = clamp01(amount * (0.25 + 0.75 * n) + creepMask * 0.25);
      if (inverse) wear = 1 - wear;
      // 脏污斑块：只在噪声尖端出现，默认强度很低。
      const spot = dirt > 0 ? smoothstep(1 - dirt, 1, n) : 0;
      const base = 0.20 + wear * 0.38;
      let r = base + 0.06 - spot * 0.08;
      let g = base + 0.03 - spot * 0.10;
      let b = base - 0.02 - spot * 0.06;
      if (washedOut) {
        const l = (r + g + b) / 3;
        r = lerp(r, l, 0.55); g = lerp(g, l, 0.55); b = lerp(b, l, 0.55);
      }
      if (darker) { r *= 0.72; g *= 0.72; b *= 0.72; }
      writeRGB(out, i, r, g, b);
    }
  }
  if (hue || saturation || lightness) {
    out.data = applyHSL(out.data, size, 4, hue, saturation, lightness);
  }
  return out;
}

/** Snowfield：雪线以上的大面积积雪遮罩。 */
export function snowfield(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const snowLine = clamp01(NUM(params, 'Snow Line', 0));
  const intensity = clamp01(NUM(params, 'Intensity', 0.35));
  const duration = clamp01(NUM(params, 'Duration', 0.25));
  const cascades = clamp(NUM(params, 'Cascades', 6) | 0, 1, 50);
  const melt = clamp01(NUM(params, 'Melt', 0));
  const slipAngle = clamp(NUM(params, 'Slip-off angle', 38), 0, 90);
  const adhered = clamp(NUM(params, 'Adhered snow mass', 12), 0, 30);
  const flows = B(params, 'Flows');
  const flowsDepth = clamp01(NUM(params, 'Flows Depth', 0.25));
  const taper = B(params, 'Taper Snowfall');
  const taperAmount = clamp01(NUM(params, 'Taper Amount', 0.25));
  const settle = clamp01(NUM(params, 'Settle Duration', 0.25));
  const sharp = B(params, 'Sharp Buildup');
  const alternate = B(params, 'Alternate Snowfall');
  const surface = clamp01(NUM(params, 'Surface Details', 0.4));
  const direction = ENUM(params, 'Direction', 'N');

  const slope = slopeMagnitude(src);
  // 坡度过陡处雪会滑落：Slip-off angle 越大，积雪能停留的坡度越陡。
  const slipSlope = Math.tan(deg2rad(slipAngle)) * 0.35 + adhered * 0.004;
  const f = createField(size, 'mask');
  const inv = 1 / size;
  const dirVec = { X: [1, 0], N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[direction] || [0, -1];
  const band = sharp ? 0.06 : 0.06 + (1 - intensity) * 0.2 + 0.12;
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // 多级（Cascades）噪声让雪面有堆积层次。
      let n = 0, amp = 0.5, fr = 8;
      for (let o = 0; o < Math.min(6, 1 + (cascades >> 2)); o++) {
        n += (perlin2(x * inv * fr, v * inv * fr, seed + o * 37) * 0.5 + 0.5) * amp;
        amp *= 0.5; fr *= 2.05;
      }
      // 风向/坡向：让迎风面多雪。
      const dirBias = dirVec[0] * x * inv + dirVec[1] * v * inv;
      const snowH = src.data[i] + (n - 0.5) * (0.15 + surface * 0.25) + (alternate ? dirBias * 0.05 : 0);
      let line = smoothstep(snowLine, snowLine + band, snowH);
      // 坡度限制
      const hold = clamp01(1 - smoothstep(slipSlope * 0.5, slipSlope, slope.data[i]));
      let m = clamp01(line * hold * (intensity + duration * 0.35) * 1.4);
      m -= melt * smoothstep(0.2, 0.9, src.data[i]) * 0.25;
      if (taper) m *= 1 - taperAmount * 0.4 * (1 - clamp01(src.data[i]));
      if (flows) m += flowsDepth * smoothstep(0.55, 0.95, slope.data[i]) * 0.15;
      if (settle > 0) m = clamp01(m * (1 + settle * 0.15));
      f.data[i] = clamp01(m);
    }
  }
  return f;
}

/** MountainSide：生成单一山坡/山体侧壁。 */
export function mountainSide(ctx) {
  const { size, params, seed } = ctx;
  const scale = clamp(NUM(params, 'Scale', 0.5), 0.0001, 0.9999);
  const detail = clamp01(NUM(params, 'Detail', 0.25));
  const type = ENUM(params, 'Type', 'Slope');
  const style = ENUM(params, 'Style', 'Basic');
  const direction = NUM(params, 'Direction', 0);

  const f = createField(size, 'height');
  const inv = 1 / size;
  const ax = Math.cos(deg2rad(direction));
  const ay = Math.sin(deg2rad(direction));
  // Style 决定细节噪声的强度与走向。
  const styleRough = { Basic: 1, Eroded: 0.75, Old: 0.5, Alpine: 1.5, Strata: 1.1 }[style] || 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv - 0.5;
      const v = (y + 0.5) * inv - 0.5;
      // along：沿山脊走向；across：垂直山脊，用来形成单侧下滑的剖面。
      const along = (u * ax + v * ay) * 2;
      const across = (-u * ay + v * ax) * 2;
      let base;
      if (type === 'Peak') {
        const r = Math.sqrt(u * u + v * v) * 2;
        base = clamp01(1 - r);
        base = Math.pow(base, 0.8 + (1 - scale) * 0.6);
      } else {
        base = clamp01(1 - Math.abs(across) * (0.6 + scale * 0.5));
        // 两端收口，让山体不是一条无限延伸的墙。
        base *= clamp01(0.45 + 0.55 * (1 - Math.abs(along)));
      }
      const n = fractalSum(perlin2, (u * 4) + 10, (v * 4) + 10, seed, 4, 2.1, 0.5, 'Ridged');
      let h = base + (n - 0.5) * detail * styleRough * 0.5;
      if (style === 'Strata') h += Math.sin(base * 18 + n * 3) * 0.05;
      if (style === 'Eroded' || style === 'Old') h += Math.pow(base, 3) * 0.08;
      f.data[y * size + x] = clamp01(h);
    }
  }
  return f;
}

/** EasyErosion：预设侵蚀（高度 + 两个可选遮罩）。 */
export function easyErosion(ctx) {
  const { size } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const maskA = ctx.input(1);
  const maskB = ctx.input(2);
  let h = thermalPass(src.data, size, 10, 0.012, 0, 0, 0);
  const { acc } = flowAccumulation(h, size);
  let maxAcc = 1;
  for (let i = 0; i < acc.length; i++) maxAcc = Math.max(maxAcc, acc[i]);
  for (let i = 0; i < h.length; i++) {
    let v = h[i] - Math.pow(acc[i] / maxAcc, 0.35) * 0.1;
    if (maskA) v = lerp(src.data[i], v, clamp01(toScalar(maskA).data[i]));
    if (maskB) v = lerp(v, src.data[i], clamp01(toScalar(maskB).data[i]));
    h[i] = clamp01(v);
  }
  return outField(size, h);
}

/** Shade：把高度场渲染成光照/阴影图（颜色输出）。 */
export function shade(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const style = ENUM(params, 'Render Style', 'HillShade');
  const azimuth = NUM(params, 'Sun Azimuth', 0);
  const elevation = clamp(NUM(params, 'Sun Elevation', 30), 0.5, 90);
  const sunlight = clamp(NUM(params, 'Sunlight', 1), 0, 4);
  const biasP = clamp(NUM(params, 'Shade Bias', 0), -1, 1);
  const soft = clamp01(NUM(params, 'Soft Shadows', 0.5));
  const reflected = B(params, 'Reflected Light');
  const highQuality = B(params, 'High Quality');

  const out = colorField(size);
  let light;
  if (style === 'Occlusion') {
    // 环境光遮蔽直接复用 features.js 的 occlusion（其 Radius/Strength 用缺省值）。
    light = occlusion(ctx).data;
  } else if (style === 'TableTop') {
    // TableTop：去掉方向光，仅按高程分层着色。
    const tmp = createField(size, 'height');
    tmp.data.set(src.data);
    autolevelInPlace(tmp);
    light = tmp.data;
  } else {
    light = new Float32Array(size * size);
    // SoftLight 先做一次小半径模糊，让阴影边界柔和。
    const sd = style === 'SoftLight'
      ? gaussianBlur(src, Math.max(1, Math.round((1 - soft) * size * 0.02) + 1)).data
      : src.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        light[y * size + x] = hillshadeAt(sd, size, x, y, azimuth, elevation, highQuality ? 8 : 4);
      }
    }
  }
  for (let i = 0; i < light.length; i++) {
    let v = clamp01(light[i] * sunlight + biasP * 0.25);
    if (reflected) v = clamp01(v + 0.08);
    writeRGB(out, i, v, v, v);
  }
  return out;
}

/** LoopEnd：循环结束占位（场直通）。 */
export function loopEnd(ctx) {
  return cloneField(inOr(ctx, 0, 0.5));
}

/** Splat：把 R/G/B 三个通道（或对应高度的输入）合成为颜色。 */
export function splat(ctx) {
  const { size, params } = ctx;
  const keys = ['R', 'G', 'B'];
  const out = colorField(size);
  // Clamp Product 关闭时保留原始值，交给下游节点处理。
  const clampProduct = B(params, 'Clamp Product', true);
  for (let c = 0; c < 3; c++) {
    const input = ctx.input(c);
    const d = input ? toScalar(input).data : null;
    const param = NUM(params, keys[c], 1);
    for (let i = 0; i < size * size; i++) {
      const v = d ? d[i] : param;
      out.data[i * 4 + c] = clampProduct ? clamp01(v) : v;
    }
  }
  // Alpha 由参数控制，输出恒为不透明（Gaea 的 Splat 只有 3 个端口）。
  const alpha = clamp01(NUM(params, 'A', 1));
  for (let i = 0; i < size * size; i++) out.data[i * 4 + 3] = alpha;

  if (B(params, 'Autolevel')) {
    // 逐通道自动色阶，让合成结果用满 0..1。
    for (let c = 0; c < 3; c++) {
      const tmp = createField(size, 'height');
      for (let i = 0; i < size * size; i++) tmp.data[i] = out.data[i * 4 + c];
      autolevelInPlace(tmp);
      for (let i = 0; i < size * size; i++) out.data[i * 4 + c] = tmp.data[i];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ 地图配色 */

const CARTO_LAND = {
  Classic: [[0, 0.10, 0.18, 0.10], [0.2, 0.24, 0.42, 0.18], [0.45, 0.55, 0.60, 0.32],
    [0.7, 0.72, 0.62, 0.46], [0.85, 0.62, 0.55, 0.42], [1, 0.92, 0.90, 0.85]],
  Minimal: [[0, 0.30, 0.32, 0.30], [1, 0.92, 0.92, 0.90]],
  FertileRed: [[0, 0.16, 0.22, 0.10], [0.35, 0.42, 0.52, 0.24], [0.7, 0.68, 0.42, 0.26], [1, 0.88, 0.56, 0.48]],
  FertileGreen: [[0, 0.10, 0.20, 0.10], [0.4, 0.30, 0.52, 0.18], [0.75, 0.62, 0.72, 0.34], [1, 0.92, 0.94, 0.78]],
  RedBlueSpectrum: [[0, 0.10, 0.28, 0.62], [0.35, 0.30, 0.55, 0.62], [0.65, 0.72, 0.42, 0.32], [1, 0.86, 0.30, 0.22]],
  MineralsYellow: [[0, 0.22, 0.18, 0.08], [0.45, 0.66, 0.52, 0.16], [0.8, 0.92, 0.80, 0.32], [1, 1, 0.98, 0.82]],
  FertileCool: [[0, 0.12, 0.20, 0.22], [0.4, 0.32, 0.46, 0.44], [0.75, 0.62, 0.68, 0.60], [1, 0.94, 0.96, 0.94]],
  FertileMurky: [[0, 0.10, 0.16, 0.10], [0.4, 0.30, 0.36, 0.18], [0.75, 0.52, 0.50, 0.26], [1, 0.78, 0.76, 0.52]],
};

const CARTO_WATER = {
  Classic: [[0, 0.30, 0.55, 0.72], [1, 0.04, 0.14, 0.34]],
  BlackSea: [[0, 0.16, 0.26, 0.30], [1, 0.01, 0.02, 0.04]],
  Caribbean: [[0, 0.40, 0.82, 0.80], [1, 0.02, 0.20, 0.52]],
};

/** Cartography：等高线 + 高程配色 + 网格的地形图叠加层。 */
export function cartography(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const waterIn = ctx.input(1);
  const gridIn = ctx.input(2);
  const accuracy = clamp01(NUM(params, 'Accuracy', 0.3));
  const gradientStyle = ENUM(params, 'Gradient Style', 'Smooth');
  const equalizeGradient = B(params, 'Equalize Gradient');
  const reverse = B(params, 'Reverse');
  const erode = B(params, 'Erode');
  const landPalette = ENUM(params, 'Land Palette', 'Classic');
  const waterPalette = ENUM(params, 'Water Palette', 'Classic');
  const landContours = clamp(NUM(params, 'Land Contours', 5) | 0, 3, 50);
  const landInt = F2(params, 'Land Contour Intenstity', [0.4, 0.4]);
  const landBias = clamp(NUM(params, 'Land Bias', 0), -1, 1);
  const waterContours = clamp(NUM(params, 'Water Contours', 5) | 0, 3, 50);
  const waterInt = F2(params, 'Water Contour Intenstity', [0.4, 0.4]);
  const waterBias = clamp(NUM(params, 'Water Bias', 0), -1, 1);
  const trim = clamp01(NUM(params, 'Trim', 0));
  const gridCount = clamp(NUM(params, 'Grid Count', 20) | 0, 4, 100);
  const gridInt = F2(params, 'Grid Intenstity', [0.5, 0.5]);
  const gridStyle = ENUM(params, 'Grid Style', 'None');
  const boundaryThickness = clamp(NUM(params, 'Boundary Thickness', 2) | 0, 1, 10);
  const contourThickness = clamp(NUM(params, 'Contour Thickness', 1) | 0, 1, 10);
  const gridThickness = clamp(NUM(params, 'Grid Thickness', 1) | 0, 1, 10);

  // 高程归一化：先自动色阶，Equalize 时再做直方图均衡。
  const landT = createField(size, 'height');
  landT.data.set(src.data);
  if (equalizeGradient) equalizeInPlace(landT);
  else autolevelInPlace(landT);
  if (erode) {
    // 轻微模糊模拟侵蚀后的平滑坡面。
    const blurred = gaussianBlur(landT, Math.max(1, Math.round(size * 0.004)));
    landT.data.set(blurred.data);
  }
  // Gradient Style：把连续坡度量化成不同密度的色阶。
  if (gradientStyle === 'LargeContours') {
    for (let i = 0; i < landT.data.length; i++) landT.data[i] = Math.floor(landT.data[i] * 24) / 24;
  } else if (gradientStyle === 'AllContours') {
    for (let i = 0; i < landT.data.length; i++) landT.data[i] = Math.floor(landT.data[i] * 96) / 96;
  }

  const landStops = CARTO_LAND[landPalette] || CARTO_LAND.Classic;
  const waterStops = CARTO_WATER[waterPalette] || CARTO_WATER.Classic;
  const landLineInt = (landInt[0] + landInt[1]) * 0.5;
  const landLines = cartographerContours(
    src.data, size, landContours, 2, accuracy,
    landLineInt, landLineInt * 0.5, contourThickness,
  ).contours;
  const wd = waterIn ? toScalar(waterIn).data : null;
  let waterLines = null;
  if (wd) {
    const wi = (waterInt[0] + waterInt[1]) * 0.5;
    waterLines = cartographerContours(
      wd, size, waterContours, 2, accuracy,
      wi, wi * 0.5, contourThickness,
    ).contours;
  }
  const gridD = gridIn ? toScalar(gridIn).data : null;
  // 海岸线：水掩膜的坡度，Boundary Thickness 决定线宽（用阈值近似）。
  const shoreSlope = wd ? slopeMagnitude(toScalar(waterIn)) : null;
  const shoreLo = 0.15 + 0.05 / boundaryThickness;
  const shoreHi = 0.5 - 0.05 / boundaryThickness;

  const out = colorField(size);
  const spacing = size / gridCount;
  const gridStrength = (gridInt[0] + gridInt[1]) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const tRaw = clamp01(landT.data[i] + landBias * 0.2);
      const t = reverse ? 1 - tRaw : tRaw;
      const c = sampleStops(landStops, t);
      let r = c[0], g = c[1], b = c[2];

      const w = wd ? clamp01(wd[i]) : 0;
      if (w > 0.02) {
        const depth = clamp01(w + waterBias * 0.2);
        const wc = sampleStops(waterStops, 1 - depth);
        r = lerp(r, wc[0], w); g = lerp(g, wc[1], w); b = lerp(b, wc[2], w);
        if (waterLines) {
          const lw = clamp01(waterLines[i]) * 0.35;
          r += lw; g += lw; b += lw;
        }
      }

      // 陆地等高线：水体处淡出。
      const ll = clamp01(landLines[i]) * (1 - w);
      r += ll * 0.45; g += ll * 0.45; b += ll * 0.45;

      // 海岸线。
      if (shoreSlope) {
        const edge = smoothstep(shoreLo, shoreHi, shoreSlope.data[i]);
        if (edge > 0) {
          const k = edge * 0.75;
          r = lerp(r, 0.08, k); g = lerp(g, 0.10, k); b = lerp(b, 0.12, k);
        }
      }

      // 网格：优先用连入的网格场，否则按 Grid Count 程序化绘制。
      let gm = 0;
      if (gridD) gm = clamp01(gridD[i]);
      else if (gridStyle !== 'None') {
        const gxa = Math.abs((x + 0.5) - Math.round((x + 0.5) / spacing) * spacing);
        const gya = Math.abs((y + 0.5) - Math.round((y + 0.5) / spacing) * spacing);
        const onLine = gxa <= gridThickness * 0.5 || gya <= gridThickness * 0.5;
        const isWater = w > 0.05;
        if (onLine) {
          if (gridStyle === 'Everywhere') gm = 1;
          else if (gridStyle === 'OverLand' && !isWater) gm = 1;
          else if (gridStyle === 'OverWater' && isWater) gm = 1;
        }
      }
      if (gm > 0) {
        const k = gm * gridStrength * 0.5;
        r = lerp(r, 0.95, k); g = lerp(g, 0.95, k); b = lerp(b, 0.95, k);
      }

      // Trim：压暗图幅边缘。
      if (trim > 0) {
        const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
        const k = 1 - smoothstep(0, trim * size * 0.2, edge);
        r *= k; g *= k; b *= k;
      }
      writeRGB(out, i, r, g, b);
    }
  }
  return out;
}

/** Heal：重建被量化/低分辨率破坏的高度场，消除条带。 */
export function heal(ctx) {
  const { size, params } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const reconstruction = clamp01(NUM(params, 'Reconstruction', 0.3));
  const passes = clamp(NUM(params, 'Passes', 1) | 0, 1, 10);

  const f = createField(size, 'height');
  f.data.set(src.data);
  // 逐轮"模糊 + 回混"：模糊抹平 8-bit 阶梯，回混保留原始地形大形。
  for (let p = 0; p < passes; p++) {
    const radius = Math.max(1, Math.round(size * 0.0015 * (1 + reconstruction * 6)));
    const blurred = gaussianBlur(f, radius);
    for (let i = 0; i < f.data.length; i++) {
      f.data[i] = lerp(f.data[i], blurred.data[i], reconstruction);
    }
  }
  return f;
}

/** Rivers：由汇流图雕刻河床与河谷。 */
export function rivers(ctx) {
  const { size, params } = ctx;
  const height = inOr(ctx, 0, 0.5);
  const maskIn = ctx.input(1);
  const water = clamp01(NUM(params, 'Water', 0.5));
  const width = clamp01(NUM(params, 'Width', 0.2));
  const depth = clamp01(NUM(params, 'Depth', 0.2));
  const downcut = clamp01(NUM(params, 'Downcutting', 0.1));
  const valleyKey = ENUM(params, 'River Valley Width', 'zero');
  const headwaters = clamp(NUM(params, 'Headwaters', 200) | 0, 1, 4000);
  const renderSurface = B(params, 'Render Surface');
  const valleyScale = { minus4: 0.3, minus2: 0.65, zero: 1, plus2: 1.5, plus4: 2.2 }[valleyKey] || 1;

  const { acc } = flowAccumulation(height.data, size);
  let maxAcc = 1e-9;
  for (let i = 0; i < acc.length; i++) if (acc[i] > maxAcc) maxAcc = acc[i];

  // Headwaters 越大，需要越大的汇流量才形成河道 → 源头更少、主河更粗。
  const start = clamp(headwaters / 4000, 0.01, 1) * 0.35;
  const span = 0.04 + width * 0.28;
  const riverF = createField(size, 'mask');
  for (let i = 0; i < riverF.data.length; i++) {
    const flow = Math.pow(acc[i] / maxAcc, 0.45);
    riverF.data[i] = smoothstep(start, start + span, flow);
  }
  // 河谷宽度：对河道遮罩做模糊，形成两侧平缓谷地。
  const valley = gaussianBlur(riverF, Math.max(1, Math.round(size * 0.01 * valleyScale)));

  const f = createField(size, 'height');
  const md = maskIn ? toScalar(maskIn).data : null;
  for (let i = 0; i < f.data.length; i++) {
    const river = clamp01(riverF.data[i]);
    const valleyM = clamp01(valley.data[i]);
    let h = height.data[i];
    h -= valleyM * water * 0.06;                    // 谷地整体下切
    h -= river * (0.04 + depth * 0.22);             // 河床
    h -= Math.pow(river, 3) * downcut * 0.3;        // 深切割
    if (renderSurface) h += (river - river * river) * 0.03; // 水面高光
    if (md) h = lerp(height.data[i], h, clamp01(md[i]));
    f.data[i] = clamp01(h);
  }
  return f;
}

/** ColorThreshold：按与指定颜色的距离生成遮罩。 */
export function colorThreshold(ctx) {
  const { size, params } = ctx;
  const input = ctx.input(0);
  const start = colorParam(P(params, 'Start', [0.5, 0.5, 0.5, 1]), [0.5, 0.5, 0.5, 1]);
  const falloff = clamp(NUM(params, 'Falloff', 0.2), 0.0001, 1);
  const f = createField(size, 'mask');
  if (input && input.channels >= 3) {
    // 颜色输入：用 RGB 欧氏距离，Falloff 为软阈值宽度。
    for (let i = 0; i < f.data.length; i++) {
      const dr = input.data[i * 4] - start[0];
      const dg = input.data[i * 4 + 1] - start[1];
      const db = input.data[i * 4 + 2] - start[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
      f.data[i] = clamp01(1 - smoothstep(0, falloff, dist));
    }
    return f;
  }
  // 标量输入：退化为按亮度距离。
  const src = inOr(ctx, 0, 0.5);
  const target = (start[0] + start[1] + start[2]) / 3;
  for (let i = 0; i < f.data.length; i++) {
    f.data[i] = clamp01(1 - smoothstep(0, falloff, Math.abs(src.data[i] - target)));
  }
  return f;
}

/** Whorl：在大范围上叠加多个旋涡，产生拉伸/旋转变形。 */
export function whorl(ctx) {
  const { size, params, seed } = ctx;
  const src = inOr(ctx, 0, 0.5);
  const type = ENUM(params, 'Type', 'Stretch');
  const whorls = clamp(NUM(params, 'Whorls', 10) | 0, 3, 150);
  const power = clamp(NUM(params, 'Power', 0.3), 0, 3);

  // 生成 whorls 个旋涡中心：位置、半径、方向（-1..1）。
  const centers = [];
  for (let k = 0; k < whorls; k++) {
    centers.push([
      hash2f(k * 7 + 3, k * 5 + 11, seed),
      hash2f(k * 13 + 5, k * 3 + 2, seed + 101),
      0.05 + hash2f(k * 11 + 1, k * 9 + 7, seed + 202) * 0.14,
      (hash2f(k * 3 + 13, k * 17 + 9, seed + 303) - 0.5) * 2,
    ]);
  }

  const f = createField(size, 'height');
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      const v = (y + 0.5) * inv;
      let du = 0, dv = 0;
      for (const c of centers) {
        const dx = u - c[0], dy = v - c[1];
        const falloff = Math.exp(-(dx * dx + dy * dy) / (c[2] * c[2] * 2));
        const ang = c[3] * power * falloff * 1.8;
        const ru = dx * Math.cos(ang) - dy * Math.sin(ang);
        const rv = dx * Math.sin(ang) + dy * Math.cos(ang);
        if (type === 'Stretch') {
          // 拉伸：沿旋涡径向放大/压缩。
          const stretch = 1 + c[3] * power * falloff * 1.5;
          du += ru * stretch - dx;
          dv += rv / stretch - dy;
        } else {
          du += ru - dx;
          dv += rv - dy;
        }
      }
      const su = clamp01(u + du);
      const sv = clamp01(v + dv);
      f.data[y * size + x] = sampleBilinear(src.data, size, su * size, sv * size, 0);
    }
  }
  return f;
}

