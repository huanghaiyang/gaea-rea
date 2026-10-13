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
  hydraulicDroplet, hydraulicDropletMultiscale, streamPower, thermalTalus,
} from './kernels/erosion.js';
import {
  levelsRange, slope, heightKey, occlusion, distanceTransform, fractalTerraces, stepsNode,
  heightSelect, slopeSelect, maskSelect, angleSelect, dataSelect, seaLevel, snow, cracks,
  shift, shear, transformField, recurve,
} from './kernels/features.js';
import { gaeaLake } from './kernels/lake.js';
import { gaeaLichtenberg, gaeaOrigami, gaeaAperture, gaeaAccumulator } from './kernels/ops4.js';
import { gaeaGraphicEQ, gaeaPockmarks, gaeaOutcrops, gaeaRockMap, gaeaBulbous } from './kernels/ops3.js';
import { gaeaAngle, gaeaFilter, gaeaEdge, gaeaRoughen, gaeaCraggy } from './kernels/ops2.js';
import { gaeaHalftone, HALFTONE_PATTERN_NAMES } from './kernels/halftone.js';
import { gaeaCLUTer, CLUT_NAMES } from './clut.js';
import { gaeaThreshold, gaeaSoftClip, gaeaTerraces, gaeaPixelate, gaeaCurvature } from './kernels/ops.js';
import { AUTHORITATIVE_PARAMS, authoritativeParam } from './param-authority.js';
import { gaeaGamma, gaeaBlobRemover } from './kernels/imaging.js';
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
const OUT_C = (name = 'Output') => ({ name, kind: 'color' });

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
  // Halftone -- the second node backed by extracted vendor data.
  //
  // Its managed Build() is
  //
  //     RenderAsMask(true);
  //     Migrated.HalftoneProcess(input, Posterize ? Depth : (-1), Pattern, maps)
  //
  // `maps` is the threshold-map set and `Pattern` picks from it. THE ENUM IS IMAGEMAGICK'S MAP
  // SET: `HalftonePattern` has eighteen values and sixteen of them are threshold maps that
  // `tools/extract-magick.py` pulls out of Resources/Magick/thresholds.xml, with the enum value
  // lowerecased matching the map name for O2X2 through the six C-maps. Two pair by SHAPE rather
  // than name -- DIAG is `diag5x5` and HLINE is `hlines12x4` -- and `HALFTONE_PATTERNS` flags
  // those with `byName: true` so a reader can tell a recovered correspondence from an assumed one.
  //
  // The remaining two, FloydSteinberg and Riemersma, are NOT maps. They are error diffusion and
  // its Hilbert-curve variant, and neither can be a lookup because each cell's threshold depends
  // on the error carried in from cells already visited. Both are implemented as their published
  // algorithms, which is why the node is `approx` even though sixteen of its patterns are exact.
  {
    name: 'Halftone', algorithm: gaeaHalftone, category: CAT.FX,
    summary: 'Dithers the field with one of ImageMagick\'s threshold maps, or by error diffusion. Posterize off dithers to black and white.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: {
      Pattern: { d: 'FloydSteinberg', options: HALFTONE_PATTERN_NAMES, hint: 'Sixteen ordered maps decoded from Resources/Magick, plus two error-diffusion forms.' },
      Posterize: { d: false, hint: 'When off, Depth is passed as -1 and the result is binary.' },
      Depth: { d: 5, min: 2, max: 64, step: 1, hint: 'Only takes effect when Posterize is set.' },
    },
  },
  // CLUTer -- the first node wired to EXTRACTED VENDOR DATA rather than to a formula.
  //
  // Its managed Build() maps a grayscale height through `GradientData` and then applies Bias,
  // Hue, Saturation and Lightness:
  //
  //     Migrated.ClutterProcess(input.GrayscaleConversion(2), GradientData, gradient,
  //                             AutolevelInput, Reverse, Bias, Hue, Saturation, Lightness)
  //
  // `GradientData` is the gradient chosen in the UI's GradientEditor, and the eight `.clut`
  // files in Resources/Color are Gaea's built-in presets for that editor. They are now decoded
  // from `web/assets/color/*.png` (see tools/extract-assets.py), which is what makes this node
  // reproduce the vendor's OWN palettes instead of an invented ramp.
  //
  // The palettes are PNG textures, so decoding is async while kernels are synchronous. They are
  // decoded once by `preloadCLUTs()` and cached; a palette that has not loaded falls back to a
  // grey ramp and `clutStatus()` reports which. Silent fallback would make a missing asset look
  // like a desaturated image rather than an error.
  {
    name: 'CLUTer', algorithm: gaeaCLUTer, category: CAT.IO,
    summary: 'Maps a grayscale field through one of Gaea\'s eight built-in palette textures, then adjusts hue, saturation and lightness.',
    inputs: [H()], outputs: [OUT_C()], note: 'approx',
    params: {
      GradientData: { d: 'Rock', options: CLUT_NAMES, hint: 'One of Gaea\'s shipped CLUT presets, decoded from Resources/Color.' },
      Bias: { d: 0, min: -1, max: 1, step: 0.01, hint: 'Shifts the lookup position; distinct from Lightness.' },
      Hue: { d: 0, min: -1, max: 1, step: 0.01 },
      Saturation: { d: 0, min: -1, max: 1, step: 0.01 },
      Lightness: { d: 0, min: -1, max: 1, step: 0.01 },
    },
  },
  // FOUR MORE FROM THE COST-RANKED WORKLIST (round 38).
  //
  // Lichtenberg, Origami, Aperture and Accumulator, from Erosions.Lichtenberg,
  // Migrated.OrigamiProcess, Morphology2.Aperture and Texturize.GetAccumulation. Same
  // provenance as the three batches before: parameters exact, curves standard forms, all
  // `approx`.
  //
  // ACCUMULATOR IS THE FIRST GENERATOR IN THESE BATCHES. It takes no input at all -- the
  // managed parameter list contains only a Type, a RestrictToGroup flag and a computed Warning
  // -- so its `inputs` array is empty and its whole content is the type selector. That is why
  // the test asserts the TYPES are anti-correlated rather than merely different: two masks that
  // differed only by a shift would satisfy "different" while meaning nothing.
  //
  // One assertion-design note worth recording. The first version of that check COUNTED cells
  // where snow exceeded rain and demanded more than 60%; it returned exactly 128 of 256,
  // because for two monotone gradients the split falls on the median. The masks were perfectly
  // anti-correlated and the test was measuring where the crossover sat, not whether one existed.
  // The assertion now uses the sign of the correlation.
  {
    name: 'Lichtenberg', algorithm: gaeaLichtenberg, category: CAT.EROS,
    summary: 'Branching discharge channels, deepened by Depth and widened by Expand. Depth 0 is a no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Style: {}, Scale: {}, Complexity: {}, Depth: {}, Expand: {}, Bias: {}, Seed: {},
    },
  },
  {
    name: 'Origami', algorithm: gaeaOrigami, category: CAT.SHAPE,
    summary: 'Folds the terrain along creased planes; the fold is piecewise-linear, so both sides rise. Amount 0 is a no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { Amount: {}, Seed: {} },
  },
  {
    name: 'Aperture', algorithm: gaeaAperture, category: CAT.ADJ,
    summary: 'Polygon-shaped morphological opening or closing; every cell is bracketed by the Erode and Dilate results.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Mode: {}, Size: {}, Shape: {}, VerticesCount: {}, CornerAngle: {},
      Direction: {}, Antialiased: {},
    },
  },
  {
    name: 'Accumulator', algorithm: gaeaAccumulator, category: CAT.PRIM,
    summary: 'Generates a material-accumulation mask from its Type alone, taking no input.',
    inputs: [], outputs: [MASK('Output')], note: 'approx',
    params: {
      Type: { hint: 'Snow settles high, rain collects low; the two are anti-correlated.' },
      RestrictToGroup: { hint: 'A graph-level scope, not a numeric effect; not reproduced.' },
    },
  },
  // FIVE MORE FROM THE COST-RANKED WORKLIST (round 37).
  //
  // GraphicEQ, Pockmarks, Outcrops, RockMap and Bulbous. Provenance is unchanged: named Gaea
  // helpers (Profiles.GraphicEQ, Migrated.PockmarksProces, RockCore.Outcrops,
  // AspectMaps.RockMap, Migrated.BulbousProcess) whose bodies were not decompiled, so the
  // parameters and ranges are exact while the curves are standard forms.
  //
  // A SIXTH real bug turned up here, and it is the most instructive of the set. `Outcrops` and
  // `Pockmarks` both initialise their output field and then `continue` past cells that receive
  // no mark -- which silently left those cells at `createField`'s default of ZERO instead of
  // the input's value, erasing the terrain wherever nothing landed. The assertion that caught
  // it was the simplest one available: `Height: 0` should make the node an exact no-op.
  // A node that erases its input when it has nothing to add is not a no-op, and only a
  // no-op test says so.
  {
    name: 'GraphicEQ', algorithm: gaeaGraphicEQ, category: CAT.ADJ,
    summary: 'Seven-band equaliser over the height distribution. All bands at 1 is an identity.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Band1: {}, Band2: {}, Band3: {}, Band4: {}, Band5: {}, Band6: {}, Band7: {},
    },
  },
  {
    name: 'Pockmarks', algorithm: gaeaPockmarks, category: CAT.FX,
    summary: 'Scatters pits sized by Scale and thinned by Density; Invert turns them into bumps. Density 0 is a no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Size: {}, Scale: {}, Height: {}, Density: {}, Multiplier: {}, Invert: {}, Seed: {},
    },
  },
  {
    name: 'Outcrops', algorithm: gaeaOutcrops, category: CAT.FX,
    summary: 'Lays raised rock masses over the terrain, banded by Strata and optionally chipped. Density 0 is a no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Variations: {}, Strata: {}, Density: {}, Shape: {}, Chipped: {},
      Seed: {}, Size: {}, Height: {}, Rotation: {},
    },
  },
  {
    name: 'RockMap', algorithm: gaeaRockMap, category: CAT.MASK,
    summary: 'Masks where rock would sit, from slope against Coverage and Density. A flat field reads zero.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: { Coverage: {}, Density: {} },
  },
  {
    name: 'Bulbous', algorithm: gaeaBulbous, category: CAT.SHAPE,
    summary: 'Inflates or deflates the terrain masses; monotone in the input, with Jitter breaking the smoothness.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { Scale: {}, Jitter: {} },
  },
  // FIVE MORE NODES FROM THE COST-RANKED WORKLIST (round 36).
  //
  // Angle, Filter, Edge, Roughen and Craggy. Same provenance as the batch above: each calls a
  // named Gaea helper (AspectMaps.GetAngle, FilterCore.FilterProcess, Migrated.EdgeProcess,
  // Migrated.RoughenProcess, Migrated.CraggyProcess) whose body was not decompiled, so the
  // parameters and ranges are exact while the curves are standard published forms.
  //
  // The test turned up a fifth real bug: the low-pass branch returned `low + detail`, which is
  // the identity, so `Filter` did nothing at Gain 1 and the variance was unchanged to the
  // digit. The assertion that caught it was the most obvious one available -- a low-pass must
  // reduce variance -- which is worth noting, because round 35's four bugs were all caught by
  // equivalently simple property checks rather than by anything elaborate.
  {
    name: 'Angle', algorithm: gaeaAngle, category: CAT.MASK,
    summary: 'Marks how much the terrain faces an azimuth. A flat cell reads 0, having no aspect.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: { Azimuth: {}, Range: {}, Falloff: { hint: 'Widens the cutoff around the range.' } },
  },
  {
    name: 'Filter', algorithm: gaeaFilter, category: CAT.ADJ,
    summary: 'Low, high or band-passes the field at Frequency, with Gain on the selected band and KeepDC preserving the mean.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Mode: { hint: 'LowPass keeps the base, HighPass keeps the detail.' },
      Frequency: {}, Gain: {}, Q: {},
      KeepDC: { hint: 'Restores the input mean, which a band gain would otherwise shift.' },
    },
  },
  {
    name: 'Edge', algorithm: gaeaEdge, category: CAT.MASK,
    summary: 'Traces sharp boundaries: a gradient detector at the requested scale, with square or round weighting.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: { Style: {}, Size: {}, Pixels: {}, Softness: {} },
  },
  {
    name: 'Roughen', algorithm: gaeaRoughen, category: CAT.FX,
    summary: 'Adds oriented or isotropic noise displacement. Depth 0 is a strict no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { Width: {}, Depth: {}, Oriented: {}, Quality: {} },
  },
  {
    name: 'Craggy', algorithm: gaeaCraggy, category: CAT.FX,
    summary: 'Adds craggy relief at Size, with Shape trading smooth noise for ridged. Depth 0 is a strict no-op.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { Size: {}, Depth: {}, Shape: {}, Seed: {} },
  },
  // FIVE SMALL NODES FROM THE COST-RANKED WORKLIST (round 35).
  //
  // Each calls a named Gaea helper whose operation is fixed by the node's own parameters:
  // AspectMaps.GetThreshold, the SoftClip helper, Profiles.Terrace, Others.PixelateHeightfield
  // and AspectMaps.GetCurvature. The helper bodies live in the managed assembly and were NOT
  // decompiled, so every one of these is `approx`: the parameter shapes and ranges are exact
  // (taken from the [Parameter(...)] attributes) but the easing curves are published standard
  // forms, not transcriptions.
  //
  // Three real bugs were found while writing these and are recorded where they were fixed:
  // Terraces did not quantise at all (the exponent sat on the fractional part, cancelling to
  // the identity), the Curvature window returned 0.5 on flat ground instead of 0, and Concave
  // folded the Laplacian through Math.abs so both types returned the same mask. A fourth,
  // subtler one: the discrete Laplacian `neighbourMean - centre` is NEGATIVE at a peak, so the
  // convex branch had to be `-lap`, not `+lap` -- the test caught it as a ridge reading 0.
  {
    name: 'Threshold', algorithm: gaeaThreshold, category: CAT.MASK,
    summary: 'Splits the field at Level into a binary mask. The level is inclusive.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: { Level: { hint: 'Cells at or above this become 1; a strict test would darken a field sitting exactly on the level.' } },
  },
  {
    name: 'SoftClip', algorithm: gaeaSoftClip, category: CAT.ADJ,
    summary: 'Pulls values past a threshold back with a smooth knee; Softness 0 degenerates to a hard clip.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      ClipMode: { hint: 'AboveThreshold pulls high values down; BelowThreshold pulls low values up.' },
      Threshold: {}, Softness: {}, Clipping: {},
    },
  },
  {
    name: 'Terraces', algorithm: gaeaTerraces, category: CAT.SHAPE,
    summary: 'Quantises the field into NumTerraces bands, with Uniformity trading even spacing for jitter.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: { NumTerraces: {}, Uniformity: {}, Steepness: {}, Intensity: {}, Seed: {} },
  },
  {
    name: 'Pixelate', algorithm: gaeaPixelate, category: CAT.ADJ,
    summary: 'Block-averages the field to Size, with Antialias off giving exactly one value per block.',
    inputs: [H()], outputs: [OUT_H()], note: 'approx',
    params: {
      Size: {}, Autosize: { hint: 'Overrides Size with a fixed scale.' }, Antialias: {},
    },
  },
  {
    name: 'Curvature', algorithm: gaeaCurvature, category: CAT.MASK,
    summary: 'Marks where the field bends, as a mask in Range. Convex lights peaks, Concave lights pits.',
    inputs: [H()], outputs: [MASK('Output')], note: 'approx',
    params: { Range: {}, Type: {}, Falloff: {} },
  },
  // THE THREE GENUINE NO-OPS.
  //
  // `Chokepoint`, `Gate` and `Route` each have a Build() whose entire body is
  // `Commit(input.Copy(), true, true)` -- one statement, no locals, no delegation. That is not
  // a stub standing in for missing work: the vendor descriptions say so outright. Chokepoint
  // exists to break the evaluation cache, Gate "defines a baking boundary ... by forcing all
  // ancestors to bake", and Route "chooses the flow of the graph" -- all graph-level effects
  // that leave the data untouched. Implementing them as a forward is an EXACT reproduction of
  // what the managed code does, not an approximation of something unread.
  //
  // Shaper is deliberately NOT here even though the same detector flagged it. Its description
  // says it "bulks up or bulks down a terrain" and it carries Shape, Local Effect, Local Area,
  // Maintain Fine Details and Detail Size parameters, so it must do real work somewhere this
  // build has not looked. Registering it as a forward would have hidden that.
  {
    name: 'Chokepoint', algorithm: passthrough, category: CAT.SHAPE,
    summary: 'A no-op whose purpose is to break the evaluation cache. Recovered from the managed Build(), which is a bare input copy.',
    inputs: [H()], outputs: [OUT_H()], note: 'exact',
    params: {},
  },
  {
    name: 'Gate', algorithm: passthrough, category: CAT.SHAPE,
    summary: 'Forces all ancestors to bake by defining a graph boundary; the data itself passes through unchanged.',
    inputs: [H()], outputs: [OUT_H()], note: 'exact',
    params: {},
  },
  {
    name: 'Route', algorithm: passthrough, category: CAT.SHAPE,
    summary: 'Selects the graph flow between inputs and outputs; the forwarded map is unchanged.',
    inputs: [H()], outputs: [OUT_H()], note: 'exact',
    params: { Choice: { hint: 'Selects which route is taken; the data itself is forwarded as-is.' } },
  },
  {
    name: 'BlobRemover', algorithm: gaeaBlobRemover, category: CAT.ADJ,
    summary: 'Terraces the field, labels connected regions, and removes those smaller than resolution.X * Range. Recovered from the managed Build() in Gaea.Nodes.',
    inputs: [H()], outputs: [OUT_H()],
    // `approx`: the terracing, the labelling, the 4-or-8 connectivity and the threshold
    // formula are transcribed; the merge rule for a removed component lives inside ImageMagick
    // and is inferred. See web/js/kernels/imaging.js.
    note: 'approx',
    params: {
      Range: { hint: 'The area threshold is resolution.X * Range, so it scales with the grid.' },
      Connectivity: { hint: 'Literally 4 or 8; they differ only on a corner-touching diagonal.' },
      'Enforce Quantization': { hint: 'Without terracing a height field has one component per cell.' },
      Quantization: {},
    },
  },
  {
    name: 'Gamma', algorithm: gaeaGamma, category: CAT.ADJ,
    summary: 'ImageMagick gamma correction: pow(v, 1/g), or AutoGamma, which chooses the gamma that maps the mean to mid-grey.',
    inputs: [H()], outputs: [OUT_H()],
    // `exact` on the formula: ImageMagick's operation is `pow(v, 1/gamma)` and `AutoGamma` is
    // `log(mean)/log(0.5)`, both published and deterministic. Recovered from the managed
    // source, which is where this node lives — Gaea.Native.dll has no gamma export because
    // the algorithm is the library's, not Gaea's. See web/js/kernels/imaging.js.
    note: 'exact',
    // No invented values: the catalogue's IL metadata (0.44, 0..4) and the managed source's
    // [Parameter(0.44f, 0f, 4f)] agree exactly, which is a cross-check between two artefacts.
    params: {
      Gamma: { hint: 'Raises midtones when above 1, because the exponent is 1/gamma.' },
      Automatic: { hint: 'Overrides Gamma; the manual value is ignored when set.' },
    },
  },
  {
    name: 'Lake', algorithm: gaeaLake, category: CAT.EROS,
    summary: 'Physically-plausible lake filling: a local-minimum descent, then a priority flood whose level is bisected over 9 iterations. Recovered from lake::lake_create in Gaea.Native.dll.',
    inputs: [H()], outputs: [OUT_H()],
    // `approx`: the descent, the flood's height ordering, the 9-step bisection and the 0.5
    // midpoint are all transcribed; the bisection's convergence test sits behind a lambda
    // vtable and is inferred. See web/js/kernels/lake.js.
    note: 'approx',
    // No invented values: the catalogue's IL defaults are what the real UI sends. X and Y are
    // normalised -1..1 and map to the seed cell; Water Level is the native guard's operand.
    params: {
      Type: {},
      X: {},
      Y: {},
      'Water Level': { hint: 'The native guard is `0 < Water Level`, so zero produces no lake.' },
      'Render Surface': {},
      Accuracy: {},
      Precipitation: {},
      'Small Lakes': {},
      'Flood Control': {},
      'Water Floor': {},
      'Shore Size': {},
      'Altitude Bias': {},
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
    name: 'Erosion2', algorithm: hydraulicDropletMultiscale, category: CAT.EROS,
    summary: 'Multiscale particle erosion on a Laplacian pyramid: levels are eroded coarse-to-fine, which is what produces long connected valleys instead of isolated scratches.',
    inputs: [H()], outputs: [OUT_H()],
    note: 'model',
    params: {
      // No invented values here. Defaults and ranges come from the vendor catalogue's IL
      // metadata, which is what the real UI sends — see
      // docs/erosion2-parameter-correspondence.md. The native PE() signature declares
      // different fallbacks (SuspendedLoadDischargeAngle 24, BedLoadDischargeAngle 15,
      // ShapeDetailScale 0.8) but those apply only when the node passes no argument, so the
      // catalogue values are the effective ones.
      Duration: { hint: 'Droplet budget = Duration * 0.8 * N^2, scaled from the real 1..200 range.' },
      Downcutting: {},
      'Erosion Scale': { hint: 'Mapped onto the erosion brush radius, scaled from the real 1..20000 range.' },
      Seed: {},
      NoErosion: {},
      'Suspended Load': { hint: 'Sediment capacity constant.' },
      // Three distinct parameters share this label, in catalogue order after each load type.
      // Storage keys are SuspendedLoadDischargeAngle / BedLoadDischargeAngle /
      // CoarseSedimentsDischargeAngle; see PARAM_KEY_ALIASES.
      'Discharge Angle': { hint: 'Slope at which suspended load settles.' },
      'Bed Load': {},
      'Coarse Sediments': {},
      DepositionBoost: {},
      // ExtraDepositionBoost and Enable carry no IL default in the catalogue, so without
      // these overrides mergeParam would fall back to the generic per-type default — 0.5
      // for a Single and FALSE for a toggle. Enable false disables the solver outright,
      // which is how this was caught: Erosion2 stopped removing any material at all
      // (mean 0.33467 -> 0.33467).
      ExtraDepositionBoost: { d: 0 },
      Enable: { d: true },
      Shape: {},
      'Shape Sharpness': {},
      'Shape Detail Scale': {},
      'Directional Precipitation': {},
      Direction: {},
      'Rain Shadow': {},
      Slope: { kind: 'vector2' },
      Altitude: { kind: 'vector2' },
      Reverse: {},
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
 * Vendor parameter names that repeat within one node, and the stable key each occurrence
 * should get. Keyed by node, then display name, then occurrence index.
 *
 * WHY THIS EXISTS
 * Gaea's own catalogue lists three distinct parameters all named "Discharge Angle" for
 * Erosion2 — one after each load type — and its `description` for all three is the same
 * sentence, so only POSITION distinguishes them. A name-keyed object cannot hold them, and
 * the previous `buildSchema` dropped the 2nd and 3rd on the floor
 * (`if (seen.has(cp.name)) continue`), silently removing two real parameters.
 *
 * The mapping is declared explicitly rather than inferred from "the parameter preceding
 * it", because deriving a key from a neighbour would put one node's vocabulary inside a
 * generic function and would quietly mis-key any other node that has duplicates.
 */
const PARAM_KEY_ALIASES = {
  Erosion2: {
    'Discharge Angle': [
      'SuspendedLoadDischargeAngle',
      'BedLoadDischargeAngle',
      'CoarseSedimentsDischargeAngle',
    ],
  },
};

/**
 * Build a per-node parameter schema by merging the vendor catalog with registry overrides.
 * Unknown parameters are never dropped: they receive a generic default and control kind
 * derived purely from their declared type, which is what makes arbitrary nodes usable.
 *
 * Every entry gets a unique `key` for storage, separate from `name`, which is the label
 * shown to the user. For almost every node the two are identical, so `key` only becomes
 * load-bearing where the vendor catalogue repeats a name.
 */
export function buildSchema(catalogNode, registryNode) {
  const overrides = (registryNode && registryNode.params) || {};
  const aliases = (catalogNode && PARAM_KEY_ALIASES[catalogNode.name]) || {};
  const seen = new Map();
  const params = [];
  for (const cp of (catalogNode ? catalogNode.params : [])) {
    const nth = seen.get(cp.name) || 0;
    seen.set(cp.name, nth + 1);
    // A duplicated label gets an alias key for EVERY occurrence, the first included: once a
    // name is ambiguous the plain name is not a usable key, so "keep the first as-is" would
    // leave one entry addressable only by a label that three entries share.
    const aliasList = aliases[cp.name];
    const key = aliasList
      ? (aliasList[nth] || `${cp.name} #${nth + 1}`)
      : cp.name;
    const nodeName = catalogNode ? catalogNode.name : '';
    const auth = (AUTHORITATIVE_PARAMS[nodeName] || {})[cp.name] || null;
    const ov = authoritativeParam(nodeName, cp.name, overrides[cp.name] || {});
    params.push(mergeParam(cp, ov, key, auth));
  }
  // Registry-only params (e.g. for nodes whose catalog entry is missing a control)
  for (const [name, ov] of Object.entries(overrides)) {
    if (seen.has(name)) continue;
    seen.set(name, true);
    const nodeName = catalogNode ? catalogNode.name : '';
    params.push(mergeParam({ name, type: null, control: null, description: '' },
      authoritativeParam(nodeName, name, ov), name,
      (AUTHORITATIVE_PARAMS[nodeName] || {})[name] || null));
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

/**
 * @param {object} cp  the catalog parameter record
 * @param {object} ov  the registry override
 * @param {string} key the unique storage key; equals `cp.name` unless the name repeats
 */
function mergeParam(cp, ov, key, auth) {
  const control = resolveControl(cp, ov);
  const generated = genericDefault(cp, control);

  // Provenance of every number, so the UI and the docs can state where it came from:
  //   'authority' – the [Parameter(default,min,max)] attribute read out of the managed
  //                 assembly. This is what the runtime actually uses, so it outranks a
  //                 hand-authored value: an audit found 113 of 224 registry parameters
  //                 disagreeing with it, some wildly (Blur.Radius was 4.0 / 0..128 where the
  //                 attribute says 0.1 / 0..2).
  //   'registry'  – hand-authored here, and only consulted when the table is silent
  //   'il'        – the vendor catalogue's ilDefault/ilMin/ilMax
  //   'type'      – a conservative per-type fallback
  let value, defSrc;
  // `auth.d` may be absent even when `auth` exists: an attribute whose default is an enum
  // member or a Boolean carries only a numeric RANGE, which the extractor records without a
  // default. Testing `if (auth)` alone set the value to undefined for every such parameter —
  // which read as `Enable = undefined`, and `Enable` is Erosion2's master gate, so the solver
  // silently stopped running. The default must fall through to the next source instead.
  if (auth && auth.d !== undefined) { value = auth.d; defSrc = 'authority'; }
  else if (ov.d !== undefined) { value = ov.d; defSrc = 'registry'; }
  else if (cp.ilDefault !== undefined) { value = cp.ilDefault; defSrc = 'il'; }
  else { value = generated.d; defSrc = 'type'; }

  let min, max, rangeSrc;
  if (auth && auth.min !== undefined && auth.max !== undefined) {
    min = auth.min;
    max = auth.max;
    rangeSrc = 'authority';
  } else if (ov.min !== undefined || ov.max !== undefined) {
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
    // Storage identity. Equal to `name` unless the vendor catalogue repeats the label, in
    // which case the duplicates carry the keys declared in PARAM_KEY_ALIASES.
    key: key || cp.name,
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

/**
 * Default parameter object for a new node instance.
 *
 * Keyed by `p.key`, not `p.name`. For nearly every parameter the two are the same string;
 * they differ only where the vendor catalogue repeats a label, and there the key is what
 * keeps the entries from overwriting each other.
 */
export function defaultParams(schema) {
  const out = {};
  for (const p of schema) {
    out[p.key || p.name] = Array.isArray(p.value) ? p.value.slice() : p.value;
  }
  return out;
}
