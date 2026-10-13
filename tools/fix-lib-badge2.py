#!/usr/bin/env python3
"""Shorten the per-row badge so it fits a 236px column.

The class was `.tag`, not `.cnt` -- an earlier rename in `adopt-style-css.py` replaced a `<span
class="tag">{{ term('catalogue only') }}</span>` with `.cnt`, and the replacement did not match, so
the badge kept a class `style.css` has no rule for. That is why it wrapped: unstyled, it had no
font-size or flex-shrink constraint of its own.

`style.css` DOES define `.lib-item .cnt`, so the class is corrected too -- shortening the text
without fixing the class would leave it unconstrained.
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "NodePalette.vue"
t = P.read_text(encoding="utf-8")

old = """<span v-if="!row.implemented" class="tag">{{ term('catalogue only') }}</span>"""
new = """<!-- `.cnt` is the class style.css styles; the marker is short enough for a 236px column.
                 The full phrase is in the tooltip and, at group level, in the heading. -->
            <span v-if="!row.implemented" class="cnt" :title="term('catalogue only')">∅</span>"""
if old not in t:
    print("  !! badge not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# A row must never grow taller than its neighbours because something wrapped.
if "white-space: nowrap" not in t:
    t = t.replace("</style>", """
/* A row must never grow taller than its neighbours because a badge wrapped. */
:deep(.lib-item) { white-space: nowrap; }
:deep(.lib-item .nm) { min-width: 0; }
</style>""", 1)

P.write_text(t, encoding="utf-8")
print("  NodePalette.vue: badge class corrected to .cnt and shortened")
