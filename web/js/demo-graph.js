/**
 * demo-graph.js — builds the reference terrain pipeline used by the "Demo" button and by the
 * verification harness.
 *
 * Shape mirrors a realistic Gaea graph (branch, warp, erode, recombine, post-process) and
 * exercises the nodes this build implements most deeply, so pressing Demo is also the fastest
 * way to see whether the engine works end to end.
 *
 *   MultiFractal(base)   MultiFractal(detail)
 *          |                    |
 *          +------> Warp <------+          (detail warps the base)
 *                    |
 *                 Erosion2               (hydraulic droplet erosion)
 *                    |
 *          +---------+---------+
 *          |                   |
 *        Snow               Combine(Blend)          Mountain
 *          |                   |                      |
 *          +----> Combine(Multiply) <-----------------+
 *                          |
 *                      Autolevel
 *                          |
 *                       Output
 */

import { createGraph, addNode, connect, findTerminal } from './graph.js';
import { defaultParams } from './registry.js';
import { schemaFor } from './state.js';

function node(graph, name, x, y, overrides) {
  const params = defaultParams(schemaFor(name));
  Object.assign(params, overrides || {});
  return addNode(graph, name, x, y, params);
}

export function buildDemoGraph() {
  const g = createGraph();
  g.build.size = 256;
  g.build.seed = 0;

  const base = node(g, 'MultiFractal', 40, 40, {
    'Noise Type': 'FBM', Scale: 100, Octaves: 10, Roughness: 0.52,
    Contrast: 1.05, Seed: 1024, 'Auto Octaves': false,
  });
  const detail = node(g, 'MultiFractal', 40, 170, {
    'Noise Type': 'Billowy', Scale: 190, Octaves: 6, Roughness: 0.62,
    Seed: 55, 'Auto Octaves': false, Contrast: 0.9,
  });
  const warp = node(g, 'Warp', 210, 40, {
    Size: 130, Strength: 0.42, 'Warp Source': 'PerlinFBM',
    Perturbation: 0.12, Complexity: 4, Roughness: 0.5, Mode: 'Bitmap', Seed: 7,
  });
  const erode = node(g, 'Erosion2', 380, 40, {
    Duration: 0.55, Downcutting: 0.55, 'Erosion Scale': 0.5,
    'Suspended Load': 0.5, 'Bed Load': 0.35, 'Coarse Sediments': 0.3,
    Shape: 0.35, 'Shape Sharpness': 0.4, Seed: 3,
  });
  const snow = node(g, 'Snow', 550, 170, {
    Snowline: 0.58, Transition: 0.16, 'Slope Limit': 0.42, 'Slope Falloff': 0.22, Melt: 0.08,
  });
  const mountain = node(g, 'Mountain', 550, 300, {
    Scale: 70, Height: 0.9, Style: 'Alpine', Bulk: 'Medium', Seed: 21,
  });
  const recombine = node(g, 'Combine', 720, 170, { Mode: 'Multiply', Ratio: 0.55, Output: 'None', Enhance: 'None' });
  const finish = node(g, 'Autolevel', 890, 40, {});
  const out = node(g, 'Output', 1030, 40, {});

  connect(g, base.id, warp.id, 0);
  connect(g, detail.id, warp.id, 1);
  connect(g, warp.id, erode.id, 0);
  connect(g, erode.id, snow.id, 0);
  connect(g, erode.id, recombine.id, 0);
  connect(g, mountain.id, recombine.id, 1);
  connect(g, recombine.id, finish.id, 0);
  connect(g, finish.id, out.id, 0);

  return { graph: g, terminal: out.id, ids: { base: base.id, detail: detail.id, warp: warp.id, erode: erode.id, snow: snow.id, mountain: mountain.id, recombine: recombine.id, finish: finish.id, out: out.id } };
}

/** Minimal starter graph for the "New" button: one noise node wired to an Output. */
export function buildStarterGraph() {
  const g = createGraph();
  g.build.size = 256;
  const mf = node(g, 'MultiFractal', 80, 60, { Scale: 100, Octaves: 9, Seed: 1024, 'Auto Octaves': false });
  const out = node(g, 'Output', 280, 60, {});
  connect(g, mf.id, out.id, 0);
  return { graph: g, terminal: out.id, ids: { mf: mf.id, out: out.id } };
}

export { findTerminal };
