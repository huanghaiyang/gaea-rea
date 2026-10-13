#!/usr/bin/env python3
"""Unwrap the store's computeds for the templates.

THE RULE THAT BIT
In `<script setup>` Vue auto-unwraps refs that are LOCAL bindings, because the compiler can see
they were declared as refs. A ref merely IMPORTED from another module is not provably a ref, so it
is handed to the template as the ref OBJECT. A computed is always truthy, so `v-if="selectedNode"`
took the selected branch while `selectedNode.name` read `undefined` off the ref -- the panel
rendered its "no parameters" state next to an empty heading.

The fix is one local alias per imported computed. A local `const` holding a ref IS unwrapped, and
a local `const` holding a plain value works unchanged, so this is correct either way.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
P = WS / "web" / "src" / "components" / "ParamPanel.vue"
N = WS / "web" / "src" / "components" / "NodePalette.vue"

# --------------------------------------------------------------- ParamPanel ----
t = P.read_text(encoding="utf-8")
if "const sel = selectedNode;" in t:
    print("  ParamPanel already unwrapped")
else:
    old = """import { computed } from 'vue';
import { selectedSchema, selectedNode, selectedParams, setParam, resetParams, state, algorithmOf } from '../stores/app.js';"""
    new = """import { computed } from 'vue';
import {
  selectedSchema as schemaRef, selectedNode as nodeRef, selectedParams as paramsRef,
  setParam, resetParams, state, algorithmOf,
} from '../stores/app.js';

// LOCAL ALIASES. An imported ref is not auto-unwrapped in a template -- the compiler cannot prove
// it is a ref -- so `selectedNode` reached the template as the ref object, which is truthy. The
// panel therefore took the selected branch and then read `.name` off the ref, producing an empty
// heading beside a "no parameters" message. Rebinding to a local const makes Vue unwrap it.
const sel = nodeRef;
const schema = schemaRef;
const params = paramsRef;"""
    if old not in t:
        print("  !! ParamPanel import block not found")
        sys.exit(1)
    t = t.replace(old, new, 1)
    # Point the script body at the aliases.
    t = t.replace("const schema = selectedSchema.value;", "const schema = schema.value;")
    t = t.replace("const node = selectedNode.value;", "const node = sel.value;")
    t = t.replace("name in selectedParams.value", "name in params.value")
    # And the template.
    t = t.replace("v-if=\"!selectedNode\"", "v-if=\"!sel\"")
    t = t.replace("v-if=\"selectedNode\"", "v-if=\"sel\"")
    t = t.replace("selectedNode.id", "sel.id")
    t = t.replace("selectedNode.name", "sel.name")
    t = t.replace("v-else-if=\"!selectedNode\"", "v-else-if=\"!sel\"")
    P.write_text(t, encoding="utf-8")
    print("  ParamPanel.vue: imported computeds aliased to local bindings")

# -------------------------------------------------------------- NodePalette ----
n = N.read_text(encoding="utf-8")
if "const rows = palette;" in n:
    print("  NodePalette already unwrapped")
else:
    old = "import { palette, byCategory, coverage, filter, implementedOnly, selectNode, state } from '../stores/app.js';"
    new = """import {
  palette as paletteRef, byCategory as byCategoryRef, coverage as coverageRef,
  filter as filterRef, implementedOnly as implRef, selectNode, state,
} from '../stores/app.js';

// Local aliases so the template receives unwrapped values rather than the ref objects. See the
// note in ParamPanel.vue: an imported ref is not auto-unwrapped by the template compiler.
const rows = paletteRef;
const groups = byCategoryRef;
const counts = coverageRef;
const filter = filterRef;
const implementedOnly = implRef;"""
    if old not in n:
        print("  !! NodePalette import block not found")
        sys.exit(1)
    n = n.replace(old, new, 1)
    n = n.replace('v-for="[cat, rows] in byCategory"', 'v-for="[cat, items] in groups"')
    n = n.replace('v-for="row in rows"', 'v-for="row in items"')
    n = n.replace('v-if="!palette.length"', 'v-if="!rows.length"')
    n = n.replace("coverage.done", "counts.done").replace("coverage.total", "counts.total")
    N.write_text(n, encoding="utf-8")
    print("  NodePalette.vue: imported computeds aliased to local bindings")
