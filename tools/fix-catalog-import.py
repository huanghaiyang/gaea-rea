#!/usr/bin/env python3
"""Route the catalogue through the store, not around it.

`main.js` imported `loadCatalog` from `@js/state.js`. That function fills the state layer's own
catalogue fields but NOT the store's `catalog` ref, which is what the palette's `index` computed
reads. The result in a real browser was a fully rendered shell with an EMPTY palette and a 0/0
coverage readout -- every symptom pointing away from the cause, which was one import.

The store's `loadCatalog` calls the state layer itself, so it is a superset.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "main.js"
t = p.read_text(encoding="utf-8")

old = "import { loadCatalog } from '@js/state.js';"
new = "import { loadCatalog } from './stores/app.js';"
if old not in t:
    if new in t:
        print("  main.js already imports loadCatalog from the store")
        sys.exit(0)
    print("  !! import not found")
    sys.exit(1)

t = t.replace(old, new, 1)
t = t.replace(
    "import { preloadCLUTs, clutStatus } from '@js/clut.js';",
    "import { preloadCLUTs, clutStatus } from '@js/clut.js';",
    1,
)
# Leave a note where the mistake was, so the next reader sees why this import matters.
t = t.replace(
    "  loadCatalog(catalog);",
    "  // From the store, not from state.js: only the store's wrapper also fills the `catalog` ref\n"
    "  // that the palette's index is computed from. Importing the state layer's version here left\n"
    "  // the palette empty while everything else rendered.\n"
    "  loadCatalog(catalog);",
    1,
)
p.write_text(t, encoding="utf-8")
print("  main.js: loadCatalog now comes from the store")
