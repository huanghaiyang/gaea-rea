#!/usr/bin/env python3
"""Repair the label block that an earlier mangled inline edit wrote into the verifier.

The broken text is visible: `console.log(      labels: );` and
`${numeric} of  are bare numbers)` -- PowerShell consumed the template-literal expressions when the
edit was run inline, and the result was written to disk before anything type-checked it. This
replaces the whole damaged span with the intended code.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "verify-headless.mjs"
t = p.read_text(encoding="utf-8")

start = t.find("  // THE LABELS ARE THE POINT.")
end = t.find("  check('selecting a node fills the inspector', insp.head.length > 0,")
if start < 0 or end < 0 or end < start:
    print("  !! damaged span not found (already repaired?)")
    sys.exit(0)

REPAIRED = """  // THE LABELS ARE THE POINT. The row COUNT passed even when every label was an array index --
  // the screenshot showed sliders numbered 0..19 beneath a screenful of node source. A count is
  // blind to that, so assert the names themselves.
  const labels = JSON.parse(await s.eval(
    "JSON.stringify([...document.querySelectorAll('#inspector .param label')]"
    + ".map(function (l) { return l.textContent.trim(); }).slice(0, 12))",
  ));
  console.log(`      labels: ${labels.join(' | ')}`);
  const numeric = labels.filter((l) => /^\\d+$/.test(l)).length;
  check('parameter labels are names, not indices', labels.length > 0 && numeric === 0,
    `${numeric} of ${labels.length} are bare numbers`);

  // The node's own description must not be rendered as a per-parameter hint: one of them is a
  // screenful of JavaScript, and that is what dominated the panel.
  const longHints = JSON.parse(await s.eval(
    "JSON.stringify([...document.querySelectorAll('#inspector .param .info')]"
    + ".filter(function (i) { return (i.title || '').length > 220; }).length)",
  ));
  check('no node-source blob used as a hint', longHints === 0, `${longHints} oversized hints`);

"""

t = t[:start] + REPAIRED + t[end:]
p.write_text(t, encoding="utf-8")
print("  verifier repaired")
