#!/usr/bin/env python3
"""Wire the toolbar controls to what they actually do, copying the old shell's handlers.

WHAT WAS WRONG
Four of the six topbar controls were no-ops, and each failed differently:

  fit    dispatched a `gaea:fit` event that NOTHING listened for
  res    wrote a component-local ref; `state.graph.build.size` never changed
  seed   same
  dice   same

Reading a control, changing a ref of my own, and hoping was the whole implementation. The old
`app.js` had these handlers, and they are short -- there was no reason to invent them:

    $('#btn-fit')   .addEventListener('click',  () => editor.fit());
    $('#sel-res')   .addEventListener('change', e => {
      state.graph.build.size = Number(e.target.value) | 0;
      evaluator.requestNow('resolution');
    });
    $('#inp-seed')  .addEventListener('change', e => {
      state.graph.build.seed = Number(e.target.value) | 0;
      evaluator.requestNow('seed');
    });
    $('#btn-dice')  .addEventListener('click', () => {
      const s = Math.floor(Math.random() * 100000);
      state.graph.build.seed = s;
      $('#inp-seed').value = String(s);
      evaluator.requestNow('seed');
    });

`fit` reaches the graph through a `gaea:fit` window event, which `GraphCanvas` now listens for --
the same mechanism `gaea:add-node` already uses, because the canvas is the component that owns the
view transform.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
APP = WS / "web" / "src" / "App.vue"
GC = WS / "web" / "src" / "components" / "GraphCanvas.vue"

# ------------------------------------------------------------------- App.vue ----
t = APP.read_text(encoding="utf-8")

old = """function onNew() { newGraph(); refreshHistory(); }
function onDemo() { loadDemo(); refreshHistory(); }
function onFit() { window.dispatchEvent(new CustomEvent('gaea:fit')); }
function onRamp(ev) { ramp.value = ev.target.value; setRamp(ramp.value); }
function onExag(ev) { exaggeration.value = Number(ev.target.value); setExaggeration(exaggeration.value); }
function onSeed(ev) { seed.value = Number(ev.target.value); }
function onDice() { seed.value = Math.floor(Math.random() * 100000); }
function onRes(ev) { resolution.value = Number(ev.target.value); }
function onMode(m) { setViewMode(m); }"""

new = """function onNew() { newGraph(); refreshHistory(); }
function onDemo() { loadDemo(); refreshHistory(); }

/**
 * Frame every node.
 *
 * Through a window event rather than a ref, because `GraphCanvas` owns the view transform and is
 * not this component's child in any way it can reach. Dispatching an event that nothing listens
 * for is what the first version did.
 */
function onFit() { window.dispatchEvent(new CustomEvent('gaea:fit')); }

function onRamp(ev) { ramp.value = ev.target.value; setRamp(ramp.value); }
function onExag(ev) { exaggeration.value = Number(ev.target.value); setExaggeration(exaggeration.value); }

/** The build resolution lives on the graph, so it is written there and re-evaluated. */
function onRes(ev) {
  const size = Number(ev.target.value) | 0;
  resolution.value = size;
  state.graph.build.size = size;
  evaluator.requestNow('resolution');
  refreshHistory();
}

/** Likewise the seed. `state.graph.build` is what the evaluator reads. */
function onSeed(ev) {
  const v = Number(ev.target.value) | 0;
  seed.value = v;
  state.graph.build.seed = v;
  evaluator.requestNow('seed');
}

function onDice() {
  const s = Math.floor(Math.random() * 100000);
  seed.value = s;
  state.graph.build.seed = s;
  // The field must show the value that was actually used, not the previous one.
  evaluator.requestNow('seed');
  refreshHistory();
}

function onMode(m) { setViewMode(m); }"""
if old not in t:
    print("  !! action block not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# The readouts must follow the graph, not hold their own copy.
old = """onMounted(() => {
  window.addEventListener('keydown', onKey);
  refreshHistory();"""
new = """onMounted(() => {
  window.addEventListener('keydown', onKey);
  refreshHistory();
  // Adopt whatever the loaded graph actually carries, so the controls never show a stale value.
  if (state.graph && state.graph.build) {
    resolution.value = state.graph.build.size ?? resolution.value;
    seed.value = state.graph.build.seed ?? seed.value;
  }"""
if old not in t:
    print("  note: mount block not matched; controls will still write through")
else:
    t = t.replace(old, new, 1)

APP.write_text(t, encoding="utf-8")
print("  App.vue: fit/res/seed/dice now perform the old shell's actions")

# ------------------------------------------------------------- GraphCanvas -----
g = GC.read_text(encoding="utf-8")
if "gaea:fit" not in g:
    old = """onMounted(() => {
  window.addEventListener('gaea:add-node', onAdd);"""
    new = """onMounted(() => {
  window.addEventListener('gaea:add-node', onAdd);
  // The toolbar's `fit` button reaches the canvas this way. Without this listener the button
  // dispatched an event into an empty room.
  window.addEventListener('gaea:fit', frameAll);"""
    if old not in g:
        print("  !! GraphCanvas mount block not found")
        sys.exit(1)
    g = g.replace(old, new, 1)
    g = g.replace("""onBeforeUnmount(() => {
  window.removeEventListener('gaea:add-node', onAdd);""",
"""onBeforeUnmount(() => {
  window.removeEventListener('gaea:add-node', onAdd);
  window.removeEventListener('gaea:fit', frameAll);""", 1)
    GC.write_text(g, encoding="utf-8")
    print("  GraphCanvas.vue: listens for gaea:fit")
else:
    print("  GraphCanvas already listens for gaea:fit")
