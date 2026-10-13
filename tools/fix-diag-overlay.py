#!/usr/bin/env python3
"""Remove the selection test I mangled into diag-overlay.mjs.

The block was inserted OUTSIDE the `evaluate(...)` string -- PowerShell consumed the template
literal -- so its JavaScript ran in Node, where `document` does not exist. It is my own bug, and it
made the diagnostic exit 1 after the useful output, which reads as a failure of the app rather
than of the tool.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "diag-overlay.mjs"
t = p.read_text(encoding="utf-8")

start = t.find("  // 4. THE ACTUAL FLOW:")
end = t.find("  console.log('  console lines mentioning overlay:');")
if start < 0:
    print("  broken block not present")
    sys.exit(0)
if end < 0 or end < start:
    print("  !! could not find the end of the block")
    sys.exit(1)

REPLACEMENT = """  // 4. THE ACTUAL FLOW, driven through the DOM rather than by calling the module directly, so it
  //    exercises onOverlayChange and setOverlay together.
  const picked = JSON.parse(await evaluate(`(function () {
    return (async function () {
      const sel = document.querySelector('#viewport select');
      if (!sel) return JSON.stringify({ error: 'no overlay dropdown' });
      sel.value = 'colorcheck';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(function (r) { setTimeout(r, 400); });
      const before = window.__gaea.overlays || [];
      return JSON.stringify({
        selected: sel.value,
        loadedAfterSelect: before.filter(function (o) { return o.loaded; }).length,
        colorcheckLoaded: before.some(function (o) { return o.name === 'colorcheck' && o.loaded; }),
      });
    })();
  })()`));
  console.log('  real selection through the dropdown:');
  console.log('    ' + JSON.stringify(picked));

"""
t = t[:start] + REPLACEMENT + t[end:]
p.write_text(t, encoding="utf-8")
print("  diag-overlay.mjs: selection test corrected to run inside the page")
