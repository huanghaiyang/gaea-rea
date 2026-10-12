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

/** Compute a field for one node, recursively, with a per-run cache. */
function computeNode(graph, nodeId, ctx, cache, visiting, errors) {
  if (cache.has(nodeId)) return cache.get(nodeId);
  const node = getNode(graph, nodeId);
  if (!node) return null;
  if (visiting.has(nodeId)) {
    errors.push({ nodeId, message: `cycle detected at ${node.name}` });
    return null;
  }
  visiting.add(nodeId);

  const inputs = incomingEdges(graph, nodeId).sort((a, b) => a.toPort - b.toPort);
  const inputFields = new Map();
  const inputHashes = [];
  for (const e of inputs) {
    const f = computeNode(graph, e.from, ctx, cache, visiting, errors);
    inputFields.set(e.toPort, f);
    inputHashes.push(`${e.toPort}:${f ? hashString(f.data.length + ':' + quickSum(f).toFixed(5)) : 'null'}`);
  }
  visiting.delete(nodeId);

  const entry = resolveEntry(node.name);
  const kernel = entry && entry.algorithm ? entry.algorithm : passthrough;
  const params = resolvedParams(node.name, node.params);

  const nodeCtx = {
    size: ctx.size,
    params,
    seed: (ctx.seed + (params.Seed !== undefined ? Number(params.Seed) | 0 : 0) + hashNodeSeed(node)) | 0,
    worldSize: ctx.worldSize,
    input: (i) => inputFields.get(i) || null,
    node,
  };

  let field = null;
  try {
    field = kernel(nodeCtx);
  } catch (err) {
    errors.push({ nodeId, message: `${node.name}: ${err && err.message ? err.message : String(err)}` });
    field = null;
  }
  if (!field) {
    const first = inputFields.get(0);
    field = first
      ? { size: first.size, channel: first.channel, channels: first.channels, data: new Float32Array(first.data) }
      : createField(ctx.size, 'height', 0.5);
  }
  if (field.size !== ctx.size || !(field.data instanceof Float32Array)) {
    // defensive: kernels must honour the requested resolution
    if (field.size && field.size !== ctx.size) {
      errors.push({ nodeId, message: `${node.name}: resolution mismatch (${field.size} vs ${ctx.size})` });
    }
  }
  sanitize(field, 0);
  cache.set(nodeId, field);
  return field;
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
      const s = stats(cache.get(id));
      perNode.push({
        nodeId: id,
        name: node ? node.name : '?',
        min: s.min, max: s.max, mean: s.mean, std: s.std,
        ms: now() - t,
      });
    }
  }

  const field = cache.get(rootId) || null;
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
    const f = cache.get(id);
    if (f) out.set(id, f);
  }
  return { fields: out, errors };
}

export { defaultParams, buildSchema };
