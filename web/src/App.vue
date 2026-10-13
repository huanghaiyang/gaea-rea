<script setup>
/**
 * App — the shell.
 *
 * Layout is the same three-column arrangement the previous UI used, because that arrangement is
 * right for this work: a catalogue on the left, the graph and the 3D result sharing the middle,
 * and the inspector on the right. The rewrite changes how it is built, not what it is.
 *
 * The node-add path is an event rather than a prop chain: the palette raises `gaea:add-node` on
 * `window` and GRAPHSTAGE listens for it, because GraphStage owns the editor that performs the
 * add. Handling it here as well, as the first version did, emitted `graph:add` twice and created
 * every node twice.
 */
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import NodePalette from './components/NodePalette.vue';
import GraphStage from './components/GraphStage.vue';
import Viewport3D from './components/Viewport3D.vue';
import ParamPanel from './components/ParamPanel.vue';
import {
  coverage, state, historyDepth, undo, redo, selectNode, bus,
} from './stores/app.js';
import {
  evaluator, loadDemo, newGraph, evalStatus, lastMs, glAvailable,
  setRamp, setExaggeration, setViewMode,
} from './stores/session.js';
import { t, currentLang, setLang, term } from '@js/i18n.js';

const showViewport = ref(true);
const history = ref({ undo: 0, redo: 0 });
const status = ref('');

function refreshHistory() {
  history.value = historyDepth();
}

const ramp = ref('terrain');
const exaggeration = ref(1);
const seed = ref(0);
const resolution = ref(512);
const RAMP_NAMES = ['terrain', 'grayscale', 'rock', 'sand', 'blue', 'green'];

function onNew() { newGraph(); refreshHistory(); }
function onDemo() { loadDemo(); refreshHistory(); }

/**
 * Frame every node.
 *
 * Through a window event rather than a ref, because `GraphCanvas` owns the view transform and is
 * not this component's child in any way it can reach. Dispatching an event that nothing listens
 * for is what the first version did.
 */
function onFit() { window.dispatchEvent(new CustomEvent('gaea:fit')); }

function onRamp(ev) { ramp.value = ev.target.value; setRamp(ramp.value); }
function onExag(ev) { exaggeration.value = Number(ev.target.value); setExaggeration(exaggeration.value); }

/** The build resolution lives on the graph, so it is written there and re-evaluated. */
function onRes(ev) {
  const size = Number(ev.target.value) | 0;
  resolution.value = size;
  state.graph.build.size = size;
  evaluator.requestNow('resolution');
  refreshHistory();
}

/** Likewise the seed. `state.graph.build` is what the evaluator reads. */
function onSeed(ev) {
  const v = Number(ev.target.value) | 0;
  seed.value = v;
  state.graph.build.seed = v;
  evaluator.requestNow('seed');
}

function onDice() {
  const s = Math.floor(Math.random() * 100000);
  seed.value = s;
  state.graph.build.seed = s;
  // The field must show the value that was actually used, not the previous one.
  evaluator.requestNow('seed');
  refreshHistory();
}

function onMode(m) { setViewMode(m); }

function onKey(ev) {
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); refreshHistory(); }
  else if (mod && (ev.key === 'y' || (ev.key === 'z' && ev.shiftKey))) { ev.preventDefault(); redo(); refreshHistory(); }
  else if (mod && ev.key === '3') { ev.preventDefault(); showViewport.value = !showViewport.value; }
  else if (ev.key === 'Escape') { selectNode(null); }
}

function onLang(ev) {
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
}

let offBus = null;

onMounted(() => {
  // `gaea:add-node` is NOT handled here. GraphStage listens for it, because GraphStage is what
  // constructs the editor that performs the add. Listening in both places emitted `graph:add`
  // twice and created the node twice.
  window.addEventListener('keydown', onKey);
  refreshHistory();
  // The state layer already broadcasts changes; mirroring them keeps the history readout live
  // without polling.
  offBus = bus.on?.('change', refreshHistory) || null;
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  if (typeof offBus === 'function') offBus();
});

const lang = currentLang();
const warnings = computed(() => (window.__gaea && window.__gaea.warnings) || []);
</script>

<template>
  <div class="shell">
    <header id="topbar">
      <div class="brand">
        <span class="brand-mark">◈</span>
        <span class="brand-name">GAEA<span class="brand-accent">REA</span></span>
      </div>

      <div class="tb-group">
        <button class="tb" :title="term('New graph')" @click="onNew">＋</button>
        <button class="tb" :title="term('Load the demo pipeline')" @click="onDemo">demo</button>
        <button class="tb" :title="t('common.apply')" :disabled="!history.undo" @click="undo(); refreshHistory()">↶</button>
        <button class="tb" :title="t('common.apply')" :disabled="!history.redo" @click="redo(); refreshHistory()">↷</button>
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
        <!-- `.tb-field` is the class style.css styles for a topbar control. `class="lang"` with
             only a scoped font-size left the select with `color: inherit` (white) and no
             background, i.e. white text on the browser's default light control. -->
        <label class="tb-field">
          <span>lang</span>
          <select :value="lang" :aria-label="term('Language')" @change="onLang">
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
    </header>

    <!-- Four DIRECT children: a named grid area only places a direct child of the grid. -->
    <main id="layout" :class="{ 'no-viewport': !showViewport }">
      <NodePalette />
      <GraphStage />
      <ParamPanel />
      <Viewport3D v-if="showViewport" />
    </main>

  </div>
</template>

<style scoped>
/* style.css owns #topbar (44px) and #layout (calc(100% - 44px)), plus the four named grid areas.
   Nothing here re-declares the grid: repeating it is what broke the layout in the first pass.
   There is deliberately NO footer -- the original shell is two bands, and the evaluation status
   and coverage count live in the topbar's .tb-right. */
.shell { display: flex; flex-direction: column; height: 100vh; }
/* The viewport is the only area that disappears, so its row collapses with it. */
#layout.no-viewport { grid-template-areas: "library graph inspector" "library graph inspector"; }

</style>
