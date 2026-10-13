<script setup>
/**
 * Viewport3D — the preview panel.
 *
 * STRUCTURE COPIED FROM `legacy.html`, NOT INVENTED
 * This markup matches the pre-Vue shell's, down to the element ids, because `web/css/style.css`
 * styles exactly these selectors and nothing else:
 *
 *     #viewport                 grid-area: viewport
 *     #viewport.panel           panel frame
 *     .panel-head / .panel-body / .vp-tools / .vp-body / .vp-fallback
 *     #view-canvas-2d, #view-canvas-3d
 *     #view-canvas-2d[hidden], #view-canvas-3d[hidden] { display: none; }
 *
 * THE BUG THIS REPLACES
 * The first version used `class="viewport"` on a `<section>` plus a SCOPED rule
 * `.c3d { display: none }`. `Viewport` switches the two canvases by toggling the `hidden`
 * ATTRIBUTE, so a CSS `display: none` of my own permanently hid the 3D canvas and the 2D/3D toggle
 * did nothing at all. No scoped display rule belongs on these canvases.
 *
 * The 3D canvas is declared `hidden` in the markup, as the old shell did, so the initial state is
 * correct before any script runs.
 */
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { t, term } from '@js/i18n.js';
import {
  attachViewport, detachViewport, glAvailable, vpStatus, setViewMode, state, viewport,
} from '../stores/session.js';
import { OVERLAY_NAMES, OVERLAY_LABELS } from '@js/overlays.js';

const host = ref(null);
const canvas2d = ref(null);
const canvas3d = ref(null);
const overlayName = ref(null);   // none by default
const overlayOpacity = ref(0.6);
const overlayReady = ref([]);
const mode = ref('2d');

let observer = null;

/** The viewport's own three.js renderer, once the viewport has created it. */
function rendererOf() {
  return viewport.value?.renderer3d || null;
}

const availableOverlays = computed(() => overlayReady.value.filter((o) => o.loaded));

/**
 * Whether a renderer exists to draw an overlay with.
 *
 * Reactive rather than a one-time check: `Viewport` creates its renderer lazily, so this becomes
 * true only after the first 3D frame or a mode switch, and the control must un-disable itself then.
 */
const rendererReady = ref(false);

onMounted(async () => {
  const vp = attachViewport(canvas2d.value, canvas3d.value, { host: host.value });

  // `Viewport` measures its host, so a size change has to be reported to it. A ResizeObserver
  // rather than a window listener: a panel being dragged wider never fires a window resize.
  const fit = () => vp.resize?.();
  fit();
  observer = new ResizeObserver(fit);
  observer.observe(host.value);

  // Keep the mode pill in step. `Viewport` owns the actual mode and toggles `hidden` itself.
  const syncMode = () => { mode.value = state.viewMode; };
  syncMode();
  const offMode = state.__onMode;

  // Overlays are optional: `web/assets` is gitignored vendor data.
  const r3 = rendererOf();
  rendererReady.value = !!r3;
  if (r3?.loadOverlays) {
    const res = await r3.loadOverlays();
    overlayReady.value = r3.overlayStatus?.() || [];
    if (res.failed && res.failed.length) {
      console.warn(`[gaea] overlays unavailable: ${res.failed.join(', ')}; run tools/extract-assets.py`);
    }
  }
  void offMode;
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  detachViewport();
});

/**
 * Overlay control.
 *
 * The renderer is created lazily inside `Viewport`, so it is looked up at call time rather than
 * captured at mount, when it may still be null.
 */
/**
 * Make sure the CURRENT renderer holds the palette, then show it.
 *
 * The overloads are loaded once at mount, but `Viewport` creates its three.js renderer lazily --
 * so a renderer built when 3D is first entered has none of them, and `setOverlay` correctly says
 * so. Loading on demand is what makes the control independent of WHEN the renderer appeared.
 *
 * `loadOverlays()` skips the ones it already has, so calling it per selection costs nothing after
 * the first time.
 */
