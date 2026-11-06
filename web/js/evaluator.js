/**
 * evaluator.js — pure graph evaluation with memoisation. No DOM, no globals.
 *
 * The evaluator is intentionally synchronous and single-threaded; the worker wrapper
 * (js/eval-worker.js) calls exactly this code, and the Node test harness calls it too, so
 * the numbers you verify under Node are the numbers the browser renders.
 */

import { BY_NAME, passthrough, buildSchema, defaultParams, resolveEntry } from './registry.js';
import { createField, sanitize, stats } from './kernel/field.js';
import { topoOrderUpstream, incomingEdges, getNode } from './graph.js';

/** Stable string hash (FNV-1a 32-bit, hex). Used for cache keys and input fingerprints. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Merge a node's stored params over the schema defaults, in schema order. */
export function resolvedParams(nodeName, stored) {
  const entry = BY_NAME.get(nodeName);
  const catalogNode = CATALOG_INDEX.get(nodeName);
  const schema = buildSchema(catalogNode, entry);
  const out = {};
  for (const p of schema) {
    const v = stored ? stored[p.name] : undefined;
    out[p.name] = v === undefined ? (Array.isArray(p.value) ? p.value.slice() : p.value) : v;
  }
  return out;
}

/** Catalog injected once by the host (browser or Node harness). */
let CATALOG_INDEX = new Map();
export function setCatalog(catalog) {
  CATALOG_INDEX = new Map((catalog.nodes || []).map((n) => [n.name, n]));
}

/**
 * Compute a node's outputs, recursively, with a per-run cache.
 *
 * A kernel may return a single Field (the common case) or an ARRAY of Fields when the Gaea node
 * commits more than one port. The cache always stores an array so `edge.fromPort` can select the
 * requested output; arrays of length 1 behave exactly like the old single-field path.
 *
 * `seedOverride` re-evaluates THIS node with a different Seed parameter while its upstream
 * subtree stays shared. That is what Reseed does in Gaea: it clones the upstream node, writes
 * `Seed` into the clone and rebuilds it.
 */
function computeNode(graph, nodeId, ctx, cache, visiting, errors, seedOverride) {
  const key = seedOverride === undefined ? nodeId : `${nodeId}#seed:${seedOverride}`;
  if (cache.has(key)) return cache.get(key);
  const node = getNode(graph, nodeId);
  if (!node) return null;
  if (visiting.has(nodeId)) {
    errors.push({ nodeId, message: `cycle detected at ${node.name}` });
    return null;
  }
  visiting.add(nodeId);

  const entry = resolveEntry(node.name);
  const params = resolvedParams(node.name, node.params);

  // --- Reseed ---------------------------------------------------------------
  // Gaea does not regenerate the field itself: it clones the upstream node, sets the clone's
  // `Seed` to this node's Seed and commits the clone's output. Reproduce that here so the graph
  // semantics match even though we work on fields rather than node instances.
  if (entry && entry.reseed) {
    const edge = incomingEdges(graph, nodeId).sort((a, b) => a.toPort - b.toPort)[0];
    let field = null;
    if (edge) {
      const outs = computeNode(graph, edge.from, ctx, cache, visiting, errors,
        Number.isFinite(Number(params.Seed)) ? Number(params.Seed) | 0 : 0);
      const src = outs && (outs[edge.fromPort] || outs[0]);
      if (src) field = copyOf(src);
    }
    visiting.delete(nodeId);
    if (!field) field = createField(ctx.size, 'height', 0.5);
    sanitize(field, 0);
    cache.set(key, [field]);
    return [field];
  }

  const inputs = incomingEdges(graph, nodeId).sort((a, b) => a.toPort - b.toPort);
  const inputFields = new Map();
  for (const e of inputs) {
    const outs = computeNode(graph, e.from, ctx, cache, visiting, errors);
    const f = outs ? (outs[e.fromPort] || outs[0] || null) : null;
    inputFields.set(e.toPort, f);
  }
  visiting.delete(nodeId);

  const kernel = entry && entry.algorithm ? entry.algorithm : passthrough;

  const nodeCtx = {
    size: ctx.size,
    params,
    seed: (ctx.seed
      + (seedOverride !== undefined ? seedOverride : (params.Seed !== undefined ? Number(params.Seed) | 0 : 0))
      + hashNodeSeed(node)) | 0,
    worldSize: ctx.worldSize,
    input: (i) => inputFields.get(i) || null,
    node,
  };

  let produced = null;
  try {
    produced = kernel(nodeCtx);
  } catch (err) {
    errors.push({ nodeId, message: `${node.name}: ${err && err.message ? err.message : String(err)}` });
    produced = null;
  }

  // Normalise to an array of fields. A kernel returns an array only when the node has several
  // committed ports; anything else (null, a bare Field) becomes a one-element list.
  let outputs;
  if (Array.isArray(produced)) {
    outputs = produced.map((f) => (f ? copyOf(f, ctx.size) : null));
  } else {
    outputs = [produced ? copyOf(produced, ctx.size) : null];
  }
  if (!outputs[0]) {
    const first = inputFields.get(0);
    outputs[0] = first
      ? copyOf(first, ctx.size)
      : createField(ctx.size, 'height', 0.5);
  }
  for (const f of outputs) {
    if (!f) continue;
    if (f.size !== ctx.size) {
      errors.push({ nodeId, message: `${node.name}: resolution mismatch (${f.size} vs ${ctx.size})` });
    }
    sanitize(f, 0);
  }
  cache.set(key, outputs);
  return outputs;
}

