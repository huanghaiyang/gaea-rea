/**
 * registry.js — THE single extension point of the whole application.
 *
 * To add (or improve) the algorithm of any node you change exactly one place: the NODES
 * array below (or the kernel module it points at). Everything else — the library panel, the
 * parameter panel, the evaluator, the preview, the exporter — is driven from this registry
 * plus data/nodes.json.
 *
 * Node descriptor shape
 * ---------------------
 *   name        exact Gaea node name (matches data/nodes.json "name")
 *   algorithm   kernel function (ctx) => Field
 *   category    library grouping
 *   summary     short explanation shown in the library tooltip
 *   inputs      port list; each { name, kind }
 *   outputs     port list; each { name, kind }   kind: 'height'|'mask'|'color'|'flow'|'any'
 *   params      parameter overrides keyed by the EXACT Gaea parameter name:
 *                 { d: default, min, max, step, label, kind, options, hint }
 *   note        fidelity caveat surfaced in the UI ("approx", "model", "stub")
 *   portStyle   'first' (default) | 'none' | 'sum'  -> how unconnected/passthrough works
 *
 * Any node in data/nodes.json WITHOUT a registry entry is still fully usable: it appears in
 * the library, its parameter panel is generated from its schema, and it evaluates as a
 * passthrough of its first connected input (or a mid-height constant) with a clear
 * "not implemented" badge. That is the data-driven guarantee this project is built on.
 */

import {
  constant, fileStub, multiFractal, perlinNode, ridgeNode, cellular, cellular3d, voronoi,
  dotNoise, crater, mountain, canyon, glacier, flowMap,
} from './kernels/generators.js';
import {
  adjust, clampNode, autolevel, equalize, extend, clip, invert, flip, curve, warp,
  directionalWarp, blur, deflate, dilate, denoise, combine, maskApply, maskBlend,
} from './kernels/filters.js';
import {
  hydraulicDroplet, streamPower, thermalTalus,
} from './kernels/erosion.js';
import {
  levelsRange, slope, heightKey, occlusion, distanceTransform, fractalTerraces, stepsNode,
  heightSelect, slopeSelect, maskSelect, angleSelect, dataSelect, seaLevel, snow, cracks,
  shift, shear, transformField, recurve,
} from './kernels/features.js';
import { createField } from './kernel/field.js';

/* ================================================================== passthrough */

/**
 * Fallback used by every node that is catalogued but has no algorithm yet.
 * Honest by construction: it copies the first connected input, or emits a mid-grey field.
 */
export function passthrough(ctx) {
  const src = ctx.input(0);
  if (src) return { size: src.size, channel: src.channel, channels: src.channels, data: new Float32Array(src.data) };
  return createField(ctx.size, 'height', 0.5);
}

/** Output / Export: identity, and the terminal node that PNG export reads. */
function outputNode(ctx) {
  const src = ctx.input(0);
  if (src) return src;
  return createField(ctx.size, 'height', 0.5);
}

/* ================================================================== port shorthands */

const H = (name = 'Input', kind = 'height') => ({ name, kind });
const OUT_H = (name = 'Output') => ({ name, kind: 'height' });
const MASK = (name = 'Mask') => ({ name, kind: 'mask' });

/* ================================================================== the registry */

const CAT = {
  PRIM: 'Primitive / Noise',
  WARP: 'Warp & Distort',
  ADJ: 'Adjust & Filter',
  COMB: 'Combine & Route',
  EROS: 'Erosion & Flow',
  SHAPE: 'Terrain Shape',
  MASK: 'Mask & Select',
  IO: 'Input / Output',
  FX: 'Color / Fx',
};

