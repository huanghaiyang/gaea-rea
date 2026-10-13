<script setup>
/**
 * GraphStage — the graph panel, inside the frame `style.css` defines.
 *
 * `#graphwrap` is a named grid area, `.graphview` is the positioned box and `#graph-canvas` is the
 * drawing surface. Those three names are the stylesheet's contract; the first version used a
 * `.stage` class of my own and got none of the layout.
 */
import GraphCanvas from './GraphCanvas.vue';
import {  t } from '@js/i18n.js';
</script>

<template>
  <section id="graphwrap" class="panel">
    <div class="panel-head">
      <h2>{{ t('graph.title') }}</h2>
    </div>
    <div class="graphview">
      <GraphCanvas />
    </div>
  </section>
</template>