/** A field with the requested resolution (kernels normally return the right size already). */
function copyOf(f, size) {
  const n = size || f.size;
  const ch = f.channels || 1;
  if (f.size === n) {
    return { size: n, channel: f.channel, channels: ch, data: new Float32Array(f.data) };
  }
  // Fallback for a kernel that ignored ctx.size: sample with nearest for safety.
  const out = new Float32Array(n * n * ch);
  const inv = f.size / n;
  for (let y = 0; y < n; y++) {
    const sy = Math.min(f.size - 1, Math.floor((y + 0.5) * inv));
    for (let x = 0; x < n; x++) {
      const sx = Math.min(f.size - 1, Math.floor((x + 0.5) * inv));
      for (let c = 0; c < ch; c++) {
        out[(y * n + x) * ch + c] = f.data[(sy * f.size + sx) * ch + c];
      }
    }
  }
  return { size: n, channel: f.channel, channels: ch, data: out };
}

/**
 * Small per-node deterministic offset so different node kinds do not share identical noise.
 * Derived from the node NAME only (not its id) so that a graph rebuilt in a different order
 * still produces the same terrain. User-visible Seed parameters are added on top.
 */
function hashNodeSeed(node) {
  let h = 2166136261;
  const s = node.name;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 100003;
}

/**
 * Cheap content fingerprint of a field, used only to detect that an upstream input changed.
 * Samples at most ~4096 values so fingerprinting never dominates the evaluation cost.
 */
function quickSum(f) {
  const d = f.data;
  const stride = Math.max(1, Math.floor(d.length / 4096));
  let s = 0, c = 0;
  for (let i = 0; i < d.length; i += stride) { s += d[i]; c++; }
  return c > 0 ? s / c : 0;
}

/**
 * Evaluate the graph at `rootId`.
 *
 * @returns {{
 *   field: object|null,
 *   errors: Array<{nodeId:string,message:string}>,
 *   stats: Array<{nodeId:string,name:string,min:number,max:number,mean:number,std:number,ms:number}>,
 *   totalMs: number,
 *   order: string[]
 * }}
 */
export function evaluateGraph(graph, rootId, options = {}) {
  const size = Math.max(16, Math.min(2048, (options.size || graph.build.size || 256) | 0));
  const seed = (options.seed !== undefined ? options.seed : graph.build.seed) | 0;
  const ctx = { size, seed, worldSize: graph.build.worldSize || 60 };
  const cache = new Map();
  const errors = [];
  const perNode = [];
  const t0 = now();

  if (!rootId) {
    return { field: null, errors: [{ nodeId: '', message: 'graph is empty' }], stats: [], totalMs: 0, order: [] };
  }

  const order = topoOrderUpstream(graph, rootId);
  // instrument: wrap each node computation with a timer
  for (const id of order) {
    const t = now();
    const had = cache.has(id);
    computeNode(graph, id, ctx, cache, new Set(), errors);
    if (!had && cache.has(id)) {
      const node = getNode(graph, id);
      const outs = cache.get(id);
      const s = stats(outs && outs[0]);
      perNode.push({
        nodeId: id,
        name: node ? node.name : '?',
        min: s.min, max: s.max, mean: s.mean, std: s.std,
        ms: now() - t,
      });
    }
  }

  const outs = cache.get(rootId);
  const field = (outs && outs[0]) || null;
  return { field, errors, stats: perNode, totalMs: now() - t0, order, size };
}

function now() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now();
  return Date.now();
}

/** Evaluate several roots in one pass (shared cache). Used to render thumbnails. */
export function evaluateMany(graph, rootIds, options = {}) {
  const size = Math.max(16, Math.min(2048, (options.size || graph.build.size || 256) | 0));
  const seed = (options.seed !== undefined ? options.seed : graph.build.seed) | 0;
  const ctx = { size, seed, worldSize: graph.build.worldSize || 60 };
  const cache = new Map();
  const errors = [];
  const out = new Map();
  for (const id of rootIds) {
    computeNode(graph, id, ctx, cache, new Set(), errors);
    const outs = cache.get(id);
    if (outs && outs[0]) out.set(id, outs[0]);
  }
  return { fields: out, errors };
}

export { defaultParams, buildSchema };
