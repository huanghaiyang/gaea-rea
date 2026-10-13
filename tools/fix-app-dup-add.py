#!/usr/bin/env python3
"""Remove the duplicated node-add handler from App.vue.

GraphStage now owns it, because GraphStage is what constructs the editor. Leaving the handler in
both places means one palette click emits `graph:add` twice and the node is created twice.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "App.vue"
t = p.read_text(encoding="utf-8")

# 1. Drop the handler function.
start = t.find("function onAddNode(ev) {")
end = t.find("function onKey(ev) {")
if start < 0 or end < 0 or end < start:
    print("  !! handler block not found")
    sys.exit(1)
t = t[:start] + t[end:]

# 2. Drop its listeners and refresh the surrounding comment.
old = """  window.addEventListener('gaea:add-node', onAddNode);
  window.addEventListener('keydown', onKey);"""
new = """  // `gaea:add-node` is NOT handled here. GraphStage listens for it, because GraphStage is what
  // constructs the editor that performs the add. Listening in both places emitted `graph:add`
  // twice and created the node twice.
  window.addEventListener('keydown', onKey);"""
if old not in t:
    print("  !! mount listener block not found")
    sys.exit(1)
t = t.replace(old, new, 1)

old = """  window.removeEventListener('gaea:add-node', onAddNode);
  window.removeEventListener('keydown', onKey);"""
new = """  window.removeEventListener('keydown', onKey);"""
if old not in t:
    print("  !! unmount listener block not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# 3. Fix the header comment that described the old arrangement.
old = """ * The node-add path is an event rather than a prop chain: the palette raises
 * `gaea:add-node` on `window` and this listens for it. That is deliberate while the graph editor
 * is still an external module with its own API -- once the editor owns node creation, the event
 * becomes a direct call, and routing it through props today would just be ceremony."""
new = """ * The node-add path is an event rather than a prop chain: the palette raises `gaea:add-node` on
 * `window` and GRAPHSTAGE listens for it, because GraphStage owns the editor that performs the
 * add. Handling it here as well, as the first version did, emitted `graph:add` twice and created
 * every node twice."""
if old in t:
    t = t.replace(old, new, 1)
else:
    print("  note: header comment not matched; left as is")

# 4. `bus` was only used by the removed handler check; it is still used for the change listener,
#    so only the unused `status` reference is worth leaving alone.
p.write_text(t, encoding="utf-8")
print("  App.vue: duplicate node-add handler removed")
