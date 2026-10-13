#!/usr/bin/env python3
"""Make `#layout`'s four named grid areas receive the four panels as DIRECT children.

`style.css` declares

    #layout {
      grid-template-areas:
        "library graph inspector"
        "library viewport inspector";
    }
    #library { grid-area: library; }   #graphwrap { grid-area: graph; }
    #inspector { grid-area: inspector; }  #viewport { grid-area: viewport; }

A named grid area only places an element if that element is a DIRECT child of the grid container.
The first Vue shell wrapped the graph and the viewport in a `.centre` div, which made them
GRANDCHILDREN -- so neither `grid-area` applied, the whole two-row layout collapsed, and the
viewport ended up as a black band under the graph instead of the lower-right panel.

The fix is structural: four components, four direct children, no wrapper.
"""
import pathlib
import re
import sys

APP = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "App.vue"
t = APP.read_text(encoding="utf-8")

# --- template: four direct children, and the panel order the areas imply ------
old = re.search(
    r"    <main id=\"layout\".*?</main>",
    t,
    re.S,
)
if not old:
    print("  !! #layout block not found")
    sys.exit(1)

NEW_MAIN = """    <!-- Four DIRECT children: a named grid area only places a direct child of the grid. -->
    <main id="layout" :class="{ 'no-viewport': !showViewport }">
      <NodePalette />
      <GraphStage />
      <ParamPanel />
      <Viewport3D v-if="showViewport" />
    </main>"""
t = t[:old.start()] + NEW_MAIN + t[old.end():]

# --- the topbar needs .tb-group / .tb-right, which is how style.css lays it out ----
old_bar = re.search(r"    <header id=\"topbar\">.*?</header>", t, re.S)
if not old_bar:
    print("  !! #topbar block not found")
    sys.exit(1)

NEW_BAR = """    <header id="topbar">
      <div class="brand">
        <span class="brand-mark">◈</span>
        <span class="brand-name">GAEA<span class="brand-accent">REA</span></span>
      </div>

      <div class="tb-group">
        <button class="tb" :title="term('New graph')" @click="onNew">＋</button>
        <button class="tb" :title="term('Load the demo pipeline')" @click="onDemo">demo</button>
        <button class="tb" :title="term('Undo')" :disabled="!history.undo" @click="undo(); refreshHistory()">↶</button>
        <button class="tb" :title="term('Redo')" :disabled="!history.redo" @click="redo(); refreshHistory()">↷</button>
        <button class="tb" :title="term('Frame all nodes')" @click="onFit">fit</button>
      </div>

      <div class="tb-group">
        <label class="tb-field" :title="term('Build resolution')">
          <span>res</span>
          <select :value="resolution" @change="onRes">
            <option v-for="r in [128, 256, 512, 1024, 2048]" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label class="tb-field" :title="term('Global seed')">
          <span>seed</span>
          <input type="number" :value="seed" step="1" @input="onSeed" />
        </label>
        <button class="tb small" :title="term('Randomise the seed')" @click="onDice">🎲</button>
      </div>

      <div class="tb-group">
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
      </div>

      <div class="tb-group tb-right">
        <span class="status" :class="{ busy: evalStatus === 'evaluating', error: evalStatus === 'errors' }">
          {{ evalStatus }}<template v-if="lastMs"> · {{ Math.round(lastMs) }}ms</template>
        </span>
        <span class="pill" :title="term('catalogued nodes with a kernel')">{{ coverage.done }}/{{ coverage.total }}</span>
        <label class="tb-field">
          <input v-model="showViewport" type="checkbox" />
          <span>view</span>
        </label>
        <select class="lang" :value="lang" :aria-label="term('Language')" @change="onLang">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </header>"""
t = t[:old_bar.start()] + NEW_BAR + t[old_bar.end():]

# --- the shell must not re-declare the grid or the panel frames ---------------
old_style = re.search(r"<style scoped>.*?</style>", t, re.S)
if old_style:
    t = t[:old_style.start()] + """<style scoped>
/* style.css owns #topbar, #layout, the four grid areas and the panel frames. Nothing here
   re-declares them; repeating the grid is how the first version broke the layout. */
.shell { display: flex; flex-direction: column; height: 100vh; }
/* The viewport is the only area that disappears when hidden, so its row collapses with it. */
#layout.no-viewport { grid-template-areas: "library graph inspector" "library graph inspector"; }
.lang { font-size: 11.5px; }
</style>""" + t[old_style.end():]

APP.write_text(t, encoding="utf-8")
print("  App.vue: four direct grid children, toolbar uses .tb-group/.tb-right/.status/.pill")
