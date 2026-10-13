#!/usr/bin/env python3
"""Select a node with parameters the way that actually works, then measure the control's colours.

THE REPORTED BUG
"下拉列表文字是白色的，看不清". `style.css` sets a select's background through `.param-control`;
without that wrapper the select kept `color: inherit` (white, from the dark panel) and had no
background of its own, so it rendered white text on the browser's default light control.

Verifying it needs a node WITH parameters selected. The previous attempt dispatched synthetic
PointerEvents, which the component ignores -- `verify-headless.mjs` uses real CDP mouse events and
that is what works, so the same approach is used here.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "measure-panels.mjs"
t = p.read_text(encoding="utf-8")

# Drop the synthetic-event selection if an earlier patch managed to add one.
import re
t = re.sub(r"\n  // Select a node that HAS parameters.*?await sleep\(700\);", "", t, flags=re.S)

if "Input.dispatchMouseEvent" not in t:
    anchor = "  await sleep(2500);"
    if anchor not in t:
        print("  !! settle point not found")
        sys.exit(1)
    t = t.replace(anchor, anchor + """

  // Select a node that HAS parameters, with a REAL mouse event. Synthetic PointerEvents carry no
  // active pointer and the component's handlers do not act on them -- which is why an earlier run
  // reported paramRows: 0 and answered nothing.
  const box = JSON.parse(await evaluate(`(function () {
    const g = [...document.querySelectorAll('#graphwrap g.node')]
      .find(function (el) { return (el.textContent || '').trim() === 'MultiFractal'; });
    if (!g) return 'null';
    const r = g.querySelector('rect').getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`));
  if (box) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type, x: Math.round(box.x), y: Math.round(box.y),
        button: 'left', clickCount: 1, pointerType: 'mouse',
      });
    }
  }
  await sleep(900);""", 1)

# Measure the control's colours, which is the actual complaint.
old = "      paramRows: document.querySelectorAll('#inspector .param').length,"
new = """      paramRows: document.querySelectorAll('#inspector .param').length,
      paramControlPresent: document.querySelectorAll('#inspector .param-control').length,
      // THE REPORTED BUG: a select must not have the panel's text colour on the browser's
      // default background.
      selectStyle: (function () {
        const s = document.querySelector('#inspector .param-control select');
        if (!s) return 'no select in the panel';
        const cs = getComputedStyle(s);
        return { background: cs.backgroundColor, color: cs.color, borderWidth: cs.borderTopWidth };
      })(),
      sliderStyle: (function () {
        const s = document.querySelector('#inspector .param-control input[type=range]');
        if (!s) return 'no range in the panel';
        const cs = getComputedStyle(s);
        return { accent: cs.accentColor, flexGrow: cs.flexGrow };
      })(),
      paramValue: (function () {
        const v = document.querySelector('#inspector .param-value');
        if (!v) return 'no .param-value';
        const r = v.getBoundingClientRect();
        return { text: (v.textContent || '').trim().slice(0, 12), box: [Math.round(r.width), Math.round(r.height)] };
      })(),"""
if old not in t:
    print("  !! paramRows probe not found")
    sys.exit(1)
t = t.replace(old, new, 1)

p.write_text(t, encoding="utf-8")
print("  measure-panels.mjs: real mouse selection + control colour probes")