async function ensureLoaded(r3, name) {
  if (r3.overlay?.textures?.has?.(name)) return true;
  await r3.loadOverlays?.();
  overlayReady.value = r3.overlayStatus?.() || [];
  return !!r3.overlay?.textures?.has?.(name);
}

async function onOverlayChange(ev) {
  // `''` is the sentinel the empty option carries. `null` never arrives from a select.
  const pick = ev.target.value;
  const name = pick === '' ? null : pick;
  overlayName.value = name;
  if (name === null) {
    rendererOf()?.setOverlay?.(null);
    return;
  }

  // TWO DIFFERENT FAILURES, reported separately. The first version called both "the asset is
  // missing", which sent the reader after a file that fetches with a 200.
  const r3 = rendererOf();
  if (!r3) {
    console.warn(
      '[gaea] overlays need the 3D renderer, which does not exist yet '
      + '(2D mode, or WebGL2 unavailable). The textures themselves are fine.',
    );
    return;
  }

  await ensureLoaded(r3, name);

  if (!r3.setOverlay?.(name, overlayOpacity.value)) {
    console.warn(
      `[gaea] overlay "${name}" could not be shown even after loading it into the current `
      + 'renderer. If the fetch for web/assets/overlays/' + name + '.png fails, run '
      + 'tools/extract-assets.py.',
    );
  }
}

function onOpacity(ev) {
  overlayOpacity.value = Number(ev.target.value);
  if (overlayName.value) rendererOf()?.setOverlay?.(overlayName.value, overlayOpacity.value);
}

function chooseMode(m) {
  setViewMode(m);
  mode.value = m;
  // The renderer is created on demand, so a mode switch is exactly when it can appear.
  setTimeout(() => { rendererReady.value = !!rendererOf(); }, 400);
}
</script>

<template>
  <!-- The ids and classes are style.css's contract; do not rename them. -->
  <section id="viewport" class="panel" ref="host">
    <div class="panel-head">
      <h2><span>{{ t('preview.title') }}</span></h2>
      <div class="vp-tools">
        <span class="pill">{{ mode.toUpperCase() }}</span>

        <label
          v-if="availableOverlays.length"
          class="tb-field"
          :title="rendererReady
            ? term('Overlay')
            : term('Overlays need the 3D renderer; the textures are present but nothing can draw them in 2D.')"
        >
          <span>ovl</span>
          <select
            :value="overlayName ?? ''"
            :disabled="!rendererReady"
            :aria-label="term('Overlay')"
            @change="onOverlayChange"
          >
            <!-- An option's value is ALWAYS a string once it is in the DOM, so `:value="null"`
                 arrives as "null" and a `name === null` test never fires. A named sentinel is the
                 only reliable way to express "no overlay". -->
            <option value="">{{ t('common.none') }}</option>
          <option
            v-for="o in OVERLAY_NAMES" :key="o" :value="o"
            :disabled="!availableOverlays.some((a) => a.name === o)"
            >{{ OVERLAY_LABELS[o] }}</option>
          </select>
        </label>

        <input
          v-if="overlayName"
          class="vp-opacity" type="range" min="0" max="1" step="0.05"
          :value="overlayOpacity" :aria-label="term('Opacity')" @input="onOpacity"
        />

        <button class="tb small" :class="{ active: mode === '2d' }" @click="chooseMode('2d')">2D</button>
        <button
          class="tb small" :class="{ active: mode === '3d' }"
          :disabled="!glAvailable" @click="chooseMode('3d')"
        >3D</button>
      </div>
    </div>

    <div class="panel-body vp-body">
      <!-- `Viewport` toggles `hidden` on these. No rule of ours may set their display. -->
      <canvas id="view-canvas-2d" ref="canvas2d" />
      <canvas id="view-canvas-3d" ref="canvas3d" hidden />
      <p v-if="!glAvailable" class="vp-fallback">{{ vpStatus || term('WebGL2 unavailable') }}</p>
    </div>
  </section>
</template>

<style scoped>
/* Only what style.css does not define. Nothing here touches the canvases' display. */
.vp-opacity { width: 72px; accent-color: var(--accent, #4a8fd4); }
</style>
