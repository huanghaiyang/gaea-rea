#!/usr/bin/env python3
"""Stop the diagnostic from importing a SECOND module instance.

THE MISTAKE
The diagnostic did `await import('/src/stores/session.js')` and read `viewport.value` from it.
Vite serves modules with a `?t=<timestamp>` query, so the application had loaded
`/src/stores/session.js?t=A` while the bare specifier resolved to a separate instance whose
`viewport` had never been assigned. That is the whole reason it printed

    {"renderer3d": null, "note": "Viewport has no renderer3d yet"}

in the same page where `window.__gaea.overlays` -- which reads the APPLICATION's instance through
the getter exposed at boot -- reported all eight textures loaded. Two readings of "the same"
module that were never the same module.

A diagnostic that measures a different instance than the app is worse than no diagnostic: it
produced a confident, wrong cause and cost a fix cycle. Everything here now goes through the
getter the application itself publishes.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "diag-overlay.mjs"
t = p.read_text(encoding="utf-8")

# The forced-load block imported session.js; use the app's own handle instead.
start = t.find("  // 3. Force a load through the SAME path the component uses")
end = t.find("  // 4. THE ACTUAL FLOW")
if start < 0 or end < 0:
    print("  !! blocks not found")
    sys.exit(1)

NEW = """  // 3. The renderer the APPLICATION holds. `window.__viewportRenderer` is published by
  //    session.js at module scope, so it closes over the instance the app actually uses -- unlike
  //    a fresh `import(...)`, which in Vite resolves to a different module record.
  const held = await evaluate(`(async function () {
    const get = window.__viewportRenderer;
    if (typeof get !== 'function') return JSON.stringify({ error: 'no __viewportRenderer' });
    const r3 = get();
    if (!r3) return JSON.stringify({ renderer3d: null, note: 'no renderer yet (2D, or no WebGL2)' });
    const before = r3.overlayStatus ? r3.overlayStatus() : null;
    const res = await r3.loadOverlays();
    return JSON.stringify({
      renderer3d: 'present',
      loadedBefore: before ? before.filter(function (o) { return o.loaded; }).length : null,
      res,
      status: r3.overlayStatus(),
    });
  })()`);
  console.log('  the application\\'s own renderer:');
  console.log(`    ${held}`);

"""
t = t[:start] + NEW + t[end:]

# The selection block likewise must not import the module.
old_sel = """      const before = window.__gaea.overlays || [];
      return JSON.stringify({
        selected: sel.value,
        loadedAfterSelect: before.filter(function (o) { return o.loaded; }).length,
        colorcheckLoaded: before.some(function (o) { return o.name === 'colorcheck' && o.loaded; }),
      });"""
new_sel = """      const after = window.__gaea.overlays || [];
      const r3 = (window.__viewportRenderer && window.__viewportRenderer()) || null;
      return JSON.stringify({
        selected: sel.value,
        loadedAfterSelect: after.filter(function (o) { return o.loaded; }).length,
        colorcheckLoaded: after.some(function (o) { return o.name === 'colorcheck' && o.loaded; }),
        overlayCurrent: r3 && r3.overlay ? r3.overlay.current : null,
        overlayVisible: r3 && r3.overlay ? r3.overlay.mesh.visible : null,
      });"""
if old_sel not in t:
    print("  note: selection block text differs; leaving it")
else:
    t = t.replace(old_sel, new_sel, 1)

p.write_text(t, encoding="utf-8")
print("  diag-overlay.mjs now reads the application's own renderer, never a fresh import")
