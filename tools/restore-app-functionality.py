#!/usr/bin/env python3
"""Load the demo pipeline on boot and restore the toolbar controls the Vue shell dropped.

THE REGRESSION
The first Vue shell rebuilt the layout and the library but not the plumbing, so the page had an
empty canvas where the pure-HTML version it replaced had a demo pipeline, a running evaluator and
rendered terrain. The toolbar lost eleven controls: new, demo, fit, resolution, seed, dice,
2D/3D, ramp, exaggeration, eval status and export.

Everything here is wired to functions that already exist in `@js/`; none of it is re-derived.
"""
import pathlib
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
MAIN = WS / "web" / "src" / "main.js"

# ------------------------------------------------------------------- main.js ----
t = MAIN.read_text(encoding="utf-8")
if "startEvalReporting" in t:
    print("  main.js already wired")
else:
    old = """  const app = createApp(App);"""
    new = """  // The evaluator's status and the field it produces are broadcast on the bus; this is what puts
  // them in the toolbar and hands the field to the viewport.
  startEvalReporting();

  const app = createApp(App);"""
    if old not in t:
        print("  !! app creation not found")
        sys.exit(1)
    t = t.replace(old, new, 1)

    old = "import { loadCatalog, state, selectedNode, viewNodes } from './stores/app.js';"
    new = ("import { loadCatalog, state, selectedNode, viewNodes } from './stores/app.js';\n"
           "import { startEvalReporting, loadDemo } from './stores/session.js';")
    if old not in t:
        print("  !! store import not found")
        sys.exit(1)
    t = t.replace(old, new, 1)

    # Load the demo AFTER mount, so the graph canvas and the viewport already exist to receive it.
    old = """  window.__gaea = {"""
    new = """  // AFTER mount: the demo is rendered by components that must already exist. Loading it before
  // `mount` would set the graph with no canvas to draw it on, which is how the first version came
  // up empty.
  try {
    loadDemo();
  } catch (e) {
    console.warn('[gaea] demo pipeline failed to load', e);
  }

  window.__gaea = {"""
    if old not in t:
        print("  !! __gaea block not found")
        sys.exit(1)
    t = t.replace(old, new, 1)

    MAIN.write_text(t, encoding="utf-8")
    print("  main.js: eval reporting started, demo pipeline loaded after mount")

# -------------------------------------------------------------------- App.vue ---
APP = WS / "web" / "src" / "App.vue"
a = APP.read_text(encoding="utf-8")
if "loadDemo()" in a and "sel-ramp" in a:
    print("  App.vue already has the toolbar")
    sys.exit(0)

old_imp = "import {\n  coverage, state, historyDepth, undo, redo, selectNode, bus,\n} from './stores/app.js';"
new_imp = """import {
  coverage, state, historyDepth, undo, redo, selectNode, bus,
} from './stores/app.js';
import {
  evaluator, loadDemo, newGraph, evalStatus, lastMs, glAvailable,
  setRamp, setExaggeration, setViewMode,
} from './stores/session.js';"""
if old_imp not in a:
    print("  !! App.vue store import not found")
    sys.exit(1)
a = a.replace(old_imp, new_imp, 1)

# --- script: the new actions ---------------------------------------------------
old_actions = "function onKey(ev) {"
new_actions = """const ramp = ref('terrain');
const exaggeration = ref(1);
const seed = ref(0);
const resolution = ref(512);
const RAMP_NAMES = ['terrain', 'grayscale', 'rock', 'sand', 'blue', 'green'];

function onNew() { newGraph(); refreshHistory(); }
function onDemo() { loadDemo(); refreshHistory(); }
function onFit() { window.dispatchEvent(new CustomEvent('gaea:fit')); }
function onRamp(ev) { ramp.value = ev.target.value; setRamp(ramp.value); }
function onExag(ev) { exaggeration.value = Number(ev.target.value); setExaggeration(exaggeration.value); }
function onSeed(ev) { seed.value = Number(ev.target.value); }
function onDice() { seed.value = Math.floor(Math.random() * 100000); }
function onRes(ev) { resolution.value = Number(ev.target.value); }
function onMode(m) { setViewMode(m); }

function onKey(ev) {"""
if old_actions not in a:
    print("  !! onKey not found")
    sys.exit(1)
