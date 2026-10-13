#!/usr/bin/env python3
"""Three reported bugs, each traced to a specific cause.

1. NODES CANNOT BE DRAGGED
`onMove` writes `n.x` / `n.y` straight onto `state.graph.nodes`. `state` is a PLAIN object on
purpose -- `state.js` mutates the raw target, so a `reactive()` proxy would never see it -- and
reactivity is bridged by the store's `version` counter, which only bumps on BUS events. Dragging
emits nothing, so `viewNodes` never recomputed and the SVG never redrew: the node moved in the data
and not on screen. The same gap that made the inspector stale, in a different component.

The drag now announces itself on the bus, which is what `version` listens to.

2. THE LANGUAGE SELECT IS WHITE ON WHITE, AND SWITCHING DOES NOTHING
The select carried `class="lang"`, and the scoped rule for it set only `font-size`. `style.css`
has
    button, input, select, textarea { font: inherit; color: inherit; }
so the text inherited white from the dark topbar while nothing set a background -- the browser's
default light control showed through. `.tb-field` is the class the stylesheet styles for a control
in the topbar, so it is used instead.

Switching went through `setLang(...).then(() => location.reload())`. A reload is right -- labels are
produced in several panels and by `applyDocument` -- but it must be reached even when `setLang`
resolves slowly or rejects, or the control looks dead.

3. THE `view` CHECKBOX BLACKS OUT THE PREVIEW
`v-if="showViewport"` UNMOUNTS `Viewport3D`; remounting calls `attachViewport`, which builds a new
`Viewport` with no field. The field is only pushed on `eval:done`, and no evaluation happens when
the checkbox is ticked -- so the new viewport draws nothing and the panel is black until the graph
is next re-evaluated. The current field is now handed over as soon as a viewport is attached.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
GC = WS / "web" / "src" / "components" / "GraphCanvas.vue"
APP = WS / "web" / "src" / "App.vue"
SESSION = WS / "web" / "src" / "stores" / "session.js"

# ============================================================== 1. drag ====
g = GC.read_text(encoding="utf-8")

old = """  if (dragNode.value) {
    const n = state.graph.nodes.find((x) => x.id === dragNode.value.nodeId);
    if (n) {
      n.x = Math.round(w.x - dragNode.value.dx);
      n.y = Math.round(w.y - dragNode.value.dy);
    }
    return;
  }"""
new = """  if (dragNode.value) {
    const n = state.graph.nodes.find((x) => x.id === dragNode.value.nodeId);
    if (n) {
      n.x = Math.round(w.x - dragNode.value.dx);
      n.y = Math.round(w.y - dragNode.value.dy);
      // `state` is a plain object and is written directly on purpose; the store's `version`
      // counter is what makes Vue recompute, and it only moves on BUS events. Without this the
      // coordinates changed and the SVG never redrew -- a node that moves in the data and not on
      // screen, which reads as "dragging does not work".
      bus.emit('node:changed', { id: n.id, reason: 'drag' });
    }
    return;
  }"""
if old not in g:
    print("  !! drag body not found")
    sys.exit(1)
g = g.replace(old, new, 1)
GC.write_text(g, encoding="utf-8")
print("  GraphCanvas.vue: drag announces itself so the view recomputes")

# ============================================================ 2. language ====
a = APP.read_text(encoding="utf-8")

old = """        <select class="lang" :value="lang" :aria-label="term('Language')" @change="onLang">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>"""
new = """        <!-- `.tb-field` is the class style.css styles for a topbar control. `class="lang"` with
             only a scoped font-size left the select with `color: inherit` (white) and no
             background, i.e. white text on the browser's default light control. -->
        <label class="tb-field">
          <span>lang</span>
          <select :value="lang" :aria-label="term('Language')" @change="onLang">
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>"""
if old not in a:
    print("  !! language select not found")
    sys.exit(1)
a = a.replace(old, new, 1)

old = """function onLang(ev) {
  // A reload is intentional: labels are produced in several panels and by the i18n module's own
  // `applyDocument`, so rebuilding the view from the same state is safer than a translation pass
  // over a live DOM.
  Promise.resolve(setLang(ev.target.value)).then(() => location.reload());
}"""
new = """function onLang(ev) {
  // A reload is intentional: labels are produced in several panels and by the i18n module's own
  // `applyDocument`, so rebuilding the view from the same state is safer than a translation pass
  // over a live DOM.
  //
  // The reload is in `finally` so it happens whether the promise resolves, is slow, or rejects --
  // the first version chained it on success only, and a rejected `setLang` left the control
  // looking dead.
  Promise.resolve(setLang(ev.target.value))
    .catch((e) => console.warn('[gaea] setLang failed', e))
    .finally(() => location.reload());
}"""
if old not in a:
    print("  note: onLang differs; leaving it")
else:
    a = a.replace(old, new, 1)

# The scoped `.lang` rule is now dead.
a = a.replace(".lang { font-size: 11.5px; }", "")
APP.write_text(a, encoding="utf-8")
print("  App.vue: language select uses .tb-field; reload happens even on failure")

# ========================================================= 3. view toggle ====
s = SESSION.read_text(encoding="utf-8")

old = """  vp.setRamp(state.ramp);
  vp.setExaggeration(state.exaggeration);
  vp.setMode(state.viewMode);
  return vp;"""
new = """  vp.setRamp(state.ramp);
  vp.setExaggeration(state.exaggeration);
  vp.setMode(state.viewMode);

  // HAND OVER THE CURRENT FIELD IMMEDIATELY. `Viewport3D` is unmounted and remounted by the
  // `view` checkbox, and a fresh `Viewport` has no field -- the field was only pushed on
  // `eval:done`, and ticking the checkbox evaluates nothing. The panel came back black until the
  // graph was next re-evaluated.
  const id = state.previewRoot || state.selected;
  const f = (id && state.fields.get(id)) || [...state.fields.values()][0];
  if (f) vp.setField(f);
  return vp;"""
if old not in s:
    print("  !! attachViewport tail not found")
    sys.exit(1)
s = s.replace(old, new, 1)
SESSION.write_text(s, encoding="utf-8")
print("  session.js: a newly attached viewport receives the current field")
