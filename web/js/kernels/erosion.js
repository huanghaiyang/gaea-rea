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

export function hydraulicDroplet(ctx) {
  const { size, params, input, seed } = ctx;
  const src = input(0);
  if (!src) return createField(size, 'height', 0.5);

  const duration = Math.max(0, P(params, 'Duration', 0.5));
  const downcutting = clamp01(P(params, 'Downcutting', 0.5));
  const erosionScale = clamp01(P(params, 'Erosion Scale', 0.5));
  const noErosion = !!P(params, 'NoErosion', false);
  const suspended = clamp01(P(params, 'Suspended Load', 0.5));
  const bedLoad = clamp01(P(params, 'Bed Load', 0.35));
  const coarse = clamp01(P(params, 'Coarse Sediments', 0.35));
  const depBoost = P(params, 'DepositionBoost', 0);
  const extraBoost = P(params, 'ExtraDepositionBoost', 0);
  const shape = clamp01(P(params, 'Shape', 0.4));
  const shapeSharp = clamp01(P(params, 'Shape Sharpness', 0.4));
  const shapeDetail = clamp01(P(params, 'Shape Detail Scale', 0.5));
  const enable = P(params, 'Enable', true);

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
  const radiusSq = erosionRadius * erosionRadius;

  // Precompute the erosion brush (linear falloff, normalized)
  const brushOffsets = [];
  let brushSum = 0;
  for (let dy = -erosionRadius; dy <= erosionRadius; dy++) {
    for (let dx = -erosionRadius; dx <= erosionRadius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radiusSq) continue;
      const w = 1 - Math.sqrt(d2) / (erosionRadius + 1e-6);
      brushOffsets.push([dx, dy, w]);
      brushSum += w;
    }
  }
  if (brushSum <= 0) { brushOffsets.push([0, 0, 1]); brushSum = 1; }

  let posX = 0, posY = 0, dirX = 0, dirY = 0, speed = 0, water = 0, sediment = 0;

  for (let n = 0; n < droplets; n++) {
    posX = rng.unit() * (size - 1);
    posY = rng.unit() * (size - 1);
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