export const NODES = [
  /* ---------------------------------------------------------- IO */
  {
    name: 'Constant',
    note: 'exact', algorithm: constant, category: CAT.PRIM,
    summary: 'Flat height or flat colour source.',
    inputs: [], outputs: [OUT_H('Output')],
    params: { Height: { d: 0.5, min: 0, max: 1, step: 0.001 } },
  },
  {
    name: 'File', algorithm: fileStub, category: CAT.IO,
    summary: 'Load a heightmap. NOT IMPLEMENTED — emits a deterministic placeholder so graphs still evaluate.',
    inputs: [], outputs: [OUT_H('Output')],
    note: 'stub',
    params: { File: { d: '', hint: 'Path is not read in this build. See IMPLEMENTATION-NOTES.md.' } },
  },
  {
    name: 'Output',
    note: 'exact', algorithm: outputNode, category: CAT.IO,
    summary: 'Terminal node. The field reaching Output is what the exporter writes.',
    inputs: [H('Input')], outputs: [],
  },
  {
    name: 'Export',
    note: 'exact', algorithm: outputNode, category: CAT.IO,
    summary: 'Terminal node with Gaea file-export parameters. Export is performed by the toolbar (PNG 8/16 heightmap).',
    inputs: [H('Input')], outputs: [],
    params: {
      Format: { d: 'PNG16', hint: 'Only PNG8/PNG16 are produced by this build; RAW formats are not written.' },
    },
  },
  {
    name: 'Group',
    note: 'exact', algorithm: passthrough, category: CAT.IO,
    summary: 'Graph organisation node. Passes its input through.',
    inputs: [H()], outputs: [OUT_H()],
  },

  /* ---------------------------------------------------------- PRIMITIVES */
  {
    name: 'MultiFractal', algorithm: multiFractal, category: CAT.PRIM,
    summary: 'fBm / Billowy / Ridged fractal terrain with octave control, domain perturbation and variation.',
    inputs: [], outputs: [OUT_H()],
    note: 'approx',
    params: {
      'Noise Type': { d: 'FBM' },
      'Auto Octaves': { d: true },
      Octaves: { d: 8, min: 1, max: 24, step: 1 },
      Scale: { d: 100, min: 1, max: 400, step: 1, hint: 'Feature size as a percentage of the terrain.' },
      'Relative Feature Scale': { d: 1, min: 0.05, max: 4, step: 0.05 },
      Roughness: { d: 0.5, min: 0, max: 1, step: 0.01 },
      'Edge smoothing': { d: 0, min: 0, max: 1, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      Type: { d: 'SelfModulation' },
      Variation: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Smoothness: { d: 0, min: 0, max: 1, step: 0.01 },
      Contrast: { d: 1, min: 0.1, max: 4, step: 0.01 },
      Damping: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Bias: { d: 0, min: -1, max: 1, step: 0.01 },
      Rotation: { d: 0, min: -180, max: 180, step: 1 },
      Anisotropy: { d: 0, min: -0.95, max: 3, step: 0.01 },
      'Offset X': { d: 0, min: -100, max: 100, step: 0.5 },
      'Offset Y': { d: 0, min: -100, max: 100, step: 0.5 },
      Perturb: { d: 'None' },
      Strength: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Complexity: { d: 3, min: 1, max: 12, step: 1 },
      Attenuation: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Iterations: { d: 1, min: 1, max: 8, step: 1 },
    },
  },
  {
    name: 'Perlin', algorithm: perlinNode, category: CAT.PRIM,
    summary: 'Explicit Perlin fBm with Gain and optional warp.',
    inputs: [], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Type: { d: 'FBM' },
      Scale: { d: 100, min: 1, max: 400, step: 1 },
      Octaves: { d: 6, min: 1, max: 20, step: 1 },
      Gain: { d: 0.5, min: 0.05, max: 0.95, step: 0.01 },
      Height: { d: 1, min: 0, max: 2, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      Frequency: { d: 1, min: 0.1, max: 8, step: 0.1 },
      Amplitude: { d: 0, min: 0, max: 2, step: 0.01 },
      'Scale X': { d: 1, min: 0.1, max: 4, step: 0.01 },
      'Scale Y': { d: 1, min: 0.1, max: 4, step: 0.01 },
      X: { d: 0, min: -100, max: 100, step: 0.5 },
      Y: { d: 0, min: -100, max: 100, step: 0.5 },
    },
  },
  {
    name: 'Ridge', algorithm: ridgeNode, category: CAT.PRIM,
    summary: 'Ridged multifractal ridge lines with a Definition exponent.',
    inputs: [], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Scale: { d: 100, min: 1, max: 400, step: 1 },
      Height: { d: 1, min: 0, max: 2, step: 0.01 },
      Definition: { d: 1, min: 0.1, max: 4, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      'Scale X': { d: 1, min: 0.1, max: 4, step: 0.01 },
      'Scale Y': { d: 1, min: 0.1, max: 4, step: 0.01 },
    },
  },
  {
    name: 'Cellular', algorithm: cellular, category: CAT.PRIM,
    summary: '2D Worley cellular noise with metric morph, anisotropy and 5 distance functions.',
    inputs: [], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Size: { d: 50, min: 1, max: 300, step: 1 },
      Density: { d: 1, min: 1, max: 8, step: 1 },
      Jitter: { d: 1, min: 0, max: 1, step: 0.01 },
      'Metric Morph': { d: 0, min: 0, max: 1, step: 0.01 },
      'Distance Metric': { d: 'Euclidian_Manhattan' },
      'Coordinate Axes Jitter': { d: 0, min: 0, max: 1, step: 0.01 },
      'CAJ Clustering': { d: 0, min: 0, max: 1, step: 0.01 },
      Anisotropy: { d: 0, min: -0.9, max: 3, step: 0.01 },
      'Distance Function': { d: 'DistanceToEdge' },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
    },
  },
  {
    name: 'Cellular3D', algorithm: cellular3d, category: CAT.PRIM,
    summary: 'Volumetric (3D) Worley cellular noise swept along the field for volumetric-looking breakup.',
    inputs: [], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Size: { d: 50, min: 1, max: 300, step: 1 },
      Gap: { d: 0, min: 0, max: 1, step: 0.01 },
      'Jitter X': { d: 1, min: 0, max: 1, step: 0.01 },
      'Jitter Y': { d: 1, min: 0, max: 1, step: 0.01 },
      'Jitter Z': { d: 1, min: 0, max: 1, step: 0.01 },
      'Scale X': { d: 1, min: 0.1, max: 4, step: 0.01 },
      'Scale Y': { d: 1, min: 0.1, max: 4, step: 0.01 },
      'Scale Z': { d: 1, min: 0.1, max: 4, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      'Normalize Input': { d: false },
    },
  },
  {
    name: 'Voronoi', algorithm: voronoi, category: CAT.PRIM,
    summary: 'Voronoi cells with 8 output forms (C N R P A S M D) and optional warping.',
    inputs: [], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Scale: { d: 50, min: 1, max: 300, step: 1 },
      Jitter: { d: 1, min: 0, max: 1, step: 0.01 },
      Function: { d: 'Euclidean' },
      Form: { d: 'C' },
      Gain: { d: 1, min: 0, max: 4, step: 0.01 },
      Clamp: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      Type: { d: 'None' },
      Frequency: { d: 1, min: 0.1, max: 8, step: 0.1 },
      Amplitude: { d: 0, min: 0, max: 1, step: 0.01 },
      Octaves: { d: 2, min: 1, max: 8, step: 1 },
      'Scale X': { d: 1, min: 0.1, max: 4, step: 0.01 },
      'Scale Y': { d: 1, min: 0.1, max: 4, step: 0.01 },
      X: { d: 0, min: -100, max: 100, step: 0.5 },
      Y: { d: 0, min: -100, max: 100, step: 0.5 },
    },
  },
  {
    name: 'DotNoise', algorithm: dotNoise, category: CAT.PRIM,
    summary: 'Layered dot / square speckle noise.',
    inputs: [], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Style: { d: 'Dot' },
      Iterations: { d: 6, min: 1, max: 16, step: 1 },
      Multiplier: { d: 1, min: 0.05, max: 2, step: 0.01 },
      Size: { d: [1, 1], min: 0.05, max: 4, step: 0.01, kind: 'vector2' },
      Height: { d: 1, min: 0, max: 2, step: 0.01 },
      'Blend Mode': { d: 'None' },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
    },
  },
  {
    name: 'Crater', algorithm: crater, category: CAT.SHAPE,
    summary: 'Impact crater: raised rim, bowl floor, ejecta falloff.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
    params: {
      Style: { d: 'New' },
      Scale: { d: 30, min: 1, max: 200, step: 1 },
      Formation: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Height: { d: 1, min: 0, max: 2, step: 0.01 },
      Rim: { d: 'Soft' },
      Shape: { d: 0.5, min: 0, max: 1, step: 0.01 },
      X: { d: 0, min: -100, max: 100, step: 1 },
      Y: { d: 0, min: -100, max: 100, step: 1 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
    },
  },
  {
    name: 'Mountain', algorithm: mountain, category: CAT.SHAPE,
    summary: 'Peak generator from a ridged Voronoi range with a radial massif envelope.',
    inputs: [], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Scale: { d: 40, min: 1, max: 200, step: 1 },
      Height: { d: 1, min: 0, max: 2, step: 0.01 },
      Style: { d: 'Basic' },
      Bulk: { d: 'Medium' },
      'Reduce Details': { d: false },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      X: { d: 0, min: -100, max: 100, step: 1 },
      Y: { d: 0, min: -100, max: 100, step: 1 },
    },
  },
  {
    name: 'Canyon', algorithm: canyon, category: CAT.SHAPE,
    summary: 'Drainage-based canyon: warped Voronoi slots cut into a plateau.',
    inputs: [], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Style: { d: 'Classic' },
      Scale: { d: 50, min: 1, max: 300, step: 1 },
      Slot: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Valley: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Surrounding: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Depth: { d: 1, min: 0, max: 2, step: 0.01 },
      'Structual Warp': { d: 0.35, min: 0, max: 1, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      'Detail Warp': { d: 0.35, min: 0, max: 1, step: 0.01 },
      'Alternate Style': { d: false },
    },
  },
  {
    name: 'Glacier', algorithm: glacier, category: CAT.SHAPE,
    summary: 'Ice lobes flowing along a direction, with directional breakage.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'model',
    params: {
      Scale: { d: 50, min: 1, max: 300, step: 1 },
      'Scale 2': { d: 0.5, min: 0, max: 1, step: 0.01 },
      Thickness: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Height: { d: 0.5, min: 0, max: 2, step: 0.01 },
      Direction: { d: 0, min: 0, max: 32, step: 1 },
      Breakage: { d: 0.3, min: 0, max: 1, step: 0.01 },
      'Rough Edges': { d: false },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      Smooth: { d: false },
      'Breakage Count': { d: 6, min: 1, max: 48, step: 1 },
      'Flow Breakage Depth': { d: 0.4, min: 0, max: 1, step: 0.01 },
    },
  },
  {
    name: 'Cracks', algorithm: cracks, category: CAT.SHAPE,
    summary: 'Fracture mask along warped Voronoi cell edges.',
    inputs: [], outputs: [MASK('Output')],
    note: 'model',
    params: {
      Scale: { d: 50, min: 1, max: 300, step: 1 },
      Width: { d: 0.06, min: 0.002, max: 0.5, step: 0.002 },
      Depth: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Warp: { d: 0.3, min: 0, max: 1, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
    },
  },

  /* ---------------------------------------------------------- WARP */
  {
    name: 'Warp', algorithm: warp, category: CAT.WARP,
    summary: 'Domain warp: Bitmap displacement, VectorField, or iterated VectorFieldIntegral.',
    inputs: [H('Input'), { name: 'Warp', kind: 'any' }], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Size: { d: 100, min: 1, max: 400, step: 1 },
      Strength: { d: 0.5, min: -2, max: 2, step: 0.01 },
      'Z Scale': { d: 0.5, min: 0, max: 1, step: 0.01, hint: 'Accepted but only affects the procedural source selection; see notes.' },
      'Warp Source': { d: 'PerlinFBM' },
      Perturbation: { d: 0, min: 0, max: 1, step: 0.01 },
      Complexity: { d: 3, min: 1, max: 12, step: 1 },
      Roughness: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Normalized: { d: false },
      'Edge Behaviour': { d: 'Edge' },
      Modulation: { d: 0, min: -1, max: 1, step: 0.01 },
      'Modulation Direction': { d: 0, min: 0, max: 360, step: 1 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      Iterations: { d: 1, min: 1, max: 12, step: 1 },
      Mode: { d: 'Bitmap' },
    },
  },
  {
    name: 'DirectionalWarp', algorithm: directionalWarp, category: CAT.WARP,
    summary: 'Warps input 0 uniformly along Direction, driven by input 1.',
    inputs: [H('Input'), { name: 'Driver', kind: 'any' }], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Strength: { d: 0.5, min: -2, max: 2, step: 0.01 },
      Direction: { d: 0, min: 0, max: 360, step: 1 },
      'Edge Behaviour': { d: 'Edge' },
    },
  },
  {
    name: 'Shift',
    note: 'approx', algorithm: shift, category: CAT.WARP,
    summary: 'Translates the field with wrap-around.',
    inputs: [H()], outputs: [OUT_H()],
    params: { X: { d: 0.1, min: -1, max: 1, step: 0.005 }, Y: { d: 0.1, min: -1, max: 1, step: 0.005 }, Scale: { d: 1, min: 0.1, max: 4, step: 0.01 } },
  },
  {
    name: 'Shear',
    note: 'approx', algorithm: shear, category: CAT.WARP,
    summary: 'Slanted offset proportional to the perpendicular axis.',
    inputs: [H()], outputs: [OUT_H()],
    params: { Amount: { d: 0.2, min: -1, max: 1, step: 0.01 }, Vertical: { d: false } },
  },
  {
    name: 'Transform',
    note: 'approx', algorithm: transformField, category: CAT.WARP,
    summary: 'Scale / rotate / translate resample of the field.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      'Scale X': { d: 1, min: 0.1, max: 4, step: 0.01 },
      'Scale Y': { d: 1, min: 0.1, max: 4, step: 0.01 },
      Rotation: { d: 0, min: -180, max: 180, step: 1 },
      X: { d: 0, min: -100, max: 100, step: 0.5 },
      Y: { d: 0, min: -100, max: 100, step: 0.5 },
    },
  },

  /* ---------------------------------------------------------- ADJUST */
  {
    name: 'Adjust', algorithm: adjust, category: CAT.ADJ,
    summary: 'Multiply, Shaper (gamma), Clamp, Clip, Autolevel, Equalize, Strong S-curve, Invert, Drop.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'approx',
    params: {
      Multiply: { d: 1, min: 0, max: 4, step: 0.01 },
      Shaper: { d: 1, min: 0.05, max: 4, step: 0.01, hint: 'Gamma; >1 brightens, <1 darkens.' },
      Clamp: { d: [0, 1], min: -1, max: 2, step: 0.005, kind: 'vector2' },
      Clip: { d: [0, 1], min: -1, max: 2, step: 0.005, kind: 'vector2' },
      Drop: { d: false },
      Autolevel: { d: false },
      Equalize: { d: false },
      Strong: { d: false },
      Invert: { d: false },
    },
  },
  {
    name: 'Clamp',
    note: 'approx', algorithm: clampNode, category: CAT.ADJ,
    summary: 'Clamps to a value range; Normalized autolevels first.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Mode: { d: 'Standard' },
      Value: { d: [0, 1], min: -1, max: 2, step: 0.005, kind: 'vector2' },
      Drop: { d: false },
    },
  },
  {
    name: 'Autolevel', algorithm: autolevel, category: CAT.ADJ,
    summary: 'Robust 0.1%..99.9% percentile stretch of the input to the full range.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'approx',
    params: {},
  },
  {
    name: 'Equalize',
    note: 'approx', algorithm: equalize, category: CAT.ADJ,
    summary: 'Histogram equalization with a blend Factor.',
    inputs: [H()], outputs: [OUT_H()],
    params: { Factor: { d: 1, min: 0, max: 1, step: 0.01 } },
  },
  {
    name: 'Extend',
    note: 'approx', algorithm: extend, category: CAT.ADJ,
    summary: 'Stretches the requested value window out to the full 0..1 range.',
    inputs: [H()], outputs: [OUT_H()],
    params: { Value: { d: [0, 1], min: -1, max: 2, step: 0.005, kind: 'vector2' } },
  },
  {
    name: 'Clip',
    note: 'approx', algorithm: clip, category: CAT.ADJ,
    summary: 'Cuts the field against Min/Max, zeroing what falls outside.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Min: { d: 0, min: -1, max: 1, step: 0.005 },
      Max: { d: 1, min: -1, max: 2, step: 0.005 },
      'Auto Clip': { d: false },
    },
  },
  {
    name: 'Invert',
    note: 'approx', algorithm: invert, category: CAT.ADJ,
    summary: '1 - value.',
    inputs: [H()], outputs: [OUT_H()],
    params: {},
  },
  {
    name: 'Flip',
    note: 'approx', algorithm: flip, category: CAT.ADJ,
    summary: 'Mirror horizontally, vertically, or both.',
    inputs: [H()], outputs: [OUT_H()],
    params: {},
  },
  {
    name: 'Blur',
    note: 'approx', algorithm: blur, category: CAT.ADJ,
    summary: 'Separable gaussian blur, Radius in pixels.',
    inputs: [H()], outputs: [OUT_H()],
    params: { Radius: { d: 4, min: 0, max: 128, step: 0.5 } },
  },
  {
    name: 'Deflate', algorithm: deflate, category: CAT.ADJ,
    summary: 'Pulls features inward via iterative grayscale erosion plus smoothing.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'model',
    params: { Amount: { d: 0.5, min: 0, max: 1, step: 0.01 } },
  },
  {
    name: 'Dilate',
    note: 'approx', algorithm: dilate, category: CAT.ADJ,
    summary: 'Grows bright regions with a selectable structure element.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Size: { d: 1, min: 0, max: 16, step: 0.5 },
      Shape: { d: 0, min: 0, max: 1, step: 0.01 },
      Iterations: { d: 1, min: 1, max: 16, step: 1 },
      Kernel: { d: 'Cross' },
      Invert: { d: false },
    },
  },
  {
    name: 'Denoise', algorithm: denoise, category: CAT.ADJ,
    summary: 'Edge-preserving (Perona-Malik) diffusion, or isolated-pixel removal.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'model',
    params: {
      Type: { d: 'OnePass' },
      Amount: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Passes: { d: 2, min: 1, max: 12, step: 1 },
    },
  },
  {
    name: 'Curve', algorithm: curve, category: CAT.ADJ,
    summary: 'PCHIP spline remap of the height curve (Absolute vs Relative).',
    inputs: [H()], outputs: [OUT_H()],
    note: 'approx',
    params: { Mode: { d: 'Absolute' } },
  },
  {
    name: 'Recurve', algorithm: recurve, category: CAT.ADJ,
    summary: 'Curve remap using the node\u2019s Curve control points.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'approx',
    params: {},
  },
  {
    name: 'FractalTerraces', algorithm: fractalTerraces, category: CAT.SHAPE,
    summary: 'Stepped terraces whose boundaries are perturbed by fractal noise.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'model',
    params: {
      Steps: { d: 8, min: 1, max: 128, step: 1 },
      Sharpness: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Tilt: { d: 0, min: -1, max: 1, step: 0.01 },
      'Tilt Angle': { d: 0, min: 0, max: 360, step: 1 },
      Fractal: { d: 0.35, min: 0, max: 1, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
    },
  },
  {
    name: 'Steps',
    note: 'model', algorithm: stepsNode, category: CAT.SHAPE,
    summary: 'Hard quantisation of height into discrete bands.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Steps: { d: 8, min: 1, max: 256, step: 1 },
      Smoothness: { d: 0, min: 0, max: 1, step: 0.01 },
    },
  },
  {
    name: 'Slope', algorithm: slope, category: CAT.MASK,
    summary: 'Slope (gradient magnitude) as a 0..1 mask.',
    inputs: [H()], outputs: [MASK('Output')],
    note: 'model',
    params: {
      Strength: { d: 1, min: 0.01, max: 8, step: 0.01 },
      Scale: { d: 1, min: 0.01, max: 8, step: 0.01 },
    },
  },
  {
    name: 'Height', algorithm: heightKey, category: CAT.MASK,
    summary: 'Height-band key mask between Low and High with a Falloff.',
    inputs: [H()], outputs: [MASK('Output')],
    note: 'model',
    params: {
      Low: { d: 0.35, min: -1, max: 1, step: 0.005 },
      High: { d: 0.65, min: -1, max: 2, step: 0.005 },
      Falloff: { d: 0.15, min: 0.001, max: 0.5, step: 0.001 },
    },
  },
  {
    name: 'Occlusion', algorithm: occlusion, category: CAT.MASK,
    summary: 'Ambient occlusion from local height minus a blurred neighbourhood.',
    inputs: [H()], outputs: [MASK('Output')],
    note: 'model',
    params: {
      Radius: { d: 16, min: 1, max: 128, step: 1 },
      Strength: { d: 1, min: 0.01, max: 4, step: 0.01 },
    },
  },
  {
    name: 'Distance', algorithm: distanceTransform, category: CAT.MASK,
    summary: 'Chamfer distance transform from the solid region (threshold on the input).',
    inputs: [H()], outputs: [MASK('Output')],
    note: 'model',
    params: {
      Threshold: { d: 0.5, min: -1, max: 2, step: 0.005 },
      Invert: { d: false },
      'Use Gradient': { d: false },
    },
  },
  {
    name: 'FlowMap', algorithm: flowMap, category: CAT.EROS,
    summary: 'D8 flow accumulation, log-compressed into a flow map.',
    inputs: [H()], outputs: [{ name: 'Flow', kind: 'flow' }],
    note: 'model',
    params: {
      'Flow Length': { d: 0.5, min: 0, max: 1, step: 0.01 },
      'Flow Volume': { d: 0.5, min: 0, max: 1, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
    },
  },

  /* ---------------------------------------------------------- COMBINE */
  {
    name: 'Combine',
    note: 'approx', algorithm: combine, category: CAT.COMB,
    summary: 'All 24 Gaea blend modes with Ratio, Output (None/Clamp/Extend) and Enhance.',
    inputs: [H('Input 1'), H('Input 2')], outputs: [OUT_H()],
    params: {
      Ratio: { d: 0.5, min: 0, max: 1, step: 0.005 },
      Mode: { d: 'Blend' },
      Output: { d: 'None' },
      Enhance: { d: 'None' },
    },
  },
  {
    name: 'Mask', algorithm: maskApply, category: CAT.MASK,
    summary: 'Masks input 0 by input 1 (1 = keep, 0 = neutral mid-height).',
    inputs: [H('Input'), MASK('Mask')], outputs: [OUT_H()],
    note: 'model',
    params: {
      Amount: { d: 1, min: 0, max: 1, step: 0.01 },
      Invert: { d: false },
    },
  },
  {
    name: 'Blend', algorithm: maskBlend, category: CAT.COMB,
    summary: 'Blends input 0 and input 1 through the mask on input 2.',
    inputs: [H('Input 1'), H('Input 2'), MASK('Mask')], outputs: [OUT_H()],
    note: 'model',
    params: {},
  },
  {
    name: 'HeightSelect', algorithm: heightSelect, category: CAT.MASK,
    summary: 'Routes between two inputs by a height band.',
    inputs: [H('Input 1'), H('Input 2'), H('Driver')], outputs: [OUT_H()],
    note: 'model',
    params: {
      Low: { d: 0.4, min: -1, max: 1, step: 0.005 },
      High: { d: 1, min: -1, max: 2, step: 0.005 },
      Falloff: { d: 0.1, min: 0.001, max: 0.5, step: 0.001 },
      Invert: { d: false },
    },
  },
  {
    name: 'SlopeSelect', algorithm: slopeSelect, category: CAT.MASK,
    summary: 'Routes between two inputs by slope range.',
    inputs: [H('Input 1'), H('Input 2'), H('Driver')], outputs: [OUT_H()],
    note: 'model',
    params: {
      Min: { d: 0.1, min: 0, max: 4, step: 0.01 },
      Max: { d: 1, min: 0, max: 8, step: 0.01 },
      Falloff: { d: 0.1, min: 0.001, max: 0.5, step: 0.001 },
      Invert: { d: false },
    },
  },
  {
    name: 'MaskSelect', algorithm: maskSelect, category: CAT.MASK,
    summary: 'Routes between two inputs by a mask threshold.',
    inputs: [H('Input 1'), H('Input 2'), MASK('Mask')], outputs: [OUT_H()],
    note: 'model',
    params: {
      Threshold: { d: 0.5, min: 0, max: 1, step: 0.005 },
      Falloff: { d: 0.1, min: 0.001, max: 0.5, step: 0.001 },
      Invert: { d: false },
    },
  },
  {
    name: 'AngleSelect', algorithm: angleSelect, category: CAT.MASK,
    summary: 'Routes between two inputs by directional slope alignment.',
    inputs: [H('Input 1'), H('Input 2'), H('Driver')], outputs: [OUT_H()],
    note: 'model',
    params: {
      Direction: { d: 0, min: 0, max: 360, step: 1 },
      Falloff: { d: 0.2, min: 0.001, max: 1, step: 0.001 },
      Invert: { d: false },
    },
  },
  {
    name: 'DataSelect', algorithm: dataSelect, category: CAT.MASK,
    summary: 'Cross-fades between two inputs by an explicit Index.',
    inputs: [H('Input 1'), H('Input 2')], outputs: [OUT_H()],
    note: 'model',
    params: { Index: { d: 0, min: 0, max: 1, step: 0.005 } },
  },
  {
    name: 'Sea', algorithm: seaLevel, category: CAT.SHAPE,
    summary: 'Floods everything below Level, flattening a water surface.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'model',
    params: {
      Level: { d: 0.4, min: 0, max: 1, step: 0.005 },
      Depth: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Shore: { d: 0.05, min: 0.001, max: 0.5, step: 0.001 },
    },
  },
  {
    name: 'Snow', algorithm: snow, category: CAT.MASK,
    summary: 'Snow accumulation by altitude and slope, with melt.',
    inputs: [H()], outputs: [MASK('Output')],
    note: 'model',
    params: {
      Snowline: { d: 0.6, min: 0, max: 1, step: 0.005 },
      Transition: { d: 0.15, min: 0.001, max: 0.5, step: 0.001 },
      'Slope Limit': { d: 0.5, min: 0, max: 4, step: 0.01 },
      'Slope Falloff': { d: 0.25, min: 0.001, max: 1, step: 0.001 },
      Melt: { d: 0, min: 0, max: 1, step: 0.01 },
      'Melt Angle': { d: 0, min: 0, max: 360, step: 1 },
    },
  },

  /* ---------------------------------------------------------- EROSION */
  {
    name: 'Erosion2', algorithm: hydraulicDroplet, category: CAT.EROS,
    summary: 'Particle (droplet) hydraulic erosion — the recommended erosion node in this build.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'model',
    params: {
      Duration: { d: 0.5, min: 0, max: 1, step: 0.01, hint: 'Scaled to a droplet budget of Duration * 0.8 * N^2.' },
      Downcutting: { d: 0.5, min: 0, max: 1, step: 0.01 },
      'Erosion Scale': { d: 0.5, min: 0, max: 1, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      NoErosion: { d: false },
      'Suspended Load': { d: 0.5, min: 0, max: 1, step: 0.01 },
      'Discharge Angle': { d: 0.5, min: 0, max: 1, step: 0.01 },
      'Bed Load': { d: 0.35, min: 0, max: 1, step: 0.01 },
      'Coarse Sediments': { d: 0.35, min: 0, max: 1, step: 0.01 },
      DepositionBoost: { d: 0, min: 0, max: 1, step: 0.01 },
      ExtraDepositionBoost: { d: 0, min: 0, max: 1, step: 0.01 },
      Shape: { d: 0.4, min: 0, max: 1, step: 0.01 },
      'Shape Sharpness': { d: 0.4, min: 0, max: 1, step: 0.01 },
      'Shape Detail Scale': { d: 0.5, min: 0, max: 1, step: 0.01 },
      Enable: { d: true },
      'Directional Precipitation': { d: false },
      Direction: { d: 0, min: 0, max: 32, step: 1 },
      'Rain Shadow': { d: 0.5, min: 0, max: 1, step: 0.01 },
      Slope: { d: [0, 1], min: 0, max: 1, step: 0.01, kind: 'vector2' },
      Altitude: { d: [0, 1], min: 0, max: 1, step: 0.01, kind: 'vector2' },
      Reverse: { d: false },
    },
  },
  {
    name: 'Erosion', algorithm: streamPower, category: CAT.EROS,
    summary: 'Stream-power hydraulic erosion: D8 accumulation + detachment-limited incision and deposition.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'model',
    params: {
      Duration: { d: 0.5, min: 0, max: 1, step: 0.01 },
      'Rock Softness': { d: 0.5, min: 0, max: 1, step: 0.01 },
      Strength: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Downcutting: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Inhibition: { d: 0.35, min: 0, max: 1, step: 0.01 },
      'Base Level': { d: 0, min: 0, max: 1, step: 0.005 },
      Debris: { d: 0.35, min: 0, max: 1, step: 0.01 },
      Volume: { d: 0.5, min: 0, max: 1, step: 0.01 },
      'Sediment Removal': { d: 0, min: 0, max: 1, step: 0.01 },
      'Bias Type': { d: 'Altitude' },
      Bias: { d: 0, min: -1, max: 1, step: 0.01 },
      Reverse: { d: false },
      'Aggressive Mode': { d: false },
    },
  },
  {
    name: 'Thermal', algorithm: thermalTalus, category: CAT.EROS,
    summary: 'Thermal (talus-angle) relaxation with anisotropic transport.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'model',
    params: {
      Duration: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Strength: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Anisotropy: { d: 0, min: 0, max: 1, step: 0.01 },
      Angle: { d: 0, min: 0, max: 360, step: 1 },
      Settling: { d: 0.4, min: 0, max: 1, step: 0.01 },
      'Sediment Removal': { d: 0, min: 0, max: 1, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
    },
  },
];

/* ================================================================== index + schema merge */

/** Fast lookup by node name. */
export const BY_NAME = new Map(NODES.map((n) => [n.name, n]));

/** Lower-cased, punctuation-free lookup so a vendor node can alias a registry entry. */
const CANONICAL = new Map(NODES.map((n) => [n.name.toLowerCase().replace(/[^a-z0-9]/g, ''), n]));

/**
 * Resolve an algorithm for a node name.
 *
 * Exact registry names win. Beyond those, a small set of CATALOG names are aliases for a
 * registry algorithm (same operation, different spelling in the vendor dump), and the
 * "+ 2"/" 2" suffixed variants of an implemented node reuse that node's algorithm. Anything
 * else is the honest passthrough. This is the only place alias resolution happens.
 */
export const ALIASES = {
  equalizer: 'Equalize',
  deflate: 'Deflate',
  dilate: 'Dilate',
  easyerosion: 'Erosion2',
  erosion3: 'Erosion2',
  thermal2: 'Thermal',
  'thermal2sharp': 'Thermal',
  ridged: 'Ridge',
  multifractal2: 'MultiFractal',
  warps: 'Warp',
  warptexture: 'Warp',
  dunesea: 'MultiFractal',
  fractal: 'MultiFractal',
  hill: 'Mountain',
  peak: 'Mountain',
  ridge2: 'Ridge',
  slope2: 'Slope',
  height2: 'Height',
  occlusion2: 'Occlusion',
  snowfield: 'Snow',
  crag: 'Cracks',
};

export function resolveEntry(name) {
  if (BY_NAME.has(name)) return BY_NAME.get(name);
  const key = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (ALIASES[key] && BY_NAME.has(ALIASES[key])) return BY_NAME.get(ALIASES[key]);
  // "Erosion3"/"Snow2"-style suffixes: strip a trailing digit run and retry
  const stripped = key.replace(/\d+$/, '');
  if (stripped !== key) {
    if (BY_NAME.has(stripped)) return BY_NAME.get(stripped);
    const byCanon = CANONICAL.get(stripped);
    if (byCanon && byCanon.algorithm) return byCanon;
  }
  const byCanon = CANONICAL.get(key);
  if (byCanon && byCanon.algorithm) return byCanon;
  return null;
}

/** Names with a real algorithm (exact registry entries only). */
export const IMPLEMENTED = new Set(NODES.map((n) => n.name));

/** Port kind -> display colour (kept in JS so CSS and canvas stay in sync). */
export const KIND_COLOR = {
  height: '#6ea8fe',
  mask: '#f0a35e',
  color: '#c07ee8',
  flow: '#5ed3c0',
  any: '#98a2b3',
};

/**
 * Build a per-node parameter schema by merging the vendor catalog with registry overrides.
 * Unknown parameters are never dropped: they receive a generic default and control kind
 * derived purely from their declared type, which is what makes arbitrary nodes usable.
 */
export function buildSchema(catalogNode, registryNode) {
  const overrides = (registryNode && registryNode.params) || {};
  const seen = new Map();
  const params = [];
  for (const cp of (catalogNode ? catalogNode.params : [])) {
    if (seen.has(cp.name)) continue; // vendor dump contains duplicate labels; keep the first
    seen.set(cp.name, true);
    const ov = overrides[cp.name] || {};
    params.push(mergeParam(cp, ov));
  }
  // Registry-only params (e.g. for nodes whose catalog entry is missing a control)
  for (const [name, ov] of Object.entries(overrides)) {
    if (seen.has(name)) continue;
    seen.set(name, true);
    params.push(mergeParam({ name, type: null, control: null, description: '' }, ov));
  }
  return params;
}

/**
 * Which UI control represents a parameter.
 * Precedence: an explicit registry override, then the vendor catalog's declared control,
 * then a type-derived fallback. The vendor type is respected because Nodes.json already
 * distinguishes Enum / Boolean / Float2 / Color / String correctly.
 */
function resolveControl(cp, ov) {
  if (ov.kind === 'vector2') return 'vector2';
  if (ov.kind === 'color') return 'color';
  if (cp.control && cp.control !== 'slider') return cp.control;
  switch (cp.type) {
    case 'Boolean': return 'toggle';
    case 'Enum': return 'select';
    case 'Color': return 'color';
    case 'Float2': return 'vector2';
    case 'String': return 'text';
    case 'Int32': case 'Byte': return 'number';
    case 'Command': return 'text';
    case 'List`1': return 'text';
    case 'Single': return 'slider';
    default: break;
  }
  if (cp.control) return cp.control;
  if (ov.options) return 'select';
  if (typeof ov.d === 'boolean') return 'toggle';
  if (Array.isArray(ov.d)) return 'vector2';
  if (typeof ov.d === 'string') return 'text';
  return 'slider';
}

function mergeParam(cp, ov) {
  const control = resolveControl(cp, ov);
  const generated = genericDefault(cp, control);

  // Provenance of every number, so the UI and the docs can state where it came from:
  //   'registry' – hand-authored here; authoritative because it is in this kernel's units
  //   'il'       – the [Parameter(default,min,max)] attribute recovered from the Gaea assembly
  //   'type'     – a conservative per-type fallback
  let value, defSrc;
  if (ov.d !== undefined) { value = ov.d; defSrc = 'registry'; }
  else if (cp.ilDefault !== undefined) { value = cp.ilDefault; defSrc = 'il'; }
  else { value = generated.d; defSrc = 'type'; }

  let min, max, rangeSrc;
  if (ov.min !== undefined || ov.max !== undefined) {
    min = ov.min !== undefined ? ov.min : generated.min;
    max = ov.max !== undefined ? ov.max : generated.max;
    rangeSrc = 'registry';
  } else if (cp.ilMin !== undefined && cp.ilMax !== undefined && cp.ilMax > cp.ilMin) {
    min = cp.ilMin;
    max = cp.ilMax;
    rangeSrc = 'il';
  } else {
    min = generated.min;
    max = generated.max;
    rangeSrc = 'type';
  }

  const p = {
    name: cp.name,
    type: cp.type ?? null,
    control,
    description: cp.description || '',
    options: ov.options || cp.options || undefined,
    value,
    min,
    max,
    step: ov.step !== undefined ? ov.step : generated.step,
    source: { default: defSrc, range: rangeSrc },
  };
  if (ov.hint) p.hint = ov.hint;
  if (ov.label) p.label = ov.label;
  // A default outside its own range would make the slider unusable; clamp instead of hiding it.
  if (typeof p.value === 'number' && typeof min === 'number' && typeof max === 'number'
      && !(p.value >= min && p.value <= max)) {
    p.value = Math.min(max, Math.max(min, p.value));
  }
  return p;
}

/**
 * Generic, type-driven defaults for parameters we did not hand-tune.
 * The value ranges are deliberately conservative (0..1 for Single, -1..1 for signed
 * Float2) so an unknown node can never explode the simulation.
 */
function genericDefault(cp, control) {
  const t = cp.type;
  if (control === 'toggle') return { d: false, min: 0, max: 1, step: 1 };
  if (control === 'color') return { d: [0.5, 0.5, 0.5, 1], min: 0, max: 1, step: 0.01 };
  if (control === 'vector2') return { d: [0, 1], min: -1, max: 1, step: 0.005 };
  if (control === 'text') return { d: '', min: 0, max: 1, step: 0 };
  if (control === 'select') return { d: (cp.options && cp.options[0]) || 'None', min: 0, max: 1, step: 0 };
  if (t === 'Int32' || t === 'Byte') return { d: 0, min: 0, max: 64, step: 1 };
  if (t === 'Single') return { d: 0.5, min: 0, max: 1, step: 0.005 };
  return { d: 0.5, min: 0, max: 1, step: 0.005 };
}

/** Default parameter object for a new node instance. */
export function defaultParams(schema) {
  const out = {};
  for (const p of schema) out[p.name] = Array.isArray(p.value) ? p.value.slice() : p.value;
  return out;
}
