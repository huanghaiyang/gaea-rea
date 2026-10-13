#!/usr/bin/env python3
"""Assert the parameter LABELS are names, not array indices.

The row count passed even when every label was an index: the screenshot showed sliders numbered
0..19 under a screenful of node source, and a count check is blind to that. These two assertions
target exactly what was visibly wrong.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "verify-headless.mjs"
t = p.read_text(encoding="utf-8")

if "are bare numbers" in t:
    print("  label assertions already present")
    sys.exit(0)

anchor = "  check('selecting a node fills the inspector', insp.head.length > 0,"
if anchor not in t:
    print("  !! inspector check not found")
    sys.exit(1)

BLOCK = r"""  // THE LABELS ARE THE POINT. The row count passed even when every label was an array index --
  // the screenshot showed sliders numbered 0..19 beneath a screenful of node source. Assert the
  // names themselves, not a count.
  const labelJson = await s.eval(
    "JSON.stringify([...document.querySelectorAll('#inspector .param label')]"
    + ".map(function (l) { return l.textContent.trim(); }).slice(0, 12))",
  );
  const labels = JSON.parse(labelJson);
  console.log('      labels: ' + labels.join(' | '));
  const numeric = labels.filter(function (l) { return /^\d+$/.test(l); }).length;
  check('parameter labels are names, not indices', labels.length > 0 && numeric === 0,
    numeric + ' of ' + labels.length + ' are bare numbers');

  // The node's own description must not be rendered as a per-parameter hint. One of them is a
  // screenful of JavaScript, which is what dominated the panel.
  const longHints = JSON.parse(await s.eval(
    "JSON.stringify([...document.querySelectorAll('#inspector .param .info')]"
    + ".filter(function (i) { return (i.title || '').length > 220; }).length)",
  ));
  check('no node-source blob used as a hint', longHints === 0, longHints + ' oversized hints');

"""

t = t.replace(anchor, BLOCK + anchor, 1)
p.write_text(t, encoding="utf-8")
print("  verifier now asserts real parameter names and no oversized hints")
