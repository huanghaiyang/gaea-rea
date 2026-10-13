#!/usr/bin/env python3
"""Four fixes, each traced to a specific declaration rather than to a guess.

1. GRAPH NODE TEXT NOT CENTRED
`style.css` has no `.node text` rule -- the original graph is a `<canvas>`, so there was never SVG
text; the SVG rewrite introduced it. My scoped CSS already set `dominant-baseline: middle` AND the
markup added `+4` to the y, so the text was corrected twice and sat low. One or the other.

2. THE PARAMETER ROWS COLLAPSED TO TWO LINES EACH
`style.css` defines `.param-list { display: flex; flex-direction: column; gap: 3px; }` and nothing
called `.param`. My grid was an invention and it was collapsing: the label took the first grid
cell, the control wrapped to the next row. The stylesheet's own container is used now, with each
row a flex line putting the label and the control side by side.

3. THE SEARCH BOX WAS A BROWSER DEFAULT
`style.css` styles `.search` -- background, border, radius, padding. The input had no class, so none
of it applied and it rendered as a white rectangle.

4. THE LIST WAS INDENTED BY A BROWSER DEFAULT
The markup is `<section><ul><li class="lib-item">`, and a `<ul>` carries `padding-inline-start:
40px` from the user agent. My original scoped block reset it; `adopt-style-css.py` deleted that
block when it replaced the styles with "only what style.css does not cover", and the reset was part
of what got dropped.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
GC = WS / "web" / "src" / "components" / "GraphCanvas.vue"
PP = WS / "web" / "src" / "components" / "ParamPanel.vue"
NP = WS / "web" / "src" / "components" / "NodePalette.vue"

# =============================================================== 1. node text ====
g = GC.read_text(encoding="utf-8")

old = """        <text :x="n.x + NODE_W / 2" :y="n.y + NODE_H / 2 + 4" text-anchor="middle">"""
new = """        <!-- Centred by `dominant-baseline`, NOT by a numeric offset. The first version did both:
             it set the baseline in CSS and added +4 to the y, so the label sat low. -->
        <text
          :x="n.x + NODE_W / 2"
          :y="n.y + NODE_H / 2"
          text-anchor="middle"
          dominant-baseline="central"
        >"""
if old not in g:
    print("  !! node text not found")
    sys.exit(1)
g = g.replace(old, new, 1)

g = g.replace(""".node text {
  fill: #ddd; font: 11px system-ui, sans-serif; pointer-events: none;
  dominant-baseline: middle;
}""", """.node text {
  fill: var(--tx-0, #ddd); font: 11px system-ui, sans-serif; pointer-events: none;
}""")
GC.write_text(g, encoding="utf-8")
print("  GraphCanvas.vue: node text centred by baseline only")

# ============================================================ 2. param rows ====
p = PP.read_text(encoding="utf-8")

# The container style.css already defines.
p = p.replace('<div v-else class="panel-body">', '<div v-else class="panel-body param-list">')

# And the row becomes a single flex line.
old_style = p[p.find("<style scoped>"):p.find("</style>") + len("</style>")]
new_style = """<style scoped>
/* style.css supplies the panel frame, the head, the node title and `.param-list`. What it has no
   opinion on is how a label and its control share a line, so only that is defined here.
   A GRID was wrong: the label took the first cell and the control wrapped to the next row, which
   made every parameter two lines tall. */
.param {
  display: flex; align-items: center; gap: 8px; padding: 2px 0; min-width: 0;
}
.param > label {
  flex: 0 0 44%; min-width: 0;
  font-size: 11.5px; color: var(--tx-1, #ddd);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The control takes the rest, and a range input must be allowed to shrink or it pushes the row
   wider than the panel. */
.param > :not(label) { flex: 1 1 auto; min-width: 0; }
.param input[type='range'] { width: 100%; }
.param output {
  flex: 0 0 auto; font-size: 10.5px; color: var(--tx-2, #999);
  font-variant-numeric: tabular-nums; min-width: 3.5ch; text-align: right;
}
.param .vec { width: 100%; }
.info {
  display: inline-block; width: 12px; height: 12px; line-height: 12px; text-align: center;
  border-radius: 50%; border: 1px solid currentColor; font-size: 9px; color: var(--tx-2, #888);
  flex: 0 0 auto;
}
</style>"""
if old_style:
    p = p.replace(old_style, new_style, 1)
else:
    print("  note: ParamPanel had no scoped style block")
PP.write_text(p, encoding="utf-8")
print("  ParamPanel.vue: .param-list container, one flex line per parameter")

# =============================================================== 3. search box ====
n = NP.read_text(encoding="utf-8")

old = """      <input
        v-model="filter"
        type="search"
        :placeholder="term('Search nodes')"
        :aria-label="term('Search nodes')"
      />"""
new = """      <!-- `.search` is the class style.css styles; without it the input renders as a browser
           default, which is what the white rectangle in the panel was. -->
      <input
        v-model="filter"
        class="search"
        type="search"
        :placeholder="term('Search nodes')"
        :aria-label="term('Search nodes')"
      />"""
if old not in n:
    print("  !! search input not found")
    sys.exit(1)
n = n.replace(old, new, 1)

# ================================================================ 4. list indent ==
if "ul, ol" not in n:
    n = n.replace("""/* A row must never grow taller than its neighbours because a badge wrapped. */""",
"""/* A `<ul>` carries `padding-inline-start: 40px` from the user agent, which is the indent the list
   showed. The original scoped block reset it and got dropped when the styles were reduced to
   "only what style.css does not cover" -- the reset was part of what went. */
:deep(.lib-list ul) { list-style: none; margin: 0; padding: 0; }

/* A row must never grow taller than its neighbours because a badge wrapped. */""", 1)

NP.write_text(n, encoding="utf-8")
print("  NodePalette.vue: .search class added, ul indent reset")
