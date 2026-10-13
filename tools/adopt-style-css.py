#!/usr/bin/env python3
"""Align the Vue components to `web/css/style.css` instead of inventing class names.

THE MISTAKE THIS CORRECTS
`web/css/style.css` (14 KB) is the stylesheet the pre-Vue shell used, and it styles an exact set of
selectors: `#layout` with four NAMED grid areas, `#library`/`#graphwrap`/`#inspector`/`#viewport`,
`.panel`/`.panel-head`/`.panel-body`/`.pill`, `.lib-list`/`.lib-group`/`.lib-item.impl`,
`.graphview`/`#graph-canvas`, `.node-head`/`.node-title`. Every Vue component in the first pass
used class names of my own invention, so none of it applied and the page looked broken.

Two of the four reported symptoms trace directly here:
  * the 2D/3D toggle did nothing -- a scoped `.c3d { display: none }` overrode `Viewport`'s own
    `hidden`-attribute switching (fixed in Viewport3D.vue)
  * "global styles and the property panel look wrong" -- the ids and classes did not match

This rewrites the class names and roots to match the stylesheet, and deletes the scoped rules that
duplicate or contradict it.
"""
import pathlib
import re
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
SRC = WS / "web" / "src"

# ------------------------------------------------------------- GraphStage ------
p = SRC / "components" / "GraphStage.vue"
p.write_text("""<script setup>
/**
 * GraphStage — the graph panel, inside the frame `style.css` defines.
 *
 * `#graphwrap` is a named grid area, `.graphview` is the positioned box and `#graph-canvas` is the
 * drawing surface. Those three names are the stylesheet's contract; the first version used a
 * `.stage` class of my own and got none of the layout.
 */
import GraphCanvas from './GraphCanvas.vue';
import { term } from '@js/i18n.js';
</script>

<template>
  <section id="graphwrap" class="panel">
    <div class="panel-head">
      <h2>{{ term('Graph') }}</h2>
    </div>
    <div class="graphview">
      <GraphCanvas />
    </div>
  </section>
</template>
""", encoding="utf-8")
print("  GraphStage.vue -> #graphwrap / .panel / .graphview / #graph-canvas")

# ------------------------------------------------------------- GraphCanvas -----
p = SRC / "components" / "GraphCanvas.vue"
t = p.read_text(encoding="utf-8")
# The SVG replaces the canvas, so it carries `#graph-canvas`'s role but must not take that id
# (the stylesheet's canvas rules would not apply to an SVG the same way). A matching class plus a
# tiny scoped rule is the honest arrangement.
t = t.replace('    class="graph"', '    class="graph graph-surface"')
t = t.replace(""".graph {
  display: block; width: 100%; height: 100%; touch-action: none;
  background: radial-gradient(circle at 30% 20%, #23232a, #17171b 70%);
  cursor: default;
}""", """/* The surface fills `.graphview`, which style.css already positions. */
.graph-surface {
  position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none;
  background: radial-gradient(circle at 30% 20%, #23232a, #17171b 70%);
  cursor: default;
}""")
t = t.replace(""".hint {
  position: absolute; inset: 50% 0 auto 0; text-align: center; margin: 0;
  font-size: 12px; color: #888; pointer-events: none;
}""", """.hint {
  position: absolute; inset: 50% 0 auto 0; text-align: center; margin: 0;
  font-size: 12px; color: var(--tx-2, #888); pointer-events: none;
}""")
p.write_text(t, encoding="utf-8")
print("  GraphCanvas.vue -> .graph-surface inside .graphview")

# ------------------------------------------------------------- NodePalette -----
p = SRC / "components" / "NodePalette.vue"
t = p.read_text(encoding="utf-8")
# Roots and the list markup style.css already knows.
t = t.replace('<aside class="panel" id="library">', '<aside id="library" class="panel">')
t = t.replace('<div class="palette-controls">', '<div class="lib-filters">')
t = t.replace('<div class="palette-scroll" role="listbox"', '<div class="lib-list" role="listbox"')
t = t.replace('<h3 class="cat">', '<h3 class="lib-group">')
t = t.replace(':class="[\'node-row\', { missing: !row.implemented }]"',
              ":class=\"['lib-item', row.implemented ? 'impl' : 'dim']\"")
t = t.replace('<span class="dot" :class="row.implemented ? \'ok\' : \'off\'" />',
              '<span class="dot" />')
t = t.replace('<span class="tag">{{ term(\'catalogue only\') }}</span>',
              '<span class="cnt">{{ term(\'catalogue only\') }}</span>')
t = t.replace('<span class="nm">', '<span class="nm">')
# Header count uses the stylesheet's pill.
t = t.replace('<span class="count"', '<span class="pill"')
# The scoped block duplicated style.css wholesale; keep only what it does not cover.
s = t.find("<style scoped>")
e = t.find("</style>")
if s >= 0 and e > s:
    t = t[:s] + """<style scoped>
/* Only the few things style.css does not already define. */
#library { min-height: 0; }
</style>
""" + t[e + len("</style>"):]
p.write_text(t, encoding="utf-8")
print("  NodePalette.vue -> #library / .lib-filters / .lib-list / .lib-group / .lib-item")

# ------------------------------------------------------------- ParamPanel ------
p = SRC / "components" / "ParamPanel.vue"
t = p.read_text(encoding="utf-8")
t = t.replace('<aside class="panel" id="inspector">', '<aside id="inspector" class="panel">')
t = t.replace('<div v-else class="param-scroll">', '<div v-else class="panel-body">')
t = t.replace('<div class="node-head">', '<div class="node-head"><div class="node-title">')
t = t.replace('</strong>\n        <span v-if', '</strong>\n        <span v-if')
t = t.replace("""      <div class="node-head"><div class="node-title">
        <strong>{{ selNode.name }}</strong>""",
"""      <div class="node-head">
        <div class="node-title">
          <strong>{{ selNode.name }}</strong>""")
t = t.replace("""        <span v-else class="algo missing">{{ term('no kernel') }}</span>
      </div>""",
"""          <span v-else class="pill">{{ term('no kernel') }}</span>
        </div>
      </div>""")
t = t.replace('<span v-if="algorithmOf(selNode.name)" class="algo">',
              '<span v-if="algorithmOf(selNode.name)" class="pill">')
t = t.replace('<button v-if="selNode" class="reset"', '<button v-if="selNode" class="tb small"')
s = t.find("<style scoped>")
e = t.find("</style>")
if s >= 0 and e > s:
    t = t[:s] + """<style scoped>
/* style.css supplies the panel frame, the head and the node title. What it has no opinion on is
   the two-column parameter grid, so only that is defined here. */
.param { display: grid; grid-template-columns: minmax(96px, 44%) 1fr; gap: 4px 8px; align-items: center; padding: 3px 0; }
.param label { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.param input[type='range'] { width: 100%; }
.param output { font-size: 10.5px; color: var(--tx-2, #999); font-variant-numeric: tabular-nums; }
.info { display: inline-block; width: 12px; height: 12px; line-height: 12px; text-align: center;
        border-radius: 50%; border: 1px solid currentColor; font-size: 9px; color: var(--tx-2, #888); }
</style>
""" + t[e + len("</style>"):]
p.write_text(t, encoding="utf-8")
print("  ParamPanel.vue -> #inspector / .panel-body / .node-head / .node-title")
