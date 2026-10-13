#!/usr/bin/env python3
"""Fix what the screenshot showed.

LOOKING AT THE RENDER is what found these; every structural probe had passed. Four things were
visibly wrong:

1. THE INSPECTOR DUMPED A FUNCTION'S SOURCE. `algorithmOf(name)` returns `entry.algorithm` -- the
   function OBJECT, not a name -- so `{{ algorithmOf(...) }}` stringified it and the panel opened
   with a screenful of `function outputNode(ctx) {...}`. The old `params-panel.js` never used it
   for display. It is now rendered as a boolean: does a kernel exist.

2. THE SHELL HAD A STATUSBAR THE ORIGINAL DOES NOT HAVE. `style.css` is written for exactly two
   bands: `#topbar { height: 44px }` and `#layout { height: calc(100% - 44px) }`. An invented
   footer consumed part of that 44px band, which is why the last strip was cramped and overlapped.
   The original puts the evaluation status and the coverage count in the topbar's `.tb-right`,
   which this shell already does -- so the footer is removed rather than resized.

3. THE OVERLAY SELECT WAS AN UNSTYLED NATIVE CONTROL. It had no class, so it rendered as a wide
   white box. It now uses `.tb-field`, which is what the stylesheet styles.

4. The topbar height was not the 44px the layout's `calc` assumes.
"""
import pathlib
import re
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
APP = WS / "web" / "src" / "App.vue"
PARAM = WS / "web" / "src" / "components" / "ParamPanel.vue"
VP = WS / "web" / "src" / "components" / "Viewport3D.vue"

# ------------------------------------------------------------ 1. algorithmOf ----
t = PARAM.read_text(encoding="utf-8")
t = t.replace(
    '<span v-if="algorithmOf(selNode.name)" class="pill">'
    '{{ algorithmOf(selNode.name) }}</span>',
    '<span v-if="hasKernel" class="pill">{{ term(\'kernel\') }}</span>')
t = t.replace(
    '<span v-else class="pill">{{ term(\'no kernel\') }}</span>',
    '<span v-else class="pill">{{ term(\'no kernel\') }}</span>')

# A boolean, and the import of `algorithmOf` becomes that check.
t = t.replace(
    "  schemaFor, setParam, resetParams, state, algorithmOf, version,",
    "  schemaFor, setParam, resetParams, state, algorithmOf, version,")
if "const hasKernel" not in t:
    anchor = "const selNode = computed(() => {"
    t = t.replace(anchor, """/**
 * Whether a kernel exists for the selected node.
 *
 * A BOOLEAN, deliberately. `algorithmOf` returns the registry's function OBJECT, so rendering it
 * put the function's source in the panel -- the `function outputNode(ctx) {...}` block that opened
 * the inspector. The old `params-panel.js` never displayed it either.
 */
const hasKernel = computed(() => {
  version.value;
  const n = selNode.value;
  return !!(n && algorithmOf(n.name));
});

""" + anchor, 1)
PARAM.write_text(t, encoding="utf-8")
print("  ParamPanel.vue: algorithmOf no longer rendered as text")

# --------------------------------------------------------- 2. drop the footer ---
t = APP.read_text(encoding="utf-8")
footer = re.search(r"\n    <footer id=\"statusbar\">.*?</footer>", t, re.S)
if footer:
    t = t[:footer.start()] + t[footer.end():]
    print("  App.vue: invented #statusbar removed (the original has no footer)")

# The shell must be exactly topbar + layout, which is what the stylesheet's calc assumes.
t = re.sub(
    r"<style scoped>.*?</style>",
    """<style scoped>
/* style.css owns #topbar (44px) and #layout (calc(100% - 44px)), plus the four named grid areas.
   Nothing here re-declares the grid: repeating it is what broke the layout in the first pass.
   There is deliberately NO footer -- the original shell is two bands, and the evaluation status
   and coverage count live in the topbar's .tb-right. */
.shell { display: flex; flex-direction: column; height: 100vh; }
/* The viewport is the only area that disappears, so its row collapses with it. */
#layout.no-viewport { grid-template-areas: "library graph inspector" "library graph inspector"; }
.lang { font-size: 11.5px; }
</style>""",
    t, flags=re.S, count=1)
APP.write_text(t, encoding="utf-8")
print("  App.vue: scoped styles reduced to the two rules style.css does not cover")

# --------------------------------------------------- 3. style the overlay select
v = VP.read_text(encoding="utf-8")
v = v.replace(
    """        <select
          v-if="availableOverlays.length"
          :value="overlayName"
          :aria-label="term('Overlay')"
          @change="onOverlayChange"
        >""",
    """        <label v-if="availableOverlays.length" class="tb-field" :title="term('Overlay')">
          <span>ovl</span>
          <select
            :value="overlayName"
            :aria-label="term('Overlay')"
            @change="onOverlayChange"
          >""")
v = v.replace("""          >{{ OVERLAY_LABELS[o] }}</option>
        </select>""",
"""            >{{ OVERLAY_LABELS[o] }}</option>
          </select>
        </label>""")
v = v.replace("""          <option :value="null">{{ term('no overlay') }}</option>""",
              """            <option :value="null">{{ term('none') }}</option>""")
VP.write_text(v, encoding="utf-8")
print("  Viewport3D.vue: overlay select uses .tb-field instead of rendering unstyled")
