#!/usr/bin/env python3
"""Make the store actually reactive.

THE BUG, and it is a fundamental one rather than a wiring slip
`stores/app.js` did `export const state = reactive(rawState)`. Vue 3's reactivity is PROXY-based:
wrapping an object in `reactive()` gives YOU a proxy whose traps track reads and writes -- but
`state.js` holds the RAW object and mutates it directly (`state.selected = id`,
`state.graph.nodes.push(...)`). Writes to the raw target never pass through the proxy's `set`
trap, so no computed ever invalidated. The palette rendered, a node added and drew, and the
inspector stayed empty forever, because the store's computeds were evaluated once and never again.

WHY A VERSION COUNTER RATHER THAN A DEEPER FIX
The clean fix is for every mutation to go through the proxy, which means changing `state.js` --
but the kernels and the evaluator import that module directly and read the raw object on purpose,
so rewriting it is a much larger and riskier change than the symptom warrants.

The bus already announces every mutation: `graph:changed`, `selection:changed`, `graph:replaced`,
`history:changed`. Bumping a `version` ref on those and reading it inside each computed gives the
computeds a real reactive dependency. It is a cache-invalidation bridge, not a second source of
truth -- nothing is copied, and the values still come from the original state.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "stores" / "app.js"
t = p.read_text(encoding="utf-8")

if "bumpVersion" in t:
    print("  store already bridges reactivity")
    sys.exit(0)

# 1. The counter and its subscription.
old = """/** The one reactive copy of the app state. */
export const state = reactive(rawState);"""
new = """/**
 * The raw state object, exposed so components can read it without a proxy in the way.
 *
 * NOTE: this is NOT made reactive, and deliberately. `state.js` mutates the raw object directly,
 * so a `reactive()` proxy around it would never see those writes -- Vue 3 tracks through proxy
 * traps, and a write to the target bypasses them. That mistake produced a UI where the palette
 * rendered and nodes drew but the inspector never updated. Reactivity is bridged by `version`
 * below instead.
 */
export const state = rawState;

/**
 * Cache-invalidation counter.
 *
 * Every computed in this file reads it, so bumping it on a bus mutation is what makes them
 * recompute. The bus already announces each change, so nothing new has to be plumbed through.
 */
export const version = ref(0);
export const bumpVersion = () => { version.value++; };

for (const evt of ['graph:changed', 'graph:replaced', 'selection:changed', 'history:changed',
  'node:changed', 'preview:changed']) {
  bus.on(evt, bumpVersion);
}"""
if old not in t:
    print("  !! state declaration not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# 2. Every computed must depend on the counter. Insert an explicit read at the top of each body.
subs = [
    ("const index = computed(() => (catalog.value.nodes || []).map((n) => {",
     "const index = computed(() => {\n  version.value;      // depend on the bridge; see `version`\n  return (catalog.value.nodes || []).map((n) => {"),
    ("export const viewNodes = computed(() => (state.graph.nodes || []).map((n) => {",
     "export const viewNodes = computed(() => {\n  version.value;      // depend on the bridge; see `version`\n  return (state.graph.nodes || []).map((n) => {"),
    ("export const selectedNode = computed(() => {\n  const id = state.selected;",
     "export const selectedNode = computed(() => {\n  version.value;      // depend on the bridge; see `version`\n  const id = state.selected;"),
    ("export const viewEdges = computed(() => {\n  const byId",
     "export const viewEdges = computed(() => {\n  version.value;      // depend on the bridge; see `version`\n  const byId"),
    ("export const selectedSchema = computed(() => {\n  const node = selectedNode.value;",
     "export const selectedSchema = computed(() => {\n  version.value;      // depend on the bridge; see `version`\n  const node = selectedNode.value;"),
]

for old_s, new_s in subs:
    if old_s not in t:
        print(f"  !! computed not matched: {old_s.splitlines()[0][:60]}")
        sys.exit(1)
    t = t.replace(old_s, new_s, 1)

# 3. Close the two bodies whose shape changed from an expression to a block.
t = t.replace("""    haystack: `${n.name} ${rawCategoryOf(n.name) || ''} ${description}`.toLowerCase(),
  };
}));""", """    haystack: `${n.name} ${rawCategoryOf(n.name) || ''} ${description}`.toLowerCase(),
  };
  });
});""", 1)

t = t.replace("""    selected: state.selected === n.id,
  };
}));""", """    selected: state.selected === n.id,
  };
  });
});""", 1)

p.write_text(t, encoding="utf-8")
print("  store: version bridge added, 5 computeds wired to it")
