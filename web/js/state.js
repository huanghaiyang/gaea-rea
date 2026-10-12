/**
 * state.js — application state, undo/redo history and the generated node catalog.
 *
 * The state object is deliberately tiny: the graph is the single source of truth, and every
 * panel re-renders from it. History stores full graph snapshots (the graphs are small,
 * a few hundred nodes at most, and snapshotting removes an entire class of undo bugs).
 */

import { createGraph, clone, findTerminal } from './graph.js';
import { BY_NAME, buildSchema, defaultParams, IMPLEMENTED, resolveEntry } from './registry.js';
import { createBus } from './util.js';

const HISTORY_LIMIT = 60;

export const bus = createBus();

export const state = {
  /** @type {ReturnType<typeof createGraph>} */
  graph: createGraph(),
  selected: null,            // node id
  previewRoot: null,         // node id whose field the viewport shows; null = follow selection
  catalog: null,             // data/nodes.json
  catalogIndex: new Map(),   // name -> catalog entry
  schemas: new Map(),        // name -> merged parameter schema
  libFilter: 'all',
  libQuery: '',
  viewMode: '2d',            // '2d' | '3d'
  ramp: 'terrain',
  exaggeration: 1,
  /** last evaluation result, keyed by root id */
  fields: new Map(),
  lastStats: [],
  lastErrors: [],
  lastMs: 0,
  fps: 0,
  glAvailable: false,
};

/** Load the generated catalog and pre-compute every node's parameter schema. */
export function loadCatalog(catalog) {
  state.catalog = catalog;
  state.catalogIndex = new Map((catalog.nodes || []).map((n) => [n.name, n]));
  state.schemas.clear();
  // Every catalogued node plus every registry-only node must have a schema, so the parameter
  // panel can build controls for an arbitrary node without special cases.
  const all = new Set([
    ...(catalog.nodes || []).map((n) => n.name),
    ...Array.from(BY_NAME.keys()),
  ]);
  for (const name of all) {
    state.schemas.set(name, buildSchema(state.catalogIndex.get(name), BY_NAME.get(name)));
  }
  return catalog;
}

export function schemaFor(name) {
  let s = state.schemas.get(name);
  if (!s) {
    s = buildSchema(state.catalogIndex.get(name), BY_NAME.get(name));
    state.schemas.set(name, s);
  }
  return s;
}

export function isImplemented(name) {
  const e = resolveEntry(name);
  return !!(e && e.algorithm);
}

export function registryEntry(name) {
  return resolveEntry(name) || null;
}

/** Registry entry for the node's OWN name (no aliasing) — used for the panel's fidelity badge. */
export function exactRegistryEntry(name) {
  return BY_NAME.get(name) || null;
}

/** Library category: the node's own registry entry, else its alias target's, else catalog-only. */
export function categoryOf(name) {
  const exact = BY_NAME.get(name);
  const entry = exact || resolveEntry(name);
  if (!entry || !entry.algorithm) return 'Catalog only (no algorithm)';
  return entry.category || 'Catalog only (no algorithm)';
}

export function nodeDescription(name) {
  const entry = BY_NAME.get(name) || resolveEntry(name);
  const cat = state.catalogIndex.get(name);
  return (entry && entry.summary) || (cat && cat.description) || '';
}

/** The kernel a node name will run, or null when the node is a passthrough. */
export function algorithmOf(name) {
  const e = resolveEntry(name);
  return e && e.algorithm ? e.algorithm : null;
}

/* ------------------------------------------------------------------ history */

const past = [];
const future = [];

export function snapshot() {
  past.push(clone(state.graph));
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
  emitHistory();
}

export function undo() {
  if (!past.length) return false;
  future.push(clone(state.graph));
  state.graph = past.pop();
  reconcileSelection();
  emitHistory();
  bus.emit('graph:replaced', { reason: 'undo' });
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(clone(state.graph));
  state.graph = future.pop();
  reconcileSelection();
  emitHistory();
  bus.emit('graph:replaced', { reason: 'redo' });
  return true;
}

export function historyDepth() { return { undo: past.length, redo: future.length }; }

export function clearHistory() {
  past.length = 0; future.length = 0;
  emitHistory();
}

function emitHistory() { bus.emit('history:changed', historyDepth()); }

function reconcileSelection() {
  if (state.selected && !state.graph.nodes.some((n) => n.id === state.selected)) {
    state.selected = state.graph.nodes.length ? state.graph.nodes[state.graph.nodes.length - 1].id : null;
  }
  if (state.previewRoot && !state.graph.nodes.some((n) => n.id === state.previewRoot)) {
    state.previewRoot = null;
  }
}

/* ------------------------------------------------------------------ convenience */

export function selectNode(id) {
  state.selected = id;
  bus.emit('selection:changed', { id });
}

/** Root used for evaluation: the explicit preview pin, else selection, else terminal. */
export function activeRoot() {
  if (state.previewRoot && state.graph.nodes.some((n) => n.id === state.previewRoot)) return state.previewRoot;
  if (state.selected && state.graph.nodes.some((n) => n.id === state.selected)) return state.selected;
  return findTerminal(state.graph);
}

/** Roots that need to be evaluated for the current UI: preview root + terminal. */
export function rootsToEvaluate() {
  const out = [];
  const a = activeRoot();
  if (a) out.push(a);
  const t = findTerminal(state.graph);
  if (t && !out.includes(t)) out.push(t);
  return out;
}

export function setNodeParam(nodeId, paramName, value) {
  const node = state.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  node.params = node.params || {};
  node.params[paramName] = value;
}

export function resetNodeParams(nodeId) {
  const node = state.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  node.params = defaultParams(schemaFor(node.name));
}

/** Deep-clone a node with a new id and a small offset (used by duplicate). */
export function duplicateNode(nodeId) {
  const src = state.graph.nodes.find((n) => n.id === nodeId);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = undefined;
  return copy;
}
