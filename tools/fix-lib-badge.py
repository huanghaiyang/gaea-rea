#!/usr/bin/env python3
"""Stop the per-row "catalogue only" badge from wrapping in a 236px panel.

The badge repeated, on every row, what the group heading already says ("CATALOG ONLY (NO
ALGORITHM)"), and at 10px monospace it is wider than the space `.nm` leaves -- so it broke onto
two lines and made every such row taller than its neighbours.

The information is worth keeping per row (a row can be scanned in isolation, and the heading
scrolls away), so it is shortened to a marker sized for the column rather than removed.
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "NodePalette.vue"
t = P.read_text(encoding="utf-8")

old = """<span v-if="!row.implemented" class="cnt">{{ term('catalogue only') }}</span>"""
new = """<!-- Short enough for a 236px column. The full phrase wrapped onto two lines and is
                 already carried by the group heading. -->
            <span v-if="!row.implemented" class="cnt" :title="term('catalogue only')">∅</span>"""
if old not in t:
    print("  !! badge not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# Keep the rows on one line whatever happens.
old_style = "#library { min-height: 0; }"
new_style = """#library { min-height: 0; }
/* A row must never grow taller than its neighbours because a badge wrapped. */
:deep(.lib-item) { white-space: nowrap; }
:deep(.lib-item .nm) { min-width: 0; }
:deep(.lib-list) { overflow-x: hidden; }"""
if old_style not in t:
    print("  note: scoped style anchor differs; appending instead")
    t = t.replace("</style>", """
/* A row must never grow taller than its neighbours because a badge wrapped. */
:deep(.lib-item) { white-space: nowrap; }
:deep(.lib-item .nm) { min-width: 0; }
:deep(.lib-list) { overflow-x: hidden; }
</style>""", 1)
else:
    t = t.replace(old_style, new_style, 1)

P.write_text(t, encoding="utf-8")
print("  NodePalette.vue: badge shortened to a marker, rows kept on one line")
