#!/usr/bin/env python3
"""Sharpen the inspector probe: two different `.empty` elements were being conflated.

`ParamPanel` has an empty state for "no node selected" AND one for "this node declares no
parameters", and the second sits INSIDE the selected branch. A bare `!!document.querySelector
('#inspector .empty')` therefore cannot tell "selection never reached the panel" from "the panel
selected a node that has no parameters" -- two different bugs with one symptom. Reading the text
distinguishes them, and the store's own values settle it outright.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "verify-headless.mjs"
t = p.read_text(encoding="utf-8")

old = "    emptyMsg: !!document.querySelector('#inspector .empty'),"
new = ("    emptyText: (document.querySelector('#inspector .empty')?.textContent || '').trim().slice(0, 60),\n"
       "    headStrong: (document.querySelector('#inspector .node-head strong')?.textContent || '').trim(),\n"
       "    storeHasWindow: typeof window.__store,\n"
       "    storeSelected: (() => { try { return JSON.stringify(window.__store?.state?.selected); } catch { return 'n/a'; } })(),\n"
       "    storeNode: (() => { try { return String(window.__store?.selectedNode?.value?.name); } catch { return 'n/a'; } })(),\n"
       "    storeCount: (() => { try { return window.__store?.state?.graph?.nodes?.length; } catch { return 'n/a'; } })(),")
if old not in t:
    print("  !! emptyMsg probe not found")
    sys.exit(1)
t = t.replace(old, new, 1)

old2 = "+ `${diag.selectedClass} node(s) marked selected, empty-state shown: ${diag.emptyMsg}`);"
new2 = ("+ `${diag.selectedClass} selected, head=\"${diag.headStrong}\", empty=\"${diag.emptyText}\"`);\n"
        "  console.log(`      store: window=${diag.storeHasWindow} selected=${diag.storeSelected} "
        "node=${diag.storeNode} nodes=${diag.storeCount}`);")
if old2 not in t:
    print("  !! print line not found")
    sys.exit(1)
t = t.replace(old2, new2, 1)

p.write_text(t, encoding="utf-8")
print("  probe now reports the empty-state TEXT and the store's own values")
