#!/usr/bin/env python3
"""Replace the whole ParamPanel template block, cleanly.

The previous edit anchored its end on the first `</template>`, which is an INNER one -- so it
replaced the head of the template and left the tail of the old body behind. The file then had five
`</template>` and one `<template>`, and Vue refused to compile it.

Rather than excise the orphan by line number, the entire block from the outer `<template>` to its
closing tag is rebuilt. That is the only edit whose correctness does not depend on knowing which
inner tag lines up with which.
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "ParamPanel.vue"
t = P.read_text(encoding="utf-8")

start = t.find("<template>")
end = t.find("</template>", t.find("</aside>"))
if start < 0 or end < 0:
    print("  !! template block boundaries not found")
    sys.exit(1)
end += len("</template>")

BLOCK = """<template>
  <aside id="inspector" class="panel">
    <header class="panel-head">
      <h2>{{ term('Inspector') }}</h2>
      <button v-if="selNode" class="tb small" @click="resetParams(selNode.id)">
        {{ term('Reset') }}
      </button>
    </header>

    <p v-if="!selNode" class="empty panel-body">
      {{ term('Select a node to edit its parameters.') }}
    </p>

    <template v-else>
      <div class="node-head">
        <div class="node-title">
          <strong>{{ selNode.name }}</strong>
          <span v-if="hasKernel" class="pill">{{ term('kernel') }}</span>
          <span v-else class="pill">{{ term('no kernel') }}</span>
        </div>
      </div>

      <p v-if="!rows.length" class="empty panel-body">
        {{ term('This node declares no parameters.') }}
      </p>

      <!-- The structure params-panel.js builds, and the one style.css is written for:
           .param > .param-label + .param-value + .param-control > control.
           The `.param-control` wrapper is not decoration -- `style.css` sets a select's BACKGROUND
           through it, and without it `color: inherit` left white text on the browser's default
           light control. -->
      <div v-else class="panel-body">
        <div class="param-list">
          <div v-for="row in rows" :key="row.key" class="param">
            <label class="param-label" :for="`p-${row.key}`" :title="row.hint">
              {{ row.label }}<span v-if="row.hint" class="info" :title="row.hint">?</span>
            </label>

            <span class="param-value">
              {{ row.kind === 'check' ? (row.value ? 'on' : 'off') : row.value }}
            </span>

            <div class="param-control">
              <select
                v-if="row.kind === 'select'"
                :id="`p-${row.key}`"
                :value="row.value"
                @change="onInput(row.key, $event, 'select')"
              >
                <option v-for="o in row.options" :key="String(o)" :value="o">
                  {{ i18nOption(o) }}
                </option>
              </select>

              <input
                v-else-if="row.kind === 'check'"
                :id="`p-${row.key}`"
                type="checkbox"
                :checked="!!row.value"
                @change="onInput(row.key, $event, 'check')"
              />

              <input
                v-else-if="row.kind === 'range'"
                :id="`p-${row.key}`"
                type="range"
                :min="row.min"
                :max="row.max"
                :step="row.step ?? 0.01"
                :value="row.value"
                @input="onInput(row.key, $event, 'range')"
              />

              <template v-else-if="row.kind === 'vec'">
                <input
                  v-for="(v, i) in row.value"
                  :key="i"
                  class="vec"
                  type="number"
                  :value="v"
                  :step="row.step ?? 0.01"
                  :aria-label="`${row.label} ${AXES[i] || i}`"
                  @input="onVector(row.key, i, row.spec, $event)"
                />
              </template>

              <input
                v-else-if="row.kind === 'number'"
                :id="`p-${row.key}`"
                type="number"
                :value="row.value"
                :step="row.step ?? 1"
                @input="onInput(row.key, $event, 'number')"
              />

              <input
                v-else
                :id="`p-${row.key}`"
                type="text"
                :value="row.value"
                @input="onInput(row.key, $event, 'text')"
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </aside>
</template>"""

t = t[:start] + BLOCK + t[end:]
P.write_text(t, encoding="utf-8")

# Structural check, because the last failure was a tag-count mismatch that only Vue noticed.
opens = t.count("<template")
closes = t.count("</template>")
print(f"  <template>={opens}  </template>={closes}  {'OK' if opens == closes else 'MISMATCH'}")
print(f"  .param-control={(t.count('param-control'))}  .param-list={(t.count('param-list'))}")
if opens != closes:
    sys.exit(1)
