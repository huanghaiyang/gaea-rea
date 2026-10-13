#!/usr/bin/env python3
"""Point the remaining components at the corrected state shape.

`selectedNode.type` was wrong: a graph node carries `name`, which is the registry key the schema
and the port counts are looked up by. `state.selectedId` was wrong too -- the field is
`state.selected`. Both came from the same unverified assumption about the state shape.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
p = WS / "web" / "src" / "components" / "ParamPanel.vue"
t = p.read_text(encoding="utf-8")

pairs = [
    ("{{ selectedNode.type }}", "{{ selectedNode.name }}"),
    ("algorithmOf(selectedNode.type)", "algorithmOf(selectedNode.name)"),
    ("v-else class=\"algo missing\"", "v-else class=\"algo missing\""),
]
n = 0
for old, new in pairs:
    if old in t and old != new:
        t = t.replace(old, new)
        n += 1

if "selectedNode.type" in t:
    print("  !! selectedNode.type still present")
    sys.exit(1)

p.write_text(t, encoding="utf-8")
print(f"  ParamPanel.vue: {n} reference(s) moved from .type to .name")
