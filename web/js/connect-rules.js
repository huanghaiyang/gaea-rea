/**
 * connect-rules.js — the single definition of whether an edge is legal.
 *
 * Both canvases (the Vue GraphCanvas and the legacy canvas editor) call this before touching
 * the graph, so a link is accepted or refused identically and reports the same reason.
 *
 * Rules, in the order the user is likely to hit them:
 *   - source and target must exist, and cannot be the same node;
 *   - the source port must exist on the source node and the target port on the target node;
 *   - port kinds must be compatible (colour does not silently become height);
 *   - the new edge must not create a cycle.
 */

import { getNode, wouldCreateCycle } from './graph.js';
import { resolveEntry } from './registry.js';

/**
 * Kinds that all carry one scalar value per pixel. A mask or a flow map is a heightfield in
 * disguise, so they may feed each other; `any` is the explicit wildcard. Colour fields have
 * four channels and cannot be fed into scalar kernels without an explicit conversion node.
 */
const SCALAR_KINDS = new Set(['height', 'mask', 'flow']);

export function kindsCompatible(outKind, inKind) {
  const a = outKind || 'any';
  const b = inKind || 'any';
  if (a === 'any' || b === 'any' || a === b) return true;
  return SCALAR_KINDS.has(a) && SCALAR_KINDS.has(b);
}

/** Ports from the registry, with the same one-port fallback the canvases draw. */
function portsOf(node) {
  const entry = resolveEntry(node.name);
  return {
    inputs: entry && entry.inputs && entry.inputs.length ? entry.inputs : [{ name: 'Input', kind: 'height' }],
    outputs: entry && entry.outputs && entry.outputs.length ? entry.outputs : [{ name: 'Output', kind: 'height' }],
  };
}

/**
 * Validate an edge from `fromId` output `fromPort` to `toId` input `toPort`.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateConnection(graph, fromId, toId, toPort, fromPort = 0) {
  const from = getNode(graph, fromId);
  const to = getNode(graph, toId);
  if (!from || !to) return { ok: false, reason: 'Connection needs two existing nodes' };
  if (fromId === toId) return { ok: false, reason: 'Cannot connect a node to itself' };

  const outputs = portsOf(from).outputs;
  const inputs = portsOf(to).inputs;
  if (!(fromPort >= 0 && fromPort < outputs.length)) {
    return { ok: false, reason: `${from.name} has no output ${fromPort + 1}` };
  }
  if (!(toPort >= 0 && toPort < inputs.length)) {
    return { ok: false, reason: `${to.name} has no input ${toPort + 1}` };
  }

  const outKind = outputs[fromPort].kind || 'any';
  const inKind = inputs[toPort].kind || 'any';
  if (!kindsCompatible(outKind, inKind)) {
    return { ok: false, reason: `Cannot connect a ${outKind} output to a ${inKind} input` };
  }

  if (wouldCreateCycle(graph, fromId, toId)) {
    return { ok: false, reason: 'That connection would create a cycle' };
  }
  return { ok: true };
}
