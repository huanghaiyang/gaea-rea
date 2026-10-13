#!/usr/bin/env python3
"""Assert the functionality the first Vue shell dropped has come back.

The earlier checks only proved the SHELL rendered, which is exactly why a page with an empty
canvas, no evaluator and four toolbar buttons passed. These checks assert the things a user would
notice missing: a graph exists, the toolbar is complete, and the evaluator reports.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "verify-headless.mjs"
t = p.read_text(encoding="utf-8")

old = """  check('coverage readout present', /\\d+\\/\\d+/.test(p.coverage), p.coverage);
  check('inspector present', p.inspector);"""

new = """  check('coverage readout present', /\\d+\\/\\d+/.test(p.coverage), p.coverage);
  check('inspector present', p.inspector);

  // --- functionality the first Vue shell DROPPED ------------------------------
  // The checks above only proved the shell rendered, which is how a page with an empty canvas and
  // four toolbar buttons passed. These are the things a user notices.
  const feature = JSON.parse(await s.eval(`JSON.stringify({
    demoNodes: document.querySelectorAll('g.node').length,
    edges: document.querySelectorAll('svg.graph path.edge').length,
    toolbarButtons: document.querySelectorAll('#topbar button').length,
    tbFields: document.querySelectorAll('#topbar .tb-field').length,
    hasRes: !!document.querySelector('#topbar select'),
    evalStatus: (document.querySelector('.eval-status')?.textContent || '').trim(),
    canvases: document.querySelectorAll('section.viewport canvas').length,
  })`));
  console.log(`      features: ${JSON.stringify(feature)}`);
  check('demo pipeline loaded (nodes present)', feature.demoNodes > 1, `${feature.demoNodes} nodes`);
  check('edges drawn', feature.edges > 0, `${feature.edges} edges`);
  check('toolbar restored (>=10 buttons)', feature.toolbarButtons >= 10, `${feature.toolbarButtons} buttons`);
  check('toolbar fields present (res/seed/ramp/exag)', feature.tbFields >= 4, `${feature.tbFields} fields`);
  check('evaluator reported a status', feature.evalStatus.length > 0, feature.evalStatus);
  check('viewport has both canvases', feature.canvases === 2, `${feature.canvases} canvases`);"""

if old not in t:
    print("  !! anchor not found")
    sys.exit(1)
t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8")
print("  verify script now asserts the restored functionality")
