#!/usr/bin/env python3
"""Make the gap between the graph and the preview a real, draggable splitter.

WHAT THE PANELS ACTUALLY HAD
`style.css` sizes the two rows as fixed fractions and separates them with a one-pixel grid gap:

    grid-template-rows: minmax(180px, 58%) minmax(160px, 42%);
    gap: 1px;  background: var(--line-soft);

so what looks like a divider is the gap showing the background through. It is not an element, it
cannot be hit, and the split cannot be changed.

THE SHAPE USED INSTEAD
A third row holds a real splitter element:

    grid-template-rows: var(--graph-h, 58%) 6px 1fr;

The graph row takes `--graph-h` and the viewport row takes whatever is left, so the two can never
disagree about the total -- one variable is the whole state. A drag writes that variable on
`#layout`, which keeps the change out of every other rule.

The splitter is hidden together with the viewport by the existing `no-viewport` modifier.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
CSS = WS / "web" / "css" / "style.css"
APP = WS / "web" / "src" / "App.vue"

# ------------------------------------------------------------------- style ----
c = CSS.read_text(encoding="utf-8")

old = """#layout {
  display: grid;
  grid-template-columns: 236px minmax(320px, 1fr) 322px;
  grid-template-rows: minmax(180px, 58%) minmax(160px, 42%);
  grid-template-areas:
    "library graph inspector"
    "library viewport inspector";
  height: calc(100% - 44px);
  gap: 1px;
  background: var(--line-soft);
}

#library   { grid-area: library; }
#graphwrap { grid-area: graph; }
#inspector { grid-area: inspector; }
#viewport  { grid-area: viewport; }"""

new = """#layout {
  display: grid;
  grid-template-columns: 236px minmax(320px, 1fr) 322px;
  /* The middle row is a REAL splitter, not the 1px grid gap that used to separate the panels and
     could not be grabbed. `--graph-h` is the entire split state: the graph row takes it and the
     viewport row takes the remainder, so the two cannot disagree about the total. */
  grid-template-rows: var(--graph-h, minmax(180px, 58%)) 6px minmax(160px, 1fr);
  grid-template-areas:
    "library graph    inspector"
    "library splitter inspector"
    "library viewport inspector";
  height: calc(100% - 44px);
  gap: 1px;
  background: var(--line-soft);
}

#library   { grid-area: library; }
#graphwrap { grid-area: graph; }
#inspector { grid-area: inspector; }
#viewport  { grid-area: viewport; }

#splitter {
  grid-area: splitter;
  cursor: row-resize;
  background: var(--bg-1);
  /* A hairline in the middle of the hit area, so the grab target is six pixels while the divider
     still reads as a one-pixel rule. */
  display: flex; align-items: center; justify-content: center;
  touch-action: none;
  user-select: none;
}
#splitter::after {
  content: ''; display: block; width: 100%; height: 1px; background: var(--line-soft);
}
#splitter:hover::after,
#splitter.dragging::after { background: var(--accent, #4c9aff); height: 2px; }
#splitter:focus-visible { outline: 1px solid var(--accent, #4c9aff); outline-offset: -1px; }

/* With the viewport hidden there is nothing to split, so the row and its handle collapse. */
#layout.no-viewport {
  grid-template-rows: 1fr 0 0;
  grid-template-areas:
    "library graph inspector"
    "library graph inspector"
    "library graph inspector";
}
#layout.no-viewport #splitter { display: none; }"""

if old not in c:
    print("  !! #layout block not found")
    sys.exit(1)
c = c.replace(old, new, 1)
CSS.write_text(c, encoding="utf-8")
print("  style.css: #layout has a splitter row and --graph-h")

# -------------------------------------------------------------------- App -----
a = APP.read_text(encoding="utf-8")

# The splitter is a direct child of the grid, like the four panels.
old = """      <NodePalette />
      <GraphStage />
      <ParamPanel />
      <Viewport3D v-if="showViewport" />"""
new = """      <NodePalette />
      <GraphStage />
      <ParamPanel />
      <!-- A real grid row, so it can be hit. `style.css` places it at `grid-area: splitter`. -->
      <div
        v-if="showViewport"
        id="splitter"
        role="separator"
        aria-orientation="horizontal"
        :aria-valuenow="Math.round(graphPercent)"
        aria-valuemin="20"
        aria-valuemax="85"
        :aria-label="t('graph.title') + ' / ' + t('preview.title')"
        tabindex="0"
        :class="{ dragging }"
        @pointerdown="onSplitDown"
        @keydown="onSplitKey"
      />"""
if old not in a:
    print("  !! layout children not found")
    sys.exit(1)
a = a.replace(old, new, 1)

# The drag logic, next to the other view state.
old = "function onMode(m) { setViewMode(m); }"
new = """function onMode(m) { setViewMode(m); }

/* ---------------------------------------------------------------- the split */
/*
 * `--graph-h` on #layout is the ONLY piece of split state. A drag writes it and CSS derives both
 * rows from it, so the graph and preview can never sum to something other than the available
 * height -- which is what happens when each row is sized independently.
 */
const dragging = ref(false);
const graphPercent = ref(58);

const layoutEl = () => document.getElementById('layout');

/** Clamp so neither panel can be dragged away entirely. */
function applySplit(pct) {
  const clamped = Math.max(20, Math.min(85, pct));
  graphPercent.value = clamped;
  const el = layoutEl();
  if (el) el.style.setProperty('--graph-h', `${clamped}%`);
}

function splitFromEvent(ev) {
  const el = layoutEl();
  if (!el) return;
  const r = el.getBoundingClientRect();
  applySplit(((ev.clientY - r.top) / r.height) * 100);
}

function onSplitDown(ev) {
  ev.preventDefault();
  dragging.value = true;
  const move = (e) => splitFromEvent(e);
  const up = () => {
    dragging.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  // Listen on the window, not the handle: the pointer leaves a six-pixel strip immediately, and a
  // handler bound to the element would stop tracking the moment it did.
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** Keyboard access, since it is a focusable separator. */
function onSplitKey(ev) {
  const step = ev.shiftKey ? 10 : 2;
  if (ev.key === 'ArrowUp') { applySplit(graphPercent.value - step); ev.preventDefault(); }
  else if (ev.key === 'ArrowDown') { applySplit(graphPercent.value + step); ev.preventDefault(); }
  else if (ev.key === 'Home') { applySplit(20); ev.preventDefault(); }
  else if (ev.key === 'End') { applySplit(85); ev.preventDefault(); }
}"""
if old not in a:
    print("  !! onMode not found")
    sys.exit(1)
a = a.replace(old, new, 1)

# The old scoped rule replaced the areas wholesale; the stylesheet now owns the no-viewport case.
a = a.replace("""/* The viewport is the only area that disappears, so its row collapses with it. */
#layout.no-viewport { grid-template-areas: "library graph inspector" "library graph inspector"; }""",
"""/* The `no-viewport` collapse lives in style.css, next to the grid it modifies. Repeating the
   areas here is how they drifted apart before. */""")

APP.write_text(a, encoding="utf-8")
print("  App.vue: splitter element, pointer drag, keyboard access")

# `ref` must be imported for the two new refs.
head = a.split("</script>")[0]
if "ref" not in head.split("from 'vue'")[0]:
    print("  note: check that `ref` is imported from vue")
else:
    print("  ref is imported")
