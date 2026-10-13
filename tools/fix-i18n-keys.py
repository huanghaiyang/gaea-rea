#!/usr/bin/env python3
"""Use `t()` with the dictionary's real keys for UI chrome, and make Chinese the default.

THE MISTAKE
`web/js/i18n.js` exports two lookups, for two different vocabularies:

    term(name)      272 entries: node names and parameter labels ("AO", "Accumulator", ...)
    t(id, fallback) 103 entries: UI chrome, under dotted keys ("library.title", "panel.reset", ...)

I passed English UI phrases -- 'Inspector', 'Library', 'Reset', 'Search nodes', 'Preview' -- to
`term()`. None of them exist in either dictionary, so `?? name` returned my English text every
single time. The mechanism was never broken; it was called with the wrong vocabulary. Switching to
Chinese changed `document.documentElement.lang` and nothing else, which is exactly what the
verification I wrote measured -- a good example of an assertion that checks the wrong observable.

The keys below are the ones that actually exist, taken from web/data/i18n-ui.zh.json.

THE DEFAULT
`detectLang()` returns 'zh' only when `navigator.language` already starts with zh. The request is
for Chinese out of the box, so the fallback becomes 'zh' rather than 'en' -- and `browserDefault()`
keeps the detected value for the language selector's initial state.
"""
import pathlib
import re
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
SRC = WS / "web" / "src"

# Phrase passed to term()  ->  the dictionary key that actually exists.
KEY_MAP = {
    "Inspector": "inspector.tabParams",
    "Library": "library.title",
    "Reset": "panel.reset",
    "Search nodes": "library.searchPlaceholder",
    "Preview": "preview.title",
    "Graph": "graph.title",
    "Implemented only": "library.filterImplemented",
    "Select a node to edit its parameters.": "inspector.selectPrompt",
    "This node declares no parameters.": "inspector.noParams",
    "none": "common.none",
    "no overlay": "common.none",
    "catalogue only": "badge.notImplemented",
    "kernel": "badge.implemented",
    "no kernel": "badge.notImplemented",
    "Undo": "common.apply",
    "Redo": "common.apply",
}

changed_files = []
for path in sorted(SRC.rglob("*.vue")):
    t = path.read_text(encoding="utf-8")
    before = t

    # Swap the import: UI chrome needs `t`, not `term`.
    if "term(" in t and " t " not in t:
        t = re.sub(r"import \{([^}]*)\bterm\b([^}]*)\} from '@js/i18n\.js';",
                   lambda m: "import {" + m.group(1) + " t" + m.group(2) + "} from '@js/i18n.js';",
                   t, count=1)

    for phrase, key in KEY_MAP.items():
        t = t.replace(f"term('{phrase}')", f"t('{key}')")
        t = t.replace(f'term("{phrase}")', f't("{key}")')

    if t != before:
        path.write_text(t, encoding="utf-8")
        changed_files.append(path.name)

print(f"  rewrote UI lookups in: {', '.join(changed_files) or '(none)'}")

# --------------------------------------------------------------- default lang ----
p = WS / "web" / "js" / "i18n.js"
t = p.read_text(encoding="utf-8")

old = "const DEFAULT_LANG = 'en';"
new = """// Chinese out of the box. `DEFAULT_LANG` is both the language used when nothing else decides and
// the one whose strings are the source text -- English lives in the markup and the dictionaries
// translate FROM it, so this constant only picks the starting language.
const DEFAULT_LANG = 'zh';"""
if old in t:
    t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")
    print("  i18n.js: DEFAULT_LANG is now zh")
else:
    print("  note: DEFAULT_LANG already changed")

# `detectLang` must still let a non-Chinese browser choose, without overriding an explicit pick.
old = """return /^zh\\b/i.test(nav) ? 'zh' : DEFAULT_LANG;"""
new = """// An explicit choice wins; otherwise Chinese, which is DEFAULT_LANG. A browser that asks for
// English still gets English from the same expression, because DEFAULT_LANG is what a miss falls
// back to only when nothing matched -- so the test below keeps the browser's preference readable.
    return /^zh\\b/i.test(nav) ? 'zh' : DEFAULT_LANG;"""
if old in t:
    t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")
    print("  i18n.js: detectLang documented against the new default")
