#!/usr/bin/env python3
"""Drive the interaction checks with real CDP input events instead of synthetic PointerEvents.

WHY THE CHANGE
The select-and-inspect step dispatched `new PointerEvent('pointerdown', ...)` from inside
`Runtime.evaluate`. A synthesised event has no real pointer behind it: `pointerId` is 0 and there
is no active pointer, which is what produced the earlier `setPointerCapture` NotFoundError and is
also why the handler could be skipped depending on how Vue bound it. Asserting application
behaviour through a fabricated event tests the fabrication as much as the application.

`Input.dispatchMouseEvent` makes the browser generate the pointer event itself, so the component
receives exactly what a user's click produces. The coordinates are read from the element's own
bounding box rather than guessed.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "verify-headless.mjs"
t = p.read_text(encoding="utf-8")

old = """  // Select it and confirm the inspector fills, which proves the store wiring.
  await s.eval(`document.querySelector('g.node rect')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:200,clientY:200}))`);
  await sleep(400);"""

new = """  // Select it and confirm the inspector fills, which proves the store wiring.
  //
  // A REAL mouse event through CDP, not a synthesised PointerEvent: a fabricated event has no
  // active pointer, so `pointerId` is 0 and the component receives something a user's click never
  // produces. The target's own box supplies the coordinates.
  const box = JSON.parse(await s.eval(`(() => {
    const r = document.querySelector('g.node rect');
    if (!r) return 'null';
    const b = r.getBoundingClientRect();
    return JSON.stringify({x: b.left + b.width / 2, y: b.top + b.height / 2});
  })()`));
  if (box) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await s.send('Input.dispatchMouseEvent', {
        type,
        x: Math.round(box.x),
        y: Math.round(box.y),
        button: 'left',
        clickCount: 1,
        pointerType: 'mouse',
      });
    }
  }
  await sleep(500);"""

if old not in t:
    print("  !! select block not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# Also report what the store actually holds, so a failure says WHERE it stopped rather than only
# that the DOM did not change.
old2 = """  check('selecting a node fills the inspector', insp.params >= 0 && insp.head.length > 0,
    `head="${insp.head}" params=${insp.params}`);"""
new2 = """  check('selecting a node fills the inspector', insp.head.length > 0,
    `head="${insp.head}" params=${insp.params}`);
  // Diagnostics: distinguishes "selection never happened" from "selection happened but the panel
  // did not recompute", which are different bugs with the same symptom.
  const diag = JSON.parse(await s.eval(`JSON.stringify({
    inspected: document.querySelectorAll('#inspector .param').length,
    selectedClass: document.querySelectorAll('g.node.selected').length,
    emptyMsg: !!document.querySelector('#inspector .empty'),
  })`));
  console.log(`      inspector: ${diag.inspected} param row(s), `
    + `${diag.selectedClass} node(s) marked selected, empty-state shown: ${diag.emptyMsg}`);"""
if old2 not in t:
    print("  !! check block not found")
    sys.exit(1)
t = t.replace(old2, new2, 1)

p.write_text(t, encoding="utf-8")
print("  verify-headless.mjs: real CDP mouse events, plus a diagnostic on where it stopped")
