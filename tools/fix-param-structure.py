#!/usr/bin/env python3
"""Use the parameter row structure `style.css` is written for.

WHAT WAS WRONG, and it is the same mistake as the search box and the list indent
`params-panel.js` builds each row like this:

    <div class="param">
      <label class="param-label">Octaves</label>
      <span class="param-value">10</span>
      <div class="param-control"><input ...></div>
    </div>

My template had the label and the control as siblings of `.param`, with no `.param-control`
wrapper and no `.param-value`. `style.css` styles the control THROUGH that wrapper:

    .param-control select      { background: var(--bg-0); border: 1px solid var(--line); ... }
    .param-control input[type="range"] { flex: 1 1 auto; accent-color: var(--accent); ... }

so neither applied. The visible result was the reported one: `button, input, select { color:
inherit }` made the select's TEXT white while nothing set its BACKGROUND, leaving white text on the
browser's default light control. White on white.

This also settles the still-unverified "parameter rows look wrong" item from the previous round --
the rows were not merely laid out differently, they were missing the element the stylesheet hangs
its control rules on.
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "ParamPanel.vue"
t = P.read_text(encoding="utf-8")

start = t.find('<div v-else class="panel-body param-list">')
end = t.find("</template>", start)
if start < 0 or end < 0:
    print("  !! parameter block not found")
    sys.exit(1)

BODY = '''<div v-else class="panel-body">
        <div class="param-list">
          <div v-for="row in rows" :key="row.key" class="param">
            <label class="param-label" :for="`p-${row.key}`" :title="row.hint">
              {{ row.label }}<span v-if="row.hint" class="info" :title="row.hint">?</span>
            </label>

            <!-- The readout is its own element, as in params-panel.js; `style.css` styles it. -->
            <span class="param-value">{{ row.kind === 'check' ? (row.value ? 'on' : 'off') : row.value }}</span>

            <!-- THE WRAPPER THE STYLESHEET HANGS ITS CONTROL RULES ON. Without it a select keeps
                 `color: inherit` from the dark panel and no background, i.e. white on white. -->
            <div class="param-control">
              <select
                v-if="row.kind === 'select'"
                :id="`p-${row.key}`"
                :value="row.value"
                @change="onInput(row.key, $event, 'select')"
              >
                <option v-for="o in row.options" :key="String(o)" :value="o">{{ i18nOption(o) }}</option>
              </select>

              <input
                v-else-if="row.kind === 'check'"
                :id="`p-${row.key}`"
                type="checkbox"
                :checked="!!row.value"
                @change="onInput(row.key, $event, 'check')"
              />

              <template v-else-if="row.kind === 'range'">
                <input
                  :id="`p-${row.key}`"
                  type="range"
                  :min="row.min"
                  :max="row.max"
                  :step="row.step ?? 0.01"
                  :value="row.value"
                  @input="onInput(row.key, $event, 'range')"
                />
              </template>

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
    '''

t = t[:start] + BODY + t[end:]

# Only the few things style.css does not define.
s = t.find("<style scoped>")
e = t.find("</style>")
if s >= 0 and e > s:
    t = t[:s] + """<style scoped>
/* style.css supplies `.param`, `.param-label`, `.param-value`, `.param-control` and their control
   rules. Nothing here re-declares them -- doing so is how the select lost its background. */
.info {
  display: inline-block; margin-left: 4px; width: 12px; height: 12px; line-height: 12px;
  text-align: center; border-radius: 50%; border: 1px solid currentColor;
  font-size: 9px; color: var(--tx-2, #888);
}
.param-control .vec { width: 100%; margin-bottom: 2px; }
</style>""" + t[e + len("</style>"):]

P.write_text(t, encoding="utf-8")
print("  ParamPanel.vue: .param / .param-label / .param-value / .param-control structure")
