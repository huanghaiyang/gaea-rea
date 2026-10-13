<script setup>
/**
 * GraphCanvas — the node graph, rendered from Vue's reactive state as SVG.
 *
 * WHAT "REWRITTEN IN VUE" MEANS HERE
 * The previous editor was a `GraphEditor` class drawing to a 2D canvas from an imperative loop,
 * with its own hit-testing, its own view transform and its own redraw scheduling. None of that is
 * needed when the graph is already reactive: SVG elements ARE the nodes, `v-for` over
 * `viewNodes` is the draw call, and Vue diffs it. There is no `draw()` method, no hit-test code,
 * and no `ResizeObserver`-driven repaint, because those were all workarounds for an imperative
 * surface.
 *
 * What genuinely has to be written is the INTERACTION, because that is behaviour rather than
 * rendering: dragging a node, panning, zooming, and dragging a link between ports. That lives in
 * pointer handlers here and is the part that must be tested in a browser.
 *
 * The view transform is applied ONCE to a `<g>` rather than to every element, so a pan or zoom is
 * a single attribute change and the browser transforms the whole subtree.
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import {
  state, viewNodes, viewEdges, selectNode, NODE_W, NODE_H,
} from '../stores/app.js';
import { t, term } from '@js/i18n.js';
// The mutations are performed here, not requested over the bus. `GraphEditor` used to own them,
// and the bus events this component first emitted had no listener at all -- the palette worked,
// the SVG rendered, and nothing ever appeared.
import { bus, snapshot, state as rawState } from '@js/state.js';
import { addNode, removeNode, connect } from '@js/graph.js';

/** Pan and zoom, in one object so a single assignment moves the view. */
const view = ref({ x: 40, y: 30, k: 1 });

/** `{ nodeId, dx, dy }` while a node is being dragged. */
const dragNode = ref(null);
/** `{ x0, y0, vx, vy }` while the background is being panned. */
const pan = ref(null);
/** `{ nodeId, port, x, y }` while a link is being pulled from an output. */
const linking = ref(null);
/** Live pointer position in world units, for the link rubber band. */
const pointer = ref({ x: 0, y: 0 });

const svg = ref(null);

/** Screen -> world. */
function toWorld(clientX, clientY) {
  const r = svg.value.getBoundingClientRect();
  const v = view.value;
  return {
    x: (clientX - r.left - v.x) / v.k,
    y: (clientY - r.top - v.y) / v.k,
  };
}

/**
 * Pointer capture, best-effort.
 *
 * `setPointerCapture` throws `NotFoundError` when the pointer is not currently active -- with a
 * synthesised event, and with some real input devices. It is an optimisation that keeps events
 * flowing when the pointer leaves the element, so losing it must not abort the gesture: an
 * unguarded call skipped everything after it and logged an error on every interaction.
 */
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* no active pointer; the gesture still works, it just stops at the element's edge */
  }
}

/* ------------------------------------------------------------------ pointer ---- */

function onBackgroundDown(ev) {
  // Middle button, right button or Alt starts a pan. Left on empty space clears the selection.
  if (ev.button === 1 || ev.button === 2 || ev.altKey) {
    pan.value = { x0: ev.clientX, y0: ev.clientY, vx: view.value.x, vy: view.value.y };
    capture(svg.value, ev.pointerId);
    return;
  }
  if (ev.button === 0) selectNode(null);
}

function onNodeDown(ev, node) {
  if (ev.button === 1 || ev.button === 2 || ev.altKey) return;   // let the pan handler have it
  ev.stopPropagation();
  selectNode(node.id);
  const w = toWorld(ev.clientX, ev.clientY);
  dragNode.value = { nodeId: node.id, dx: w.x - node.x, dy: w.y - node.y };
  capture(svg.value, ev.pointerId);
}

function onPortDown(ev, node, port) {
  if (ev.button !== 0) return;
  ev.stopPropagation();
  const w = toWorld(ev.clientX, ev.clientY);
  linking.value = { nodeId: node.id, port, x: w.x, y: w.y };
  pointer.value = w;
  capture(svg.value, ev.pointerId);
}

function onInputPortUp(ev, node, port) {
  if (!linking.value) return;
  ev.stopPropagation();
  // `connect` enforces one edge per input port, matching Gaea: connecting to an occupied input
  // replaces what was there rather than stacking. The snapshot goes first so the change is undoable.
  snapshot();
  const edge = connect(state.graph, linking.value.nodeId, node.id, port, linking.value.port);
  if (edge) bus.emit('graph:changed', { reason: 'connect' });
  linking.value = null;
}

