<script setup>
/**
 * NodePalette — the library panel.
 *
 * Grouped by category rather than shown as one list of 182 rows, because the categories are how
 * the catalogue is actually navigated and they are the only structure the data carries.
 *
 * Unimplemented nodes are shown rather than hidden, greyed and marked. A catalogue browser that
 * silently omits 99 of 182 entries would misrepresent how much is done; the count in the header
 * says so explicitly instead.
 */
import {
  palette as paletteRef, byCategory as byCategoryRef, coverage as coverageRef,
  filter as filterRef, implementedOnly as implRef, selectNode, state,
} from '../stores/app.js';

// Local aliases so the template receives unwrapped values rather than the ref objects. See the
// note in ParamPanel.vue: an imported ref is not auto-unwrapped by the template compiler.
const rows = paletteRef;
const groups = byCategoryRef;
const counts = coverageRef;
const filter = filterRef;
const implementedOnly = implRef;
import { t, paramLabel, term } from '@js/i18n.js';

function onDragStart(ev, name) {
  // The graph stage listens for this. Using a dataTransfer payload rather than a shared variable
  // keeps the drag working if the stage is remounted mid-gesture.
  ev.dataTransfer.setData('text/gaea-node', name);
  ev.dataTransfer.effectAllowed = 'copy';
}

function add(name) {
  // Click-to-add is the accessible path; dragging is the fast one. Both are provided because a
  // drag-only palette is unreachable by keyboard.
  window.dispatchEvent(new CustomEvent('gaea:add-node', { detail: { name } }));
}
</script>

<template>
  <aside id="library" class="panel">
    <header class="panel-head">
      <h2>{{ t('library.title') }}</h2>
      <span class="pill" :title="`${counts.done} of ${counts.total} catalogued nodes have a kernel`">
        {{ counts.done }}/{{ counts.total }}
      </span>
    </header>

    <div class="lib-filters">
      <!-- `.search` is the class style.css styles; without it the input renders as a browser
           default, which is what the white rectangle in the panel was. -->
      <input
        v-model="filter"
        class="search"
        type="search"
        :placeholder="t('library.searchPlaceholder')"
        :aria-label="t('library.searchPlaceholder')"
      />
      <label class="toggle">
        <input v-model="implementedOnly" type="checkbox" />
        <span>{{ t('library.filterImplemented') }}</span>
      </label>
    </div>

    <!-- `.panel-body` is the scroll container style.css defines. `.lib-list` is only the
         flex column of rows; giving it the overflow instead let the list grow to 5915px inside
         a 758px panel, with everything below the fold unreachable. -->
    <div class="panel-body">
      <div class="lib-list" role="listbox" :aria-label="t('library.title')">
        <p v-if="!rows.length" class="empty">{{ term('No node matches that search.') }}</p>

        <section v-for="[cat, items] in groups" :key="cat">
        <h3 class="lib-group">{{ term(cat) }}</h3>
        <ul>
          <li
            v-for="row in items"
            :key="row.name"
            :class="['lib-item', row.implemented ? 'impl' : 'dim']"
            :title="row.description"
            role="option"
            :aria-selected="state.selectedId && state.selectedId === row.name"
            draggable="true"
            tabindex="0"
            @dragstart="onDragStart($event, row.name)"
            @click="add(row.name)"
            @keydown.enter.prevent="add(row.name)"
            @keydown.space.prevent="add(row.name)"
          >
            <span class="dot" />
            <!-- Node names live in the TERMS dictionary; `term()` is the lookup for them. -->
            <span class="nm">{{ term(row.name) }}</span>
            <!-- `.cnt` is the class style.css styles; the marker is short enough for a 236px column.
                 The full phrase is in the tooltip and, at group level, in the heading. -->
            <span v-if="!row.implemented" class="cnt" :title="t('badge.notImplemented')">∅</span>
          </li>
        </ul>
        </section>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* Only the few things style.css does not already define. */
#library { min-height: 0; }

/* A `<ul>` carries `padding-inline-start: 40px` from the user agent, which is the indent the list
   showed. The original scoped block reset it and got dropped when the styles were reduced to
   "only what style.css does not cover" -- the reset was part of what went. */
:deep(.lib-list ul) { list-style: none; margin: 0; padding: 0; }

/* A row must never grow taller than its neighbours because a badge wrapped. */
:deep(.lib-item) { white-space: nowrap; }
:deep(.lib-item .nm) { min-width: 0; }
</style>

