#!/usr/bin/env python3
"""Guard pointer capture, which throws when there is no active pointer.

`setPointerCapture` raises `NotFoundError: No active pointer with the given id is found` whenever
the pointer is not currently down -- which happens with synthetically dispatched PointerEvents,
and in real use with some input devices and automation. The exception propagated out of the
handler, so everything AFTER the capture call was skipped and Vue logged an error on every
interaction.

Capture is an optimisation (it keeps events coming when the pointer leaves the element), not a
requirement, so failing to get it must not abort the gesture.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "GraphCanvas.vue"
t = p.read_text(encoding="utf-8")

if "capture(" in t:
    print("  GraphCanvas already guards capture")
    sys.exit(0)

# Add the helper next to `toWorld`.
anchor = """/* ------------------------------------------------------------------ pointer ---- */"""
helper = """/**
 * Pointer capture, best-effort.
 *
 * `setPointerCapture` throws `NotFoundError` when the pointer is not currently active -- with a
 * synthesised event, and with some real input devices. It is an optimisation that keeps events
 * flowing when the pointer leaves the element, so losing it must not abort the gesture: an
 * unguarded call skipped everything after it and logged an error on every interaction.
 */
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* no active pointer; the gesture still works, it just stops at the element's edge */
  }
}

/* ------------------------------------------------------------------ pointer ---- */"""
if anchor not in t:
    print("  !! pointer section marker not found")
    sys.exit(1)
t = t.replace(anchor, helper, 1)

n = 0
for old in ("svg.value.setPointerCapture(ev.pointerId);",):
    while old in t:
        t = t.replace(old, "capture(svg.value, ev.pointerId);", 1)
        n += 1

p.write_text(t, encoding="utf-8")
print(f"  GraphCanvas.vue: {n} capture call(s) guarded")
