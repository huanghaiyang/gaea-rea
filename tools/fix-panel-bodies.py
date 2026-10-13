#!/usr/bin/env python3
"""Put both side panels inside `.panel-body`, which is the element `style.css` makes scrollable.

WHAT THE MEASUREMENT SHOWED

    libList:  box [236, 5915]   overflow: visible
    insBody:  MISSING

`style.css` defines the scroll container once:

    .panel-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px; }

The library used `.lib-list` as that container, but `.lib-list` has no height constraint and no
overflow, so the 182 rows expanded the list to 5915px inside a 758px panel and everything below the
first screenful was unreachable -- a list that cannot be scrolled reads as "the styles are wrong".
The inspector had no `.panel-body` at all (an earlier rename did not match the source and silently
did nothing), so it lost both its padding and its scroll.

Both panels are wrapped now, rather than each growing its own scroll rules -- that duplication is
what let them drift apart in the first place.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
NP = WS / "web" / "src" / "components" / "NodePalette.vue"
PP = WS / "web" / "src" / "components" / "ParamPanel.vue"

# ------------------------------------------------------------- NodePalette -----
t = NP.read_text(encoding="utf-8")

old = """    <div class="lib-list" role="listbox" :aria-label="term('Library')">"""
new = """    <!-- `.panel-body` is the scroll container style.css defines. `.lib-list` is only the
         flex column of rows; giving it the overflow instead let the list grow to 5915px inside
         a 758px panel, with everything below the fold unreachable. -->
    <div class="panel-body">
      <div class="lib-list" role="listbox" :aria-label="term('Library')">"""
if old not in t:
    print("  !! library list opening not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# Close the extra div at the end of that block.
old_close = """      </section>
    </div>
  </aside>
</template>"""
new_close = """        </section>
      </div>
    </div>
  </aside>
</template>"""
if old_close not in t:
    print("  !! library list closing not found")
    sys.exit(1)
t = t.replace(old_close, new_close, 1)

# Re-indent the rows that are now one level deeper, so the markup stays readable.
for a, b in (
    ('      <p v-if="!rows.length" class="empty">', '        <p v-if="!rows.length" class="empty">'),
    ('      <section v-for="[cat, items] in groups" :key="cat">', '        <section v-for="[cat, items] in groups" :key="cat">'),
):
    t = t.replace(a, b, 1)

NP.write_text(t, encoding="utf-8")
print("  NodePalette.vue: rows wrapped in .panel-body")

# -------------------------------------------------------------- ParamPanel -----
p = PP.read_text(encoding="utf-8")
if 'class="panel-body"' in p:
    print("  ParamPanel already has a .panel-body")
else:
    # Find whatever the parameter list container is called and rename it.
    import re
    m = re.search(r'<div v-else class="([\w-]+)">', p)
    if not m:
        print("  !! parameter list container not found")
        sys.exit(1)
    cls = m.group(1)
    p = p.replace(f'<div v-else class="{cls}">',
                  '<div v-else class="panel-body">', 1)
    # Its scoped rules were written against the old name.
    p = p.replace(f'.{cls} {{', '.panel-body {')
    PP.write_text(p, encoding="utf-8")
    print(f'  ParamPanel.vue: ".{cls}" -> ".panel-body"')
