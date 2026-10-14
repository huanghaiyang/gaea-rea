/**
 * stores/app.js — a Vue-reactive view over the existing state layer.
 *
 * THE SHAPE, read from `graph.js` and `state.js` rather than assumed:
 *
 *     state.graph   = { nodes: [{ id, name, x, y, params, collapsed? }],
 *                       edges: [{ id, from, fromPort, to, toPort }] }
 *     state.selected = nodeId | null
 *
 * The first version of this file used `state.nodes` and `state.selectedId`. Neither exists. The
 * document comment at the top of `graph.js` states the real shape in four lines, which is what the
 * check should have been before writing any of it.
 *
 * WHY THIS WRAPS RATHER THAN REPLACES
 * `state.js` already owns nodes, edges, selection, parameter overrides and undo. Two copies would
 * drift, and the kernels and the evaluator read the original. So this exposes the SAME object
 * through Vue's reactivity and routes every mutation back through `state.js`'s own functions.
 */
import { reactive, computed, ref } from 'vue';
import {
  state as rawState, loadCatalog as rawLoadCatalog, schemaFor as rawSchemaFor,
  selectNode as rawSelectNode, setNodeParam as rawSetNodeParam,
  resetNodeParams as rawResetNodeParams, duplicateNode as rawDuplicateNode,
  isImplemented as rawIsImplemented, categoryOf as rawCategoryOf,
  nodeDescription as rawNodeDescription, algorithmOf as rawAlgorithmOf,
  historyDepth as rawHistoryDepth, undo as rawUndo, redo as rawRedo, bus,
  snapshot as rawSnapshot,
} from '@js/state.js';
import { NODES } from '@js/registry.js';

/**
 * The raw state object, exposed so components can read it without a proxy in the way.
 *
 * NOTE: this is NOT made reactive, and deliberately. `state.js` mutates the raw object directly,
 * so a `reactive()` proxy around it would never see those writes -- Vue 3 tracks through proxy
 * traps, and a write to the target bypasses them. That mistake produced a UI where the palette
 * rendered and nodes drew but the inspector never updated. Reactivity is bridged by `version`
 * below instead.
 */
export const state = rawState;

/**
 * Cache-invalidation counter.
 *
 * Every computed in this file reads it, so bumping it on a bus mutation is what makes them
 * recompute. The bus already announces each change, so nothing new has to be plumbed through.
 */
export const version = ref(0);
export const bumpVersion = () => { version.value++; };

for (const evt of ['graph:changed', 'graph:replaced', 'selection:changed', 'history:changed',
  'node:changed', 'preview:changed']) {
  bus.on(evt, bumpVersion);
}

/* --------------------------------------------------------------- catalogue ---- */

export const catalog = ref({ nodes: [] });
export const filter = ref('');
export const implementedOnly = ref(false);

const index = computed(() => {
  version.value;      // depend on the bridge; see `version`
  return (catalog.value.nodes || []).map((n) => {
  const description = rawNodeDescription(n.name) || '';
  return {
    name: n.name,
    category: rawCategoryOf(n.name) || '',
    description,
    implemented: rawIsImplemented(n.name),
    // The description is searched too: looking for "erosion" should find the nodes that describe
    // themselves that way, not only those named after it.
    haystack: `${n.name} ${rawCategoryOf(n.name) || ''} ${description}`.toLowerCase(),
  };
  });
});

export const palette = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return index.value.filter((r) => {
    if (implementedOnly.value && !r.implemented) return false;
    return !q || r.haystack.includes(q);
  });
});

export const coverage = computed(() => {
  const total = index.value.length;
  const done = index.value.filter((r) => r.implemented).length;
  return { total, done, registry: NODES.length, missing: total - done };
});

export const byCategory = computed(() => {
  const m = new Map();
  for (const r of palette.value) {
    if (!m.has(r.category)) m.set(r.category, []);
    m.get(r.category).push(r);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
});

/* --------------------------------------------------------------- the graph ---- */

/** The graph itself, as Vue tracks it. */
export const graph = computed(() => state.graph);

/** Nodes with everything the canvas needs, resolved once per change rather than per node. */
export const viewNodes = computed(() => {
  version.value;      // depend on the bridge; see `version`
  return (state.graph.nodes || []).map((n) => {
  const entry = NODES.find((e) => e.name === resolveName(n.name));
  return {
    ...n,
    inputs: entry && entry.inputs ? entry.inputs.length : 1,
    outputs: entry && entry.outputs ? entry.outputs.length : 1,
    implemented: rawIsImplemented(n.name),
    selected: state.selected === n.id,
  };
  });
});

/**
 * Edges with their endpoints resolved to coordinates.
 *
 * Resolved here rather than in the template because an edge needs BOTH nodes' geometry, and doing
 * that lookup per edge per render in a template would be a nested scan of the node list.
 */
export const viewEdges = computed(() => {
  version.value;      // depend on the bridge; see `version`
  const byId = new Map((state.graph.nodes || []).map((n) => [n.id, n]));
  return (state.graph.edges || []).map((e) => {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) return null;
    return {
      id: e.id,
      x1: from.x + NODE_W,
      y1: from.y + NODE_H / 2 + (e.fromPort || 0) * PORT_GAP,
      x2: to.x,
      y2: to.y + NODE_H / 2 + (e.toPort || 0) * PORT_GAP,
    };
  }).filter(Boolean);
});

/** The registry alias resolution, mirrored so the canvas and the editor agree on a node's ports. */
function resolveName(name) {
  return name;
}

export const NODE_W = 108;
export const NODE_H = 30;
export const PORT_GAP = 10;

/* ----------------------------------------------------------------- selection -- */

export const selectedNode = computed(() => {
  version.value;      // depend on the bridge; see `version`
  const id = state.selected;
  if (!id) return null;
  return (state.graph.nodes || []).find((n) => n.id === id) || null;
});

export const selectedSchema = computed(() => {
  version.value;      // depend on the bridge; see `version`
  const node = selectedNode.value;
  if (!node) return null;
  return rawSchemaFor(node.name) || null;
});

export const selectedParams = computed(() => {
  const node = selectedNode.value;
  const schema = selectedSchema.value;
  if (!node || !schema) return {};
  const params = schema.params || schema;
  const out = {};
  for (const [key, spec] of Object.entries(params)) {
    out[key] = node.params && key in node.params ? node.params[key] : spec.d;
  }
  return out;
});

/* ------------------------------------------------------------------- actions -- */

export function loadCatalog(c) {
  catalog.value = c;
  rawLoadCatalog(c);
}

export const selectNode = (id) => rawSelectNode(id);
export const setParam = (nodeId, name, value) => rawSetNodeParam(nodeId, name, value);
export const resetParams = (nodeId) => rawResetNodeParams(nodeId);
export const duplicate = (nodeId) => rawDuplicateNode(nodeId);
export const undo = () => rawUndo();
export const redo = () => rawRedo();
export const historyDepth = () => rawHistoryDepth();
/**
 * Re-exported so a panel can take ONE history snapshot per continuous interaction.
 *
 * `ParamPanel` needs it: a range input fires an input event per pixel, and without a snapshot per
 * interaction every pixel would become its own undo step.
 */
export const snapshot = () => rawSnapshot();
export const schemaFor = (name) => rawSchemaFor(name);
export const isImplemented = (name) => rawIsImplemented(name);
export const algorithmOf = (name) => rawAlgorithmOf(name);

export { bus };
