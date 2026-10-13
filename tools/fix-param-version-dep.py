#!/usr/bin/env python3
"""Give ParamPanel a reactive dependency: the store's `version` bridge.

THE BUG, and it is one I introduced while fixing an earlier one
`state` is a PLAIN object on purpose -- `state.js` mutates the raw target, so a `reactive()` proxy
would never observe those writes. Reactivity is bridged by `version`, which the store bumps on
every bus mutation. The store's own computeds read `version`; the ones I then added to ParamPanel
did not. A computed over a plain object has no tracked dependency, so it evaluates once and caches
forever: the panel rendered its empty state and never re-evaluated, while `window.__store`
demonstrably held the right node in the same page.

The template's bare `currentNode()` calls had the same problem for a different reason -- a function
invoked from a template is only re-run when the component re-renders, and with no tracked
dependency this component never re-renders at all.
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "ParamPanel.vue"
t = P.read_text(encoding="utf-8")

if "version.value" in t:
    print("  ParamPanel already reads the version bridge")
    sys.exit(0)

old = """import {
  schemaFor, setParam, resetParams, state, algorithmOf,
} from '../stores/app.js';"""
new = """import {
  schemaFor, setParam, resetParams, state, algorithmOf, version,
} from '../stores/app.js';"""
if old not in t:
    print("  !! import block not found")
    sys.exit(1)
t = t.replace(old, new, 1)

old = """const rows = computed(() => {
  const node = currentNode();"""
new = """const rows = computed(() => {
  // The reactive dependency. `state` is deliberately not a reactive proxy, so without reading the
  // store's `version` counter this computed has nothing to invalidate it and caches forever.
  version.value;
  const node = currentNode();"""
if old not in t:
    print("  !! rows computed not found")
    sys.exit(1)
t = t.replace(old, new, 1)

old = """function currentNode() {
  const id = state.selected;
  if (!id) return null;
  return (state.graph?.nodes || []).find((n) => n.id === id) || null;
}"""
new = """function currentNode() {
  const id = state.selected;
  if (!id) return null;
  return (state.graph?.nodes || []).find((n) => n.id === id) || null;
}

/**
 * The template's view of the selection.
 *
 * A LOCAL computed, not a bare function call. A function invoked from the template is only re-run
 * when the component re-renders, and this component has no other tracked dependency -- so it never
 * would. A local computed is also unwrapped by the compiler, which is the property three earlier
 * attempts at importing one failed to get.
 */
const selNode = computed(() => {
  version.value;
  return currentNode();
});"""
if old not in t:
    print("  !! currentNode not found")
    sys.exit(1)
t = t.replace(old, new, 1)

for a, b in (('v-if="!currentNode()"', 'v-if="!selNode"'),
             ('v-if="currentNode()"', 'v-if="selNode"'),
             ('currentNode().id', 'selNode.id'),
             ('currentNode().name', 'selNode.name')):
    t = t.replace(a, b)

P.write_text(t, encoding="utf-8")
print("  ParamPanel.vue: version bridge wired into rows and selNode")
