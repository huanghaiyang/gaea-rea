#!/usr/bin/env python3
"""Give GraphEditor a real dispose().

WHY THIS IS NEEDED RATHER THAN WORKED AROUND
`GraphEditor` subscribes to three bus events in its constructor and keeps no handle to the
unsubscribers, so nothing outside can detach them. `bus.on` DOES return an unsubscribe function --
the handles are simply dropped on the floor. A Vue component that mounts and unmounts the editor
(a view switch, a hot reload) therefore leaves three live closures holding a detached canvas.

The canvas listeners registered in `_bind()` are all anonymous additions to the canvas element
itself, so they go away with the element and need no teardown.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "js" / "graph-editor.js"
t = p.read_text(encoding="utf-8")

if "_busOff" in t:
    print("  graph-editor.js already has dispose()")
    sys.exit(0)

old = """    bus.on('graph:replaced', () => { this.frameAll(); this._schedule(); });
    bus.on('selection:changed', () => this._schedule());
    bus.on('node:changed', () => this._schedule());"""
new = """    // The unsubscribers are KEPT. Dropping them, as the first version did, leaves three live
    // closures pointing at a detached canvas as soon as a caller stops using the editor -- which
    // is exactly what a Vue unmount does.
    this._busOff = [
      bus.on('graph:replaced', () => { this.frameAll(); this._schedule(); }),
      bus.on('selection:changed', () => this._schedule()),
      bus.on('node:changed', () => this._schedule()),
    ];"""
if old not in t:
    print("  !! bus.on block not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# Add dispose() right before draw(), which is a stable member of the class.
anchor = "  draw() {"
if anchor not in t:
    print("  !! draw() not found")
    sys.exit(1)
t = t.replace(anchor, """  /**
   * Detach from the bus.
   *
   * The canvas listeners added in `_bind()` are anonymous and attached to the canvas itself, so
   * they are released with the element and are deliberately not tracked here.
   */
  dispose() {
    if (this._busOff) {
      for (const off of this._busOff) {
        try { off(); } catch { /* an already-detached handler is not an error */ }
      }
      this._busOff = null;
    }
  }

""" + anchor, 1)

p.write_text(t, encoding="utf-8")
print("  graph-editor.js: bus handles kept, dispose() added")