function onMove(ev) {
  if (pan.value) {
    view.value = {
      ...view.value,
      x: pan.value.vx + (ev.clientX - pan.value.x0),
      y: pan.value.vy + (ev.clientY - pan.value.y0),
    };
    return;
  }
  const w = toWorld(ev.clientX, ev.clientY);
  pointer.value = w;
  if (dragNode.value) {
    const n = state.graph.nodes.find((x) => x.id === dragNode.value.nodeId);
    if (n) {
      n.x = Math.round(w.x - dragNode.value.dx);
      n.y = Math.round(w.y - dragNode.value.dy);
      // `state` is a plain object and is written directly on purpose; the store's `version`
      // counter is what makes Vue recompute, and it only moves on BUS events. Without this the
      // coordinates changed and the SVG never redrew -- a node that moves in the data and not on
      // screen, which reads as "dragging does not work".
      bus.emit('node:changed', { id: n.id, reason: 'drag' });
    }
    return;
  }
  if (linking.value) linking.value = { ...linking.value, x: w.x, y: w.y };
}

function onUp() {
  dragNode.value = null;
  pan.value = null;
  linking.value = null;
}

function onWheel(ev) {
  ev.preventDefault();
  const r = svg.value.getBoundingClientRect();
  const mx = ev.clientX - r.left;
  const my = ev.clientY - r.top;
  const v = view.value;
  // Zoom about the cursor: the world point under the pointer must not move.
  const k = Math.min(3, Math.max(0.25, v.k * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
  view.value = {
    k,
    x: mx - ((mx - v.x) / v.k) * k,
    y: my - ((my - v.y) / v.k) * k,
  };
}

/** Frame every node, with a margin. */
function frameAll() {
  const ns = state.graph.nodes || [];
  const el = svg.value;
  if (!el) return;
  if (!ns.length) { view.value = { x: 40, y: 30, k: 1 }; return; }
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const n of ns) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + NODE_W); y1 = Math.max(y1, n.y + NODE_H);
  }
  const pad = 40;
  const w = el.clientWidth || 800;
  const h = el.clientHeight || 500;
  const k = Math.min(1.5, Math.max(0.25, Math.min(w / (x1 - x0 + pad * 2), h / (y1 - y0 + pad * 2))));
  view.value = {
    k,
    x: w / 2 - ((x0 + x1) / 2) * k,
    y: h / 2 - ((y0 + y1) / 2) * k,
  };
}

/* -------------------------------------------------------------------- events --- */

let offBus = [];

/** Adding a node: centred on the visible area, so it lands where the user is looking. */
function onAdd({ name }) {
  const el = svg.value;
  const w = el ? el.clientWidth : 800;
  const h = el ? el.clientHeight : 500;
  const c = toWorld(el ? el.getBoundingClientRect().left + w / 2 : w / 2,
    el ? el.getBoundingClientRect().top + h / 2 : h / 2);
  // A small stagger so repeated adds do not land exactly on top of each other, the same nudge
  // `GraphEditor.addNodeCenter` applied.
  const jitter = (state.graph.nodes.length % 5) * 14;
  snapshot();
  const node = addNode(state.graph, name, c.x - NODE_W / 2 + jitter, c.y - NODE_H / 2 + jitter);
  if (node) {
    selectNode(node.id);
    bus.emit('graph:changed', { reason: 'add' });
    status.value = `${name}`;
  }
}

const status = ref('');

onMounted(() => {
  window.addEventListener('gaea:add-node', onAdd);
  // The toolbar's `fit` button reaches the canvas this way. Without this listener the button
  // dispatched an event into an empty room.
  window.addEventListener('gaea:fit', frameAll);
  offBus = [
    // `frameAll` on a replaced graph is the behaviour the old editor had, and it is what makes a
    // loaded example visible instead of parked off-screen.
    bus.on('graph:replaced', () => { frameAll(); status.value = ''; linking.value = null; }),
  ];
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener('gaea:add-node', onAdd);
  window.removeEventListener('gaea:fit', frameAll);
  window.removeEventListener('keydown', onKey);
  for (const off of offBus) off();
  offBus = [];
});