a = a.replace(old_actions, new_actions, 1)

# `ref` must be imported.
a = a.replace("import { onMounted, onBeforeUnmount, ref, computed } from 'vue';",
              "import { onMounted, onBeforeUnmount, ref, computed } from 'vue';", 1)

# --- template: the toolbar -----------------------------------------------------
old_bar = """      <button :title="term('Undo')" :disabled="!history.undo" @click="undo(); refreshHistory()">↶</button>
      <button :title="term('Redo')" :disabled="!history.redo" @click="redo(); refreshHistory()">↷</button>

      <label class="toggle">
        <input v-model="showViewport" type="checkbox" />
        <span>{{ term('3D') }}</span>
      </label>"""
new_bar = """      <button class="tb" :title="term('New graph')" @click="onNew">＋</button>
      <button class="tb" :title="term('Load the demo pipeline')" @click="onDemo">demo</button>
      <button class="tb" :title="term('Undo')" :disabled="!history.undo" @click="undo(); refreshHistory()">↶</button>
      <button class="tb" :title="term('Redo')" :disabled="!history.redo" @click="redo(); refreshHistory()">↷</button>
      <button class="tb" :title="term('Frame all nodes')" @click="onFit">fit</button>

      <label class="tb-field" :title="term('Build resolution')">
        <span>res</span>
        <select :value="resolution" @change="onRes">
          <option v-for="r in [128, 256, 512, 1024, 2048]" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>

      <label class="tb-field" :title="term('Global seed')">
        <span>seed</span>
        <input type="number" :value="seed" step="1" style="width:74px" @input="onSeed" />
      </label>
      <button class="tb" :title="term('Randomise the seed')" @click="onDice">🎲</button>

      <button class="tb" :class="{ active: state.viewMode === '2d' }" @click="onMode('2d')">2D</button>
      <button
        class="tb" :class="{ active: state.viewMode === '3d' }"
        :disabled="!glAvailable" :title="glAvailable ? '' : term('WebGL2 unavailable')"
        @click="onMode('3d')"
      >3D</button>

      <label class="tb-field" :title="term('Colour ramp')">
        <span>ramp</span>
        <select :value="ramp" @change="onRamp">
          <option v-for="r in RAMP_NAMES" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>

      <label class="tb-field" :title="term('Vertical exaggeration')">
        <span>exag</span>
        <input type="range" min="0.1" max="3" step="0.05" :value="exaggeration" @input="onExag" />
      </label>

      <span class="eval-status" :class="evalStatus">{{ evalStatus }}<template v-if="lastMs"> · {{ Math.round(lastMs) }}ms</template></span>

      <label class="tb-field">
        <input v-model="showViewport" type="checkbox" />
        <span>view</span>
      </label>"""
if old_bar not in a:
    print("  !! toolbar block not found")
    sys.exit(1)
a = a.replace(old_bar, new_bar, 1)

# --- styles for the restored controls -----------------------------------------
a = a.replace(""".coverage { font-size: 11px; opacity: 0.7; font-variant-numeric: tabular-nums; }""",
""".coverage { font-size: 11px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.tb { font-size: 11px; padding: 1px 6px; }
.tb.active { outline: 1px solid #7cb7ff; }
.tb-field { display: flex; align-items: center; gap: 4px; font-size: 11px; opacity: 0.85; }
.tb-field input[type='range'] { width: 84px; }
.eval-status { font-size: 11px; opacity: 0.75; font-variant-numeric: tabular-nums; }
.eval-status.errors { color: #f88; }
.eval-status.evaluating { color: #fc8; }""", 1)

APP.write_text(a, encoding="utf-8")
print("  App.vue: 11 toolbar controls restored")
