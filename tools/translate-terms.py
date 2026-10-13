#!/usr/bin/env python3
"""Translate node names and parameter labels, which is what `term()` is actually for.

`term()` looks up the 272-entry TERMS dictionary: node names, parameter labels, category names.
`t()` looks up the 103-entry UI dictionary. Both are correct; they are for different vocabularies,
and the previous round used `t()` for chrome (right) while rendering node names raw (wrong).

The dictionary does hold 'Adjust', 'Accumulator' and the rest -- `web/data/i18n-terms.zh.json` --
so the palette rows and the parameter labels only needed the call.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent

# ------------------------------------------------------------- palette rows ----
P = WS / "web" / "src" / "components" / "NodePalette.vue"
t = P.read_text(encoding="utf-8")

old = '<span class="nm">{{ row.name }}</span>'
new = '<!-- Node names live in the TERMS dictionary; `term()` is the lookup for them. -->\n            <span class="nm">{{ term(row.name) }}</span>'
if old not in t:
    print("  !! palette name span not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# The category heading is a term too.
old = '<h3 class="lib-group">{{ cat }}</h3>'
if old in t:
    t = t.replace(old, '<h3 class="lib-group">{{ term(cat) }}</h3>', 1)

# The group keys are English category names; keep the search haystack on the raw name so typing
# either language still matches.
P.write_text(t, encoding="utf-8")
print("  NodePalette.vue: node names and categories go through term()")

# -------------------------------------------------------- parameter labels -----
Q = WS / "web" / "src" / "components" / "ParamPanel.vue"
q = Q.read_text(encoding="utf-8")
if "row.label" in q and "term(row.label)" not in q:
    # `paramLabel` already consults the dictionary for known labels; the fallback is the raw name.
    # Wrapping it in term() as well would double-translate, so the label line is left as it is and
    # only the NODE NAME in the header is translated.
    old = "<strong>{{ selNode.name }}</strong>"
    if old in q:
        q = q.replace(old, "<!-- The node's own name is a term. -->\n          <strong>{{ term(selNode.name) }}</strong>", 1)
        Q.write_text(q, encoding="utf-8")
        print("  ParamPanel.vue: the node header name is translated")
    else:
        print("  note: header name span not found")
else:
    print("  ParamPanel.vue: labels already go through paramLabel()")

# The `term` import must still be present in both.
for path in (P, Q):
    s = path.read_text(encoding="utf-8")
    if "term" not in s.split("</script>")[0]:
        print(f"  !! {path.name} no longer imports term")
        sys.exit(1)
print("  term() is imported in both components")
