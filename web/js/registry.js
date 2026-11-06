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
import { gaeaShaper, gaeaLinearGradient, gaeaRadialGradient, gaeaCone, gaeaHemisphere, gaeaHSL, gaeaFold, gaeaSwirl, gaeaShape, gaeaMedian, gaeaCompare, gaeaRGBMerge, gaeaRGBSplit, gaeaSeamless, gaeaRepeat, gaeaSoil, gaeaPeaks, gaeaTranspose, gaeaSharpen, gaeaContours } from './kernels/profiles.js';
import { AUTHORITATIVE_PARAMS, authoritativeParam } from './param-authority.js';
import { gaeaGamma, gaeaBlobRemover } from './kernels/imaging.js';
import { createField } from './kernel/field.js';
import * as REMAINING from './kernels/remaining.js';

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
    summary: 'Perlin fBm/billowy/ridged from the recovered FastNoiseSIMD kernel.',
    inputs: [], outputs: [OUT_H()],
    note: 'exact (warp approximate)',
    params: {
      Type: { d: 'FBM' },
      Scale: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Octaves: { d: 10, min: 1, max: 14, step: 1 },
      Gain: { d: 0.5, min: 0, max: 1, step: 0.01 },
      Height: { d: 1, min: 0, max: 1, step: 0.01 },
      Seed: { d: 0, min: 0, max: 99999, step: 1 },
      Warp: { d: 'Complex', options: ['None', 'Simple', 'Complex'] },
      Frequency: { d: 0.05, min: 0, max: 1, step: 0.01 },
      Amplitude: { d: 0.5, min: 0, max: 1, step: 0.01 },
      'Warp Octaves': { d: 10, min: 1, max: 14, step: 1 },
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
    name: 'Shaper',
    note: 'exact', algorithm: gaeaShaper, category: CAT.SHAPE,
    summary: 'Bulks a terrain up or down with an exponential shape curve; can act on local regions only and preserve fine detail.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Shape: { d: 0, min: -1, max: 1, step: 0.01, hint: 'Negative bulks down, positive bulks up.' },
      'Local Effect': { d: false },
      'Local Area': { d: 0.5, min: 0, max: 1, step: 0.01 },
      'Maintain Fine Details': { d: false },
      'Detail Size': { d: 0.75, min: 0, max: 1, step: 0.01 },
    },
  },
  {
    name: 'Shape',
    note: 'exact', algorithm: gaeaShape, category: CAT.SHAPE,
    summary: 'Circle or rectangle outline (ring) of a chosen thickness, scaled by Height.',
    inputs: [], outputs: [OUT_H()],
    params: {
      Geometry: { d: 'Circle' },
      Sides: { d: 3, min: 3, max: 256, step: 1, hint: 'Only Circle and Rectangle are produced by this build.' },
      Uniform: { d: true },
      Scale: { d: 0.5, min: 0.0001, max: 2, step: 0.01 },
      'Scale X': { d: 0.5, min: 0.0001, max: 2, step: 0.01 },
      'Scale Y': { d: 0.5, min: 0.0001, max: 2, step: 0.01 },
      Thickness: { d: 0.1, min: 0.0001, max: 1, step: 0.01 },
      Height: { d: 1, min: 0.0001, max: 1, step: 0.01 },
      X: { d: 0.5, min: 0, max: 1, step: 0.005 },
      Y: { d: 0.5, min: 0, max: 1, step: 0.005 },
    },
  },
  {
    name: 'LinearGradient', note: 'exact', algorithm: gaeaLinearGradient, category: CAT.SHAPE,
    summary: 'Directional linear ramp; multiplies the optional input.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Scale: { d: 1, min: 0, max: 4, step: 0.01 },
      Direction: { d: 0, min: 0, max: 360, step: 1 },
      'Edge Behavior': { d: 'Clip' },
    },
  },
  {
    name: 'RadialGradient', note: 'exact', algorithm: gaeaRadialGradient, category: CAT.SHAPE,
    summary: 'Smooth radial falloff (smoothstepped), positioned by X/Y.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Scale: { d: 1, min: 0, max: 4, step: 0.01 },
      Height: { d: 1, min: 0, max: 1, step: 0.01 },
      X: { d: 0.5, min: 0, max: 1, step: 0.005 },
      Y: { d: 0.5, min: 0, max: 1, step: 0.005 },
    },
  },
  {
    name: 'Cone', note: 'exact', algorithm: gaeaCone, category: CAT.SHAPE,
    summary: 'Linear (non-smoothstepped) radial cone.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Scale: { d: 1, min: 0, max: 4, step: 0.01 },
      Height: { d: 1, min: 0, max: 1, step: 0.01 },
      X: { d: 0.5, min: 0, max: 1, step: 0.005 },
      Y: { d: 0.5, min: 0, max: 1, step: 0.005 },
    },
  },
  {
    name: 'Hemisphere', note: 'exact', algorithm: gaeaHemisphere, category: CAT.SHAPE,
    summary: 'Spherical dome; Flatten gives the squarer hemisphere variant.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Scale: { d: 1, min: 0, max: 4, step: 0.01 },
      Height: { d: 1, min: 0, max: 1, step: 0.01 },
      X: { d: 0.5, min: 0, max: 1, step: 0.005 },
      Y: { d: 0.5, min: 0, max: 1, step: 0.005 },
      Flatten: { d: false },
    },
  },
  {
    name: 'HSL', note: 'exact', algorithm: gaeaHSL, category: CAT.FX,
    summary: 'Hue shift and absolute saturation/lightness scaling on a colour field.',
    inputs: [{ name: 'Input', kind: 'color' }], outputs: [OUT_C()],
    params: {
      Hue: { d: 0, min: -1, max: 1, step: 0.005 },
      Saturation: { d: 0, min: -1, max: 1, step: 0.005 },
      Lightness: { d: 0, min: -1, max: 1, step: 0.005 },
    },
  },
  {
    name: 'Fold', note: 'exact', algorithm: gaeaFold, category: CAT.WARP,
    summary: 'Sine / Triangle / Sawtooth folding of the heightfield; the mask scales the fold count.',
    inputs: [H(), MASK('Folds Mask')], outputs: [OUT_H()],
    params: {
      Waveform: { d: 'Sine' },
      Folds: { d: 2, min: 0, max: 10, step: 0.05 },
      Symmetric: { d: true },
    },
  },
  {
    name: 'Swirl', note: 'exact', algorithm: gaeaSwirl, category: CAT.WARP,
    summary: 'Rotational twist around X/Y with the rotation proportional to radius.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Size: { d: 0.15, min: 0, max: 1, step: 0.005 },
      X: { d: 0.5, min: 0, max: 1, step: 0.005 },
      Y: { d: 0.5, min: 0, max: 1, step: 0.005 },
    },
  },
  {
    name: 'Seamless', note: 'exact', algorithm: gaeaSeamless, category: CAT.COMB,
    summary: 'Makes the field tileable by cross-fading shifted copies along X and Y.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Edge: { d: 0.5, min: 0, max: 1, step: 0.005 },
      'Shift X': { d: 0.5, min: 0, max: 1, step: 0.005 },
      'Shift Y': { d: 0.5, min: 0, max: 1, step: 0.005 },
    },
  },
  {
    name: 'Repeat', note: 'model', algorithm: gaeaRepeat, category: CAT.COMB,
    summary: 'Tiles the field; the shipped tile shrink uses a Lanczos resampler that is not ported yet, so tile-edge pixels differ slightly.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Tiles: { d: 2, min: 2, max: 50, step: 1 },
      'Compensate Height': { d: false },
      Height: { d: 1, min: 0.1, max: 10, step: 0.05 },
    },
  },
  {
    name: 'Soil', note: 'model', algorithm: gaeaSoil, category: CAT.SHAPE,
    summary: 'Granular soil relief from five stacked blur differences; blur borders are modelled (interior exact).',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Amount: { d: 0.6, min: 0, max: 1, step: 0.01 },
      Bias: { d: 0, min: -1, max: 1, step: 0.01 },
    },
  },
  {
    name: 'Peaks', note: 'model', algorithm: gaeaPeaks, category: CAT.MASK,
    summary: 'High-frequency spectral peaks via graphic EQ; blur borders are modelled (interior exact).',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Falloff: { d: 0, min: -1, max: 1, step: 0.01 },
      Precise: { d: false },
    },
  },
  {
    name: 'Transpose', note: 'model', algorithm: gaeaTranspose, category: CAT.COMB,
    summary: 'Transposes, embeds or inserts a reference relief into the terrain; all three modes are oracle-verified.',
    inputs: [H(), H('Reference')], outputs: [OUT_H()],
    params: {
      Mode: { d: 'Transpose' },
      Amount: { d: 1, min: 0, max: 1, step: 0.01 },
      Extend: { d: 0, min: 0, max: 1, step: 0.01 },
      Flatten: { d: 0, min: 0, max: 1, step: 0.01 },
      Threshold: { d: 0.01, min: 0, max: 1, step: 0.005 },
      Boundary: { d: 0.3, min: 0, max: 1, step: 0.01 },
    },
  },
  {
    name: 'Sharpen', note: 'model', algorithm: gaeaSharpen, category: CAT.ADJ,
    summary: 'Edge mode adds scaled vertical curvature (exact); Frequency mode boosts the top GraphicEQ band.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Method: { d: 'Edge' },
      Amount: { d: 0.5, min: 0, max: 5, step: 0.01 },
    },
  },
  {
    name: 'Contours', note: 'model', algorithm: gaeaContours, category: CAT.MASK,
    summary: 'Contour lines from two nested terrace bands (Count/Subdivision), with line thickness via cross dilation.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Count: { d: 36, min: 2, max: 200, step: 1 },
      Subdivision: { d: 6, min: 2, max: 20, step: 1 },
      Accuracy: { d: 0.7, min: 0, max: 1, step: 0.01 },
      'Line Intensity': { d: 1, min: 0, max: 2, step: 0.01 },
      'Sub Intensity': { d: 0.25, min: 0, max: 2, step: 0.01 },
      'Line Thickness': { d: 1, min: 1, max: 10, step: 1 },
    },
  },
  {
    name: 'Median', note: 'exact', algorithm: gaeaMedian, category: CAT.ADJ,
    summary: 'Smoothed median blur; Classic and Advanced differ only in the filter window.',
    inputs: [H()], outputs: [OUT_H()],
    params: {
      Mode: { d: 'Classic' },
      Strength: { d: 'X1' },
      Horizontal: { d: 2, min: 2, max: 50, step: 1 },
      Vertical: { d: 2, min: 2, max: 50, step: 1 },
      Iterations: { d: 1, min: 1, max: 50, step: 1 },
      Quality: { d: 'Medium', hint: 'ResolutionIndependent mode is modelled, not ported.' },
    },
  },
  {
    name: 'Compare', note: 'exact', algorithm: gaeaCompare, category: CAT.COMB,
    summary: 'A/B split comparison between two fields (hard threshold at A/B).',
    inputs: [H('A'), H('B')], outputs: [OUT_H()],
    params: {
      'A/B': { d: 0.5, min: 0, max: 1, step: 0.005 },
      Colorized: { d: true },
      Perpendicular: { d: false },
      Swap: { d: false },
    },
  },
  {
    name: 'RGBMerge', note: 'exact', algorithm: gaeaRGBMerge, category: CAT.FX,
    summary: 'Combine three height fields into one RGB colour field.',
    inputs: [H('R'), H('G'), H('B')], outputs: [OUT_C()],
    params: {
      'Enhance R': { d: 'None' },
      'Enhance G': { d: 'None' },
      'Enhance B': { d: 'None' },
    },
  },
  {
    name: 'RGBSplit', note: 'model', algorithm: gaeaRGBSplit, category: CAT.FX,
    summary: 'Colour field to grayscale; Gaea also exposes separate R/G/B outputs, which this single-output graph model cannot carry.',
    inputs: [{ name: 'Input', kind: 'color' }], outputs: [OUT_H()],
    params: {
      'Autolevel Channels': { d: false },
      Method: { d: 'BT601' },
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

  /* ---------------------------------------------------------- remaining Gaea nodes */
{
    name: 'Shatter',
    algorithm: REMAINING.shatter,
    category: CAT.SHAPE,
    summary: 'Shatter transforms simple shapes into complex, highly eroded, and fractured terrains.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'VariableBlur',
    algorithm: REMAINING.variableBlur,
    category: CAT.ADJ,
    summary: 'Blurs the input by varying the blur amount across the surface using local data or a guide.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'Grid',
    algorithm: REMAINING.gridNode,
    category: CAT.MASK,
    summary: 'Generates a regular grid pattern useful for cartography, masking, or stylized surfaces.',
    inputs: [], outputs: [MASK('Output')],
    note: 'approx',
  },

  {
    name: 'Hillify',
    algorithm: REMAINING.hillify,
    category: CAT.EROS,
    summary: 'Softens and reshapes terrain into smoother, hill-like forms.',
    inputs: [{ name: 'Input', kind: 'height' }],
    outputs: [OUT_H(), MASK('Wear')],
    note: 'model',
  },

  {
    name: 'Stratify',
    algorithm: REMAINING.stratify,
    category: CAT.SHAPE,
    summary: 'Stratify creates broken strata or rock layers on the terrain in a non-linear fashion, producing a robust, realistic formation.',
    inputs: [{ name: 'Input', kind: 'height' }],
    outputs: [OUT_H(), MASK('Terraces')],
    note: 'model',
  },

  {
    name: 'Island',
    algorithm: REMAINING.island,
    category: CAT.SHAPE,
    summary: 'Island draws basic shapes from which entire landmasses can be generated.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'MountainRange',
    algorithm: REMAINING.mountainRange,
    category: CAT.SHAPE,
    summary: 'Range primitive quickly sets up an entire mountain terrain with shapes highly optimized for eroding large-scale landscapes.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Plates',
    algorithm: REMAINING.plates,
    category: CAT.SHAPE,
    summary: 'Plates primitive is based on a Perlin core with flat plate-like formations created in between larger Perlin-esque shapes.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'SlopeBlur',
    algorithm: REMAINING.slopeBlur,
    category: CAT.ADJ,
    summary: 'SlopeBlur is a versatile, low-level node that adds directional blurring based on the slopes of a Guide terrain or mask. It is one of our deceptively simple nodes that can create a wide array of shapes.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'SlopeWarp',
    algorithm: REMAINING.slopeWarp,
    category: CAT.WARP,
    summary: 'SlopeBlur is a versatile, low-level node that adds directional warping based on the slopes of a Guide terrain or mask. It behaves similarly to SlopeBlur.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'Sandstone',
    algorithm: REMAINING.sandstone,
    category: CAT.SHAPE,
    summary: 'Creates layered sandstone-like terracing and sedimentary rock structure.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Sunlight',
    algorithm: REMAINING.sunlight,
    category: CAT.FX,
    summary: 'Sunlight is a Data Map that gives you the sunlight integral (sun light/shadow map) of any given period (up to 365 days). It can be used to drive snow melt, vegetation growth, and more.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'DuneSea',
    algorithm: REMAINING.duneSea,
    category: CAT.SHAPE,
    summary: 'Creates broad fields of dune-like terrain suitable for deserts and wind-shaped landscapes.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Sand',
    algorithm: REMAINING.sand,
    category: CAT.SHAPE,
    summary: 'Sand creates medium and small level sand patterns. It can also be used to simulate dunes.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'WaveShine',
    algorithm: REMAINING.waveShine,
    category: CAT.SHAPE,
    summary: 'Generates wave-like reflective or rippling patterns useful for stylized surfaces and water-like forms.',
    inputs: [], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'Stones',
    algorithm: REMAINING.stones,
    category: CAT.SHAPE,
    summary: 'Scatters stones or small rock forms across the surface.',
    inputs: [{ name: 'Input', kind: 'height' }],
    outputs: [OUT_H(), MASK('Difference')],
    note: 'model',
  },

  {
    name: 'HydroFix',
    algorithm: REMAINING.hydroFix,
    category: CAT.EROS,
    summary: 'HydroFix alters the terrain to create continuous drainage network friendly slopes. It can be used before Erosion or other flow related nodes to get better results.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'SuperColor',
    algorithm: REMAINING.superColor,
    category: CAT.FX,
    summary: 'Applies procedural terrain colorization using texture, flow, peaks, and palette controls.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_C()],
    note: 'approx',
  },

  {
    name: 'DriftNoise',
    algorithm: REMAINING.driftNoise,
    category: CAT.PRIM,
    summary: 'DriftNoise is a unique primitive that can create overlapping "shelves". It is a versatile primitive noise that can be used in various scenarios from cliffs to crack production.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'GroundTexture',
    algorithm: REMAINING.groundTexture,
    category: CAT.FX,
    summary: 'GroundTexture adds superficial detail to the terrain to increase realism.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'PointCloud',
    algorithm: REMAINING.pointCloud,
    category: CAT.IO,
    summary: 'Exports the terrain as a point cloud in formats such as PLY, XYZ, or CSV.',
    inputs: [], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Trees',
    algorithm: REMAINING.trees,
    category: CAT.MASK,
    summary: 'The Arboreal Node gives you the power of creating superficial forests and vegetation. These forests are part of the heightfield while being "detached" enough for various export scenarios.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }, { name: 'Mask 3', kind: 'height' }, { name: 'Mask 4', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'Rockscape',
    algorithm: REMAINING.rockscape,
    category: CAT.SHAPE,
    summary: 'Creates broad rocky surface formations and broken stone-like terrain detail.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'CraterField',
    algorithm: REMAINING.craterField,
    category: CAT.SHAPE,
    summary: 'Creates a landscape full of craters.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Gabor',
    algorithm: REMAINING.gabor,
    category: CAT.PRIM,
    summary: 'Gabor noise is one of the lesser used noises, but provides a wonderful pattern-friendly noise that can be used to simulate various aspects of nature.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Slump',
    algorithm: REMAINING.slump,
    category: CAT.EROS,
    summary: 'Slump is a simple primitive that creates relative smooth hills with slumped (collapsed) areas. It is very useful for creating large landscapes.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'ThermalShaper',
    algorithm: REMAINING.thermalShaper,
    category: CAT.EROS,
    summary: 'ThermalShaper is a fast, basic simulation of the concavity and convexity that can be achieved from thermal erosion. The effect can be exaggerated for artistic effect.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Mesher',
    algorithm: REMAINING.mesher,
    category: CAT.IO,
    summary: 'Mesher can save specific nodes as meshes instead of heightfields, and can also generate LODs.',
    inputs: [], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Thermal2',
    algorithm: REMAINING.thermal2,
    category: CAT.EROS,
    summary: 'Thermal2 is an evolution of the previous node. It creates Thermal Erosion to create realistic talus and debris.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Input 2', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'MathX',
    algorithm: REMAINING.mathX,
    category: CAT.COMB,
    summary: 'Evaluates mathematical expressions to generate or modify terrain data procedurally.',
    inputs: [{ name: 'A', kind: 'height' }, { name: 'B', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'Scree',
    algorithm: REMAINING.scree,
    category: CAT.SHAPE,
    summary: 'Creates accumulations of loose rock fragments scattered across slopes and terrain edges.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask', kind: 'height' }],
    outputs: [OUT_H(), MASK('Difference')],
    note: 'model',
  },

  {
    name: 'Reseed',
    // `reseed: true` switches the evaluator to Gaea's clone-and-rebuild semantics instead of
    // calling the (now unused) kernel. The kernel is kept as a plain field-level fallback.
    reseed: true,
    algorithm: REMAINING.reseed,
    category: CAT.COMB,
    summary: 'Re-randomizes an upstream procedural node by overriding or refreshing its seed behavior.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'Match',
    algorithm: REMAINING.match,
    category: CAT.COMB,
    summary: 'Matches the height range or histogram of one terrain to another.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'Normals',
    algorithm: REMAINING.normals,
    category: CAT.FX,
    summary: 'Generates a normal map from the terrain for shading and downstream workflows.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_C()],
    note: 'approx',
  },

  {
    name: 'Unity',
    algorithm: REMAINING.unity,
    category: CAT.IO,
    summary: 'Exports terrain data in Unity-friendly resolutions and formats.',
    inputs: [], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Pattern',
    algorithm: REMAINING.patternNode,
    category: CAT.PRIM,
    summary: 'Generates repeatable geometric or decorative patterns for masking and stylized terrain work.',
    inputs: [], outputs: [MASK('Output')],
    note: 'approx',
  },

  {
    name: 'Transform3D',
    algorithm: REMAINING.transform3D,
    category: CAT.WARP,
    summary: 'Applies full 3D transformation to the terrain, including rotation and spatial adjustment.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'Rugged',
    algorithm: REMAINING.rugged,
    category: CAT.SHAPE,
    summary: 'Rugged is a very powerful primitive node that creates a strong, rocky surface for any terrain while preserving overall shape.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Tint',
    algorithm: REMAINING.tint,
    category: CAT.FX,
    summary: 'QuickColor quickly maps a 2-color gradient to any mask. Useful for simple scenarios where CLUTer would be overkill. ',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_C()],
    note: 'approx',
    params: {
      'Start': { d: [0.12, 0.16, 0.28, 1] },
      'End': { d: [0.85, 0.82, 0.72, 1] },
    },
  },

  {
    name: 'Var',
    algorithm: REMAINING.varNode,
    category: CAT.COMB,
    summary: 'Reads or modifies named graph variables for procedural control and automation.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'Volcano',
    algorithm: REMAINING.volcano,
    category: CAT.SHAPE,
    summary: 'Generates a volcanic landform with a central cone and crater structure.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Texturizer',
    algorithm: REMAINING.texturizer,
    category: CAT.FX,
    summary: 'Generates terrain texture masks using preset styles and controllable secondary effects.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'TextureBaker',
    algorithm: REMAINING.textureBaker,
    category: CAT.IO,
    summary: 'Bakes derived texture maps from the terrain for export and downstream use.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Item', kind: 'height' }], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Crumble',
    algorithm: REMAINING.crumble,
    category: CAT.EROS,
    summary: 'Crumble runs a different kind of simulation that feeds off of existing crevices, erosive information, and other subtle details to collapse the terrain. Just as the name implies, the terrain starts crumbling from the edges.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Meshify',
    algorithm: REMAINING.meshify,
    category: CAT.IO,
    summary: 'Converts terrain into a faceted, mesh-like surface with controllable vertex density and detail sensitivity.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Input 2', kind: 'height' }, { name: 'Mask', kind: 'height' }], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Uplift',
    algorithm: REMAINING.uplift,
    category: CAT.SHAPE,
    summary: 'Creates tectonic-style uplift by raising and shaping large terrain masses.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Synth',
    algorithm: REMAINING.synth,
    category: CAT.PRIM,
    summary: 'Synth takes a bitmap image (photo or artwork) and converts it to CLUT map that can be used with a texture mask to colorize your terrain.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_C()],
    note: 'approx',
  },

  {
    name: 'MacroPort',
    algorithm: REMAINING.macroPort,
    category: CAT.IO,
    summary: 'Defines an input or output port inside a macro for passing height, mask, or color data.',
    inputs: [], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Wizard',
    algorithm: REMAINING.wizard,
    category: CAT.EROS,
    summary: 'The Erosion Wizard is a lightweight wrapper for the Erosion node. It simplifies the settings through curated presets, and provides secondary passes for additional processing.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Noise',
    algorithm: REMAINING.noiseNode,
    category: CAT.PRIM,
    summary: 'Noise applies controlled single-pixel noise onto the terrain.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Sediments',
    algorithm: REMAINING.sediments,
    category: CAT.EROS,
    summary: 'Sediments creates a thick layer of generic sedimentation on top of the terrain, which can be used for sand or snow.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'Switch',
    algorithm: REMAINING.switchNode,
    category: CAT.COMB,
    summary: 'Switch chooses between two different heightfield inputs and relies on a boolean (true/false) input.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'FlowMapClassic',
    algorithm: REMAINING.flowMapClassic,
    category: CAT.EROS,
    summary: 'Generates a classic-style flow map based on legacy flow behavior.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'ColorErosion',
    algorithm: REMAINING.colorErosion,
    category: CAT.EROS,
    summary: 'Applies erosion-style transport and deposition to color data, creating more natural weathered color variation.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask', kind: 'height' }], outputs: [OUT_C()],
    note: 'model',
  },

  {
    name: 'RockNoise',
    algorithm: REMAINING.rockNoise,
    category: CAT.PRIM,
    summary: 'RockNoise is a useful tool for generating fields of rocks with size variations and controllable density.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'LoopBegin',
    algorithm: REMAINING.loopBegin,
    category: CAT.COMB,
    summary: 'Begins a Loop circuit.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Bomber',
    algorithm: REMAINING.bomber,
    category: CAT.SHAPE,
    summary: 'Bomber takes an input heightfield and "stamps" or bombs it across the entire terrain surface using the randomization properties you set.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Input 2', kind: 'height' }, { name: 'Mask', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Layers',
    algorithm: REMAINING.layers,
    category: CAT.COMB,
    summary: 'Combines multiple layers using blend operations in a stacked workflow.',
    inputs: [{ name: 'Layer 1', kind: 'height' }, { name: 'Layer 2', kind: 'height' }, { name: 'Layer 3', kind: 'height' }, { name: 'Layer 4', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Distress',
    algorithm: REMAINING.distress,
    category: CAT.MASK,
    summary: 'Adds superficial wear, breakup, and irregular damage to a surface.',
    inputs: [], outputs: [MASK('Output')],
    note: 'approx',
  },

  {
    name: 'AO',
    algorithm: REMAINING.ao,
    category: CAT.MASK,
    summary: 'Creates an ambient occlusion map that darkens recessed areas and enhances terrain depth.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'Object',
    algorithm: REMAINING.objectNode,
    category: CAT.IO,
    summary: 'Loads external object or mesh data for use inside the graph.',
    inputs: [], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Draw',
    algorithm: REMAINING.draw,
    category: CAT.IO,
    summary: 'Draw draws entire mountain ranges in the shape you choose.',
    inputs: [], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'LineNoise',
    algorithm: REMAINING.lineNoise,
    category: CAT.PRIM,
    summary: 'LineNoise is a geometry generator that creates sets of lines which can be distorted and used with other noises and fractals to produce layered ridges.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Unreal',
    algorithm: REMAINING.unreal,
    category: CAT.IO,
    summary: 'Exports terrain data in Unreal-friendly resolutions, formats, and naming conventions.',
    inputs: [], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Debris',
    algorithm: REMAINING.debris,
    category: CAT.MASK,
    summary: 'Simulates loose debris across the terrain surface to create broken rocky accumulation.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Input 2', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'TileInput',
    algorithm: REMAINING.tileInput,
    category: CAT.IO,
    summary: 'Reads a set of tiles for 1:1 input into a tiled build, or combines it into a single input.',
    inputs: [], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Mixer',
    algorithm: REMAINING.mixer,
    category: CAT.COMB,
    summary: 'Mixer allows layer-based manipulation of color textures and contains in-built masking.',
    inputs: [{ name: 'Base', kind: 'color' }, { name: 'Layer 1', kind: 'color' }, { name: 'Layer 2', kind: 'color' }, { name: 'Layer 3', kind: 'color' }, { name: 'Layer 4', kind: 'color' }, { name: 'Layer 5', kind: 'color' }], outputs: [OUT_C()],
    note: 'model',
  },

  {
    name: 'TextureBase',
    algorithm: REMAINING.textureBase,
    category: CAT.PRIM,
    summary: 'Texture uses multiple factors (such as chaos, slopes, flow zones, and other geological features) to create a texture mask for any color node to create a texture map. Can be used by itself, or combined with other data maps and selectors.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Input 2', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'IceFloe',
    algorithm: REMAINING.iceFloe,
    category: CAT.SHAPE,
    summary: 'Icefloe creates flat plates of ice inside a water body.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Input 2', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'WaterColor',
    algorithm: REMAINING.waterColor,
    category: CAT.FX,
    summary: 'Colorizes water bodies using palette-based shallow and deep water tones.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Accumulation', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }, { name: 'Mask 3', kind: 'height' }], outputs: [OUT_C()],
    note: 'model',
    params: {
      'Shallow': { d: [0.22, 0.55, 0.62, 1] },
      'Deep': { d: [0.02, 0.12, 0.28, 1] },
    },
  },

  {
    name: 'Shrubs',
    algorithm: REMAINING.shrubs,
    category: CAT.MASK,
    summary: 'Adds low vegetation or shrub-like surface growth across the terrain.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Input 2', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }], outputs: [MASK('Output')],
    note: 'approx',
  },

  {
    name: 'LightX',
    algorithm: REMAINING.lightX,
    category: CAT.FX,
    summary: 'Creates a fully lit render using controllable sun, shadow, and ambient lighting.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Input 2', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }], outputs: [OUT_C()],
    note: 'model',
    params: {
      'Sun Color': { d: [1, 0.96, 0.9, 1] },
      'Ambient Color': { d: [0.45, 0.52, 0.62, 1] },
    },
  },

  {
    name: 'Wizard2',
    algorithm: REMAINING.wizard2,
    category: CAT.EROS,
    summary: 'A simplified erosion wrapper that provides curated controls for shaping erosion depth, scale, and strength.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Anastomosis',
    algorithm: REMAINING.anastomosis,
    category: CAT.EROS,
    summary: 'Anastomosis creates interconnected water flow based extractions, ranging from small pits to large river channels. It is useful for both terrains and textures.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Dusting',
    algorithm: REMAINING.dusting,
    category: CAT.MASK,
    summary: 'Applies a thin dusting of snow or sediment over the terrain surface.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }, { name: 'Mask 3', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'SatMap',
    algorithm: REMAINING.satMap,
    category: CAT.FX,
    summary: 'Generates terrain color from preset satellite-style palettes with controllable range and processing.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Input 2', kind: 'height' }], outputs: [OUT_C()],
    note: 'approx',
  },

  {
    name: 'DataExtractor',
    algorithm: REMAINING.dataExtractor,
    category: CAT.MASK,
    summary: 'Extracts specific derived data such as boundaries, differences, or Modifier maps from an input.',
    inputs: [{ name: 'Input 1', kind: 'height' }, { name: 'Input 2', kind: 'height' }, { name: 'Input 3', kind: 'height' }, { name: 'Input 4', kind: 'height' }, { name: 'Input 5', kind: 'height' }, { name: 'Input 6', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'Weathering',
    algorithm: REMAINING.weathering,
    category: CAT.FX,
    summary: 'Creates weathered color or mask variation that simulates dirt, fading, and environmental wear.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_C()],
    note: 'model',
  },

  {
    name: 'Snowfield',
    algorithm: REMAINING.snowfield,
    category: CAT.MASK,
    summary: 'Creates broad settled snow coverage across the terrain surface.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }], outputs: [MASK('Output')],
    note: 'model',
  },

  {
    name: 'MountainSide',
    algorithm: REMAINING.mountainSide,
    category: CAT.SHAPE,
    summary: 'Generates a single mountain slope or mountainside formation.',
    inputs: [], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'EasyErosion',
    algorithm: REMAINING.easyErosion,
    category: CAT.EROS,
    summary: 'Provides a simplified erosion workflow for quickly adding natural erosion effects.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }], outputs: [OUT_H()],
    note: 'model',
  },

  {
    name: 'Shade',
    algorithm: REMAINING.shade,
    category: CAT.FX,
    summary: 'Produces a shaded terrain render based on lighting direction and surface relief.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_C()],
    note: 'model',
  },

  {
    name: 'LoopEnd',
    algorithm: REMAINING.loopEnd,
    category: CAT.COMB,
    summary: 'Ends a Loop circuit. ',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'stub',
  },

  {
    name: 'Splat',
    algorithm: REMAINING.splat,
    category: CAT.FX,
    summary: 'Splat is similar to RGBMix, taking heightfield nodes and encoding them to the RGB channels of a color map, and providing properties to control the inputs.',
    inputs: [{ name: 'R', kind: 'height' }, { name: 'G', kind: 'height' }, { name: 'B', kind: 'height' }], outputs: [OUT_C()],
    note: 'approx',
  },

  {
    name: 'Cartography',
    algorithm: REMAINING.cartography,
    category: CAT.FX,
    summary: 'Cartography creates a topographical overlay for a map.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Water', kind: 'height' }, { name: 'Grid', kind: 'height' }],
    outputs: [OUT_C(), MASK('Contours'), MASK('Water'), MASK('Grid')],
    note: 'model',
  },

  {
    name: 'Heal',
    algorithm: REMAINING.heal,
    category: CAT.ADJ,
    summary: 'Heal reconstructs damaged, low res, or 8-bit data with 16-bit, high resolution fidelity. It cleans up quantized images with extreme banding of any shape, and yields naturalistic terrain output.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
  },

  {
    name: 'Rivers',
    algorithm: REMAINING.rivers,
    category: CAT.EROS,
    summary: 'Rivers creates a realistic network of rivers with controllable headwaters.',
    inputs: [{ name: 'Input', kind: 'height' }, { name: 'Mask 1', kind: 'height' }, { name: 'Mask 2', kind: 'height' }, { name: 'Mask 3', kind: 'height' }, { name: 'Mask 4', kind: 'height' }],
    outputs: [OUT_H(), MASK('Rivers'), MASK('Flow')],
    note: 'model',
  },

  {
    name: 'ColorThreshold',
    algorithm: REMAINING.colorThreshold,
    category: CAT.MASK,
    summary: 'Creates a greyscale mask from a specified color range.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [MASK('Output')],
    note: 'approx',
    params: {
      'Start': { d: [0.35, 0.5, 0.35, 1] },
    },
  },

  {
    name: 'Whorl',
    algorithm: REMAINING.whorl,
    category: CAT.WARP,
    summary: 'Whorl applies multiple vortex-like distortions across the terrain to create large-scale warping. Very useful for creating massive landscapes without a patterning in the noise and for creating slightly surreal or alien landscapes.',
    inputs: [{ name: 'Input', kind: 'height' }], outputs: [OUT_H()],
    note: 'approx',
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



