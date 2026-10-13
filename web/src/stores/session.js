/**
 * stores/session.js — the wiring the old `app.js` did, ported rather than re-derived.
 *
 * WHAT WENT WRONG IN THE FIRST VUE PASS
 * The shell was rebuilt but the PLUMBING was not ported, so the new page had the library and an
 * empty canvas while the pure-HTML version it replaced could build a demo graph, evaluate it and
 * render terrain. Two specific mistakes:
 *
 *   * `Viewport3D.vue` wrapped `Renderer3D` — the low-level three.js renderer. The old app uses
 *     `Viewport`, which owns the 2D and 3D canvases, the mesh worker, the colour ramp, the
 *     exaggeration and `setField()`. Wrapping the wrong class is why the viewport stayed black:
 *     nothing ever handed it a field.
 *   * Nothing ever called `buildDemoGraph()` or the evaluator, so there was no graph to evaluate
 *     and no evaluation to display.
 *
 * This module is a deliberate PORT of `app.js`'s wiring. That logic is proven; re-deriving it is
 * how the regression happened.
 */
import { ref, shallowRef } from 'vue';
import { buildDemoGraph } from '@js/demo-graph.js';
import { findTerminal } from '@js/graph.js';
import { EvalController } from '@js/eval-controller.js';
import { Viewport } from '@js/viewport.js';
import { state, selectNode, clearHistory, bus } from '@js/state.js';

// Re-exported so a component can take the viewport helpers and the state from one place. Without
// this the import in Viewport3D.vue resolved to nothing, and a missing named export is a MODULE
// ERROR: it aborted the whole app rather than failing one component.
export { state };

/** The evaluator, created once. */
export const evaluator = new EvalController();

/** The viewport, created when a component hands over its canvases. */
export const viewport = shallowRef(null);

/** Live readouts the toolbar shows. */
export const evalStatus = ref('idle');
export const lastMs = ref(0);
export const glAvailable = ref(false);
export const vpStatus = ref('');

/**
 * Create the viewport over the two canvases.
 *
 * Called by the component that owns them, because both elements must exist and be laid out before
 * `Viewport` measures the host box.
 */
export function attachViewport(canvas2d, canvas3d, opts = {}) {
  const vp = new Viewport(canvas2d, canvas3d, { host: opts.host || canvas2d.parentElement });
  viewport.value = vp;
  glAvailable.value = !!vp.available3D;
  vpStatus.value = vp.status || '';
  state.glAvailable = glAvailable.value;
  vp.setRamp(state.ramp);
  vp.setExaggeration(state.exaggeration);
  vp.setMode(state.viewMode);

  // HAND OVER THE CURRENT FIELD IMMEDIATELY. `Viewport3D` is unmounted and remounted by the
  // `view` checkbox, and a fresh `Viewport` has no field -- the field was only pushed on
  // `eval:done`, and ticking the checkbox evaluates nothing. The panel came back black until the
  // graph was next re-evaluated.
  const id = state.previewRoot || state.selected;
  const f = (id && state.fields.get(id)) || [...state.fields.values()][0];
  if (f) vp.setField(f);
  return vp;
}

/**
 * The renderer the boot exposes for inspection.
 *
 * `Viewport` creates its three.js renderer lazily, so there is no moment at boot when it can be
 * captured. Handing out a lookup instead of an instance is what lets `window.__gaea.overlays`
 * always read the live object.
 */
window.__viewportRenderer = () => viewport.value?.renderer3d || null;

export function detachViewport() {
  viewport.value?.dispose?.();
  viewport.value = null;
}

/**
 * Replace the graph and re-evaluate.
 *
 * The order matters and is copied from `app.js`: clear the cached fields BEFORE announcing
 * `graph:replaced`, or the evaluator can pick up a stale field for a root id that no longer
 * exists, and the fit has to happen after the nodes are in place.
 */
export function loadGraph(built, opts = {}) {
  state.graph = built.graph;
  state.fields.clear();
  state.lastStats = [];
  state.lastErrors = [];
  state.previewRoot = null;
  selectNode(built.terminal || findTerminal(state.graph));
  clearHistory();
  bus.emit('graph:replaced', { reason: opts.reason || 'load' });
  bus.emit('node:changed', { id: state.selected });
  evaluator.requestNow('load');
  return built;
}

/** Build and load the demo pipeline. */
export function loadDemo() {
  return loadGraph(buildDemoGraph(), { reason: 'demo' });
}

/** An empty graph with just a terminal, which is what "new" means here. */
export function newGraph() {
  state.graph = { nodes: [], edges: [], build: { size: 512, seed: 0 } };
  state.fields.clear();
  selectNode(null);
  clearHistory();
  bus.emit('graph:replaced', { reason: 'new' });
  return state.graph;
}

/* ------------------------------------------------------------------- view ---- */

export function setRamp(name) {
  state.ramp = name;
  viewport.value?.setRamp(name);
}

export function setExaggeration(v) {
  state.exaggeration = v;
  viewport.value?.setExaggeration(v);
}

export function setViewMode(mode) {
  state.viewMode = mode;
  viewport.value?.setMode(mode);
}

export function exportImage() {
  viewport.value?.exportPNG?.();
}

/* ------------------------------------------------------------------- eval ---- */

/**
 * Keep the status readout live.
 *
 * The evaluator already announces everything on the bus; subscribing here is how the toolbar stays
 * current without polling.
 */
export function startEvalReporting() {
  const offs = [
    bus.on('eval:start', () => { evalStatus.value = 'evaluating'; }),
    bus.on('eval:done', (p) => {
      evalStatus.value = p && p.errors && p.errors.length ? 'errors' : 'ready';
      lastMs.value = (p && p.ms) || 0;
      // Feed the viewport whichever field the evaluator produced for the current root.
      const id = state.previewRoot || state.selected;
      const f = id ? state.fields.get(id) : [...state.fields.values()][0];
      if (f && viewport.value) viewport.value.setField(f);
    }),
    bus.on('selection:changed', () => {
      const id = state.selected;
      const f = id ? state.fields.get(id) : null;
      if (f && viewport.value) viewport.value.setField(f);
    }),
  ];
  return () => { for (const off of offs) off(); };
}
