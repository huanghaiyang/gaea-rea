#!/usr/bin/env python3
"""Make GraphCanvas perform the graph mutations instead of emitting events nobody handles.

WHAT WAS WRONG
`GraphCanvas` emitted `graph:add`, `graph:remove` and `graph:connect` on the bus and waited for
someone to act. Nobody does. The graph mutations in this codebase live on the `GraphEditor` CLASS
(`editor.addNodeCenter()`, `editor.deleteSelected()`), which the Vue rewrite replaced -- so the
new component was politely asking a listener that no longer existed.

The correct pattern is the one `GraphEditor.deleteSelected` uses, read from the source:

    snapshot()                                    # from state.js, for undo
    addNode / removeNode / connect (state.graph, ...)   # from graph.js
    bus.emit('graph:changed', { reason })

These imports are added and the three handlers are rewritten to call them directly.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "GraphCanvas.vue"
t = p.read_text(encoding="utf-8")

if "addNode," in t and "from '@js/graph.js'" in t:
    print("  GraphCanvas already mutates directly")
    sys.exit(0)

old_imp = """import { term } from '@js/i18n.js';
import { bus } from '@js/state.js';"""
new_imp = """import { term } from '@js/i18n.js';
// The mutations are performed here, not requested over the bus. `GraphEditor` used to own them,
// and the bus events this component first emitted had no listener at all -- the palette worked,
// the SVG rendered, and nothing ever appeared.
import { bus, snapshot, state as rawState } from '@js/state.js';
import { addNode, removeNode, connect } from '@js/graph.js';"""
if old_imp not in t:
    print("  !! import block not found")
    sys.exit(1)
t = t.replace(old_imp, new_imp, 1)

# --- connection ---------------------------------------------------------------
old = """  // The state layer already enforces one edge per input port, matching Gaea: connecting to an
  // occupied input replaces what was there rather than stacking.
  bus.emit('graph:connect', { from: linking.value.nodeId, fromPort: linking.value.port, to: node.id, toPort: port });
  linking.value = null;"""
new = """  // `connect` enforces one edge per input port, matching Gaea: connecting to an occupied input
  // replaces what was there rather than stacking. The snapshot goes first so the change is undoable.
  snapshot();
  const edge = connect(state.graph, linking.value.nodeId, node.id, port, linking.value.port);
  if (edge) bus.emit('graph:changed', { reason: 'connect' });
  linking.value = null;"""
if old not in t:
    print("  !! connect handler not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# --- add ----------------------------------------------------------------------
old = """  const c = toWorld(el ? el.getBoundingClientRect().left + w / 2 : w / 2,
    el ? el.getBoundingClientRect().top + h / 2 : h / 2);
  bus.emit('graph:add', { type: name, x: c.x - NODE_W / 2, y: c.y - NODE_H / 2 });"""
new = """  const c = toWorld(el ? el.getBoundingClientRect().left + w / 2 : w / 2,
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
  }"""
if old not in t:
    print("  !! add handler not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# --- remove -------------------------------------------------------------------
old = """  if (ev.key === 'Delete' && state.selected) {
    bus.emit('graph:remove', { id: state.selected });
  }"""
new = """  if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selected) {
    ev.preventDefault();
    snapshot();
    if (removeNode(state.graph, state.selected)) {
      selectNode(null);
      bus.emit('graph:changed', { reason: 'delete' });
    }
  }"""
if old not in t:
    print("  !! delete handler not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# The graph:replaced listener should also clear the transient link state.
old = """    bus.on('graph:replaced', () => { frameAll(); status.value = ''; }),
    bus.on('graph:add', () => { status.value = ''; }),"""
new = """    bus.on('graph:replaced', () => { frameAll(); status.value = ''; linking.value = null; }),"""
if old in t:
    t = t.replace(old, new, 1)
else:
    print("  note: bus subscription block not matched; left as is")

p.write_text(t, encoding="utf-8")
print("  GraphCanvas.vue: add / connect / remove now mutate the graph directly")