function onKey(ev) {
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selected) {
    ev.preventDefault();
    snapshot();
    if (removeNode(state.graph, state.selected)) {
      selectNode(null);
      bus.emit('graph:changed', { reason: 'delete' });
    }
  }
}

defineExpose({ frameAll, view });
</script>

<template>
  <svg
    ref="svg"
    class="graph graph-surface"
    :class="{ panning: !!pan, linking: !!linking }"
    @pointerdown="onBackgroundDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @contextmenu.prevent
    @wheel="onWheel"
  >
    <!-- One transform for the whole graph: pan and zoom are a single attribute change. -->
    <g :transform="`translate(${view.x} ${view.y}) scale(${view.k})`">
      <!-- Edges first, so nodes paint over them. -->
      <path
        v-for="e in viewEdges"
        :key="e.id"
        class="edge"
        :d="`M ${e.x1} ${e.y1} C ${e.x1 + 40} ${e.y1}, ${e.x2 - 40} ${e.y2}, ${e.x2} ${e.y2}`"
      />

      <!-- The link being dragged, drawn from the source port to the cursor. -->
      <path
        v-if="linking"
        class="edge pending"
        :d="`M ${linking.x + NODE_W} ${linking.y} C ${linking.x + NODE_W + 40} ${linking.y}, ${pointer.x - 40} ${pointer.y}, ${pointer.x} ${pointer.y}`"
      />

      <g
        v-for="n in viewNodes"
        :key="n.id"
        class="node"
        :class="{ selected: n.selected, missing: !n.implemented }"
      >
        <rect
          :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H" rx="5"
          @pointerdown="onNodeDown($event, n)"
        />
        <!-- Centred by `dominant-baseline`, NOT by a numeric offset. The first version did both:
             it set the baseline in CSS and added +4 to the y, so the label sat low. -->
        <text
          :x="n.x + NODE_W / 2"
          :y="n.y + NODE_H / 2"
          text-anchor="middle"
          dominant-baseline="central"
        >
          {{ n.name }}
        </text>

        <!-- Output ports, on the right edge. -->
        <circle
          v-for="i in n.outputs" :key="`o${i}`"
          class="port out"
          :cx="n.x + NODE_W"
          :cy="n.y + NODE_H / 2 + (i - 1) * 10"
          r="4"
          @pointerdown="onPortDown($event, n, i - 1)"
        />
        <!-- Input ports, on the left edge. -->
        <circle
          v-for="i in n.inputs" :key="`i${i}`"
          class="port in"
          :cx="n.x"
          :cy="n.y + NODE_H / 2 + (i - 1) * 10"
          r="4"
          @pointerup="onInputPortUp($event, n, i - 1)"
        />
      </g>
    </g>
  </svg>

  <p v-if="!viewNodes.length" class="hint">{{ term('Drag a node in from the library, or load an example.') }}</p>
  <p v-if="status" class="status">{{ status }}</p>
</template>

<style scoped>
/* The surface fills `.graphview`, which style.css already positions. */
.graph-surface {
  position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none;
  background: radial-gradient(circle at 30% 20%, #23232a, #17171b 70%);
  cursor: default;
}
.graph.panning { cursor: grabbing; }
.graph.linking { cursor: crosshair; }

.node rect {
  fill: #2e2e37; stroke: #55555f; stroke-width: 1; cursor: grab;
}
.node.selected rect { stroke: #7cb7ff; stroke-width: 2; }
.node.missing rect { fill: #2a2626; stroke: #6b4a4a; stroke-dasharray: 3 2; }
.node text {
  fill: var(--tx-0, #ddd); font: 11px system-ui, sans-serif; pointer-events: none;
}
.node.missing text { fill: #b99; }

.edge { fill: none; stroke: #6f7d8c; stroke-width: 1.5; }
.edge.pending { stroke: #7cb7ff; stroke-dasharray: 4 3; }

.port { fill: #45454f; stroke: #6a6a76; stroke-width: 1; cursor: crosshair; }
.port.out:hover, .port.in:hover { fill: #7cb7ff; }

.hint {
  position: absolute; inset: 50% 0 auto 0; text-align: center; margin: 0;
  font-size: 12px; color: var(--tx-2, #888); pointer-events: none;
}
.status {
  position: absolute; inset: auto 0 0 0; margin: 0; padding: 3px 8px; font-size: 11px;
  background: rgba(0, 0, 0, 0.45); color: #ddd;
}
</style>
