/**
 * graph.js — the node-graph data model (pure data + pure functions, no DOM).
 *
 * A graph is plain JSON so it can be snapshotted for undo and exported:
 * {
 *   nodes: [{ id, name, x, y, params: {..}, collapsed? }],
 *   edges: [{ id, from: nodeId, fromPort: 0, to: nodeId, toPort: 0 }],
 *   build: { size, seed, worldSize }
 * }
 *
 * Invariants enforced here: at most one edge per (to, toPort) input port.
 */

export function createGraph() {
  return {
    nodes: [],
    edges: [],
    build: { size: 256, seed: 0, worldSize: 60 },
  };
}

let counter = 0;
/**
 * Deterministic id generator: a monotonic counter only (no timestamp), because the id feeds
 * the per-node noise offset. Two identical graphs built in the same order must produce
 * bit-identical terrain, which a Date.now() component would break.
 */
export function newId(prefix = 'n') {
  counter += 1;
  return `${prefix}${counter.toString(36)}`;
}

export function addNode(graph, name, x, y, params) {
  const node = { id: newId(), name, x: Math.round(x), y: Math.round(y), params: params || {} };
  graph.nodes.push(node);
  return node;
}

export function removeNode(graph, id) {
  const i = graph.nodes.findIndex((n) => n.id === id);
  if (i < 0) return false;
  graph.nodes.splice(i, 1);
  graph.edges = graph.edges.filter((e) => e.from !== id && e.to !== id);
  return true;
}

export function getNode(graph, id) {
  return graph.nodes.find((n) => n.id === id) || null;
}

/**
 * Connect from -> to at an input port. Refuses self-loops and duplicates; replaces the
 * existing edge on that input port (Gaea behaves the same way: an input takes one link).
 */
export function connect(graph, from, to, toPort, fromPort = 0) {
  if (from === to) return null;
  graph.edges = graph.edges.filter((e) => !(e.to === to && e.toPort === toPort));
  const edge = { id: newId('e'), from, fromPort, to, toPort };
  graph.edges.push(edge);
  return edge;
}

export function disconnect(graph, to, toPort) {
  const before = graph.edges.length;
  graph.edges = graph.edges.filter((e) => !(e.to === to && e.toPort === toPort));
  return graph.edges.length !== before;
}

export function incomingEdges(graph, id) {
  return graph.edges.filter((e) => e.to === id);
}

export function outgoingEdges(graph, id) {
  return graph.edges.filter((e) => e.from === id);
}

/** Depth-first search for a cycle that would be created by from -> to. */
export function wouldCreateCycle(graph, from, to) {
  if (from === to) return true;
  const adj = new Map();
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const stack = [from];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === to) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of (adj.get(cur) || [])) stack.push(n);
  }
  return false;
}

/** Deterministic terminal node: an explicit Output/Export if present, else the sink. */
export function findTerminal(graph) {
  const explicit = graph.nodes.filter((n) => n.name === 'Output' || n.name === 'Export');
  if (explicit.length) {
    // prefer one that actually has an input connected
    const connected = explicit.find((n) => graph.edges.some((e) => e.to === n.id));
    return (connected || explicit[0]).id;
  }
  const hasOutgoing = new Set(graph.edges.map((e) => e.from));
  const sinks = graph.nodes.filter((n) => !hasOutgoing.has(n.id));
  return sinks.length ? sinks[sinks.length - 1].id : null;
}

export function clone(graph) {
  return JSON.parse(JSON.stringify(graph));
}

/** Topological order of the sub-graph upstream of `rootId` (inputs before consumers). */
export function topoOrderUpstream(graph, rootId) {
  const order = [];
  const state = new Map(); // 0=visiting 1=done
  const incoming = new Map();
  for (const e of graph.edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e.from);
  }
  const visit = (id) => {
    const s = state.get(id);
    if (s === 1) return;
    if (s === 0) return; // cycle: stop, the evaluator reports it
    state.set(id, 0);
    for (const src of (incoming.get(id) || [])) visit(src);
    state.set(id, 1);
    order.push(id);
  };
  visit(rootId);
  return order;
}
