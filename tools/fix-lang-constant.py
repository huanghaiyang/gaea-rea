#!/usr/bin/env python3
"""Revert DEFAULT_LANG and make Chinese the STARTING language instead.

WHAT I GOT WRONG
`DEFAULT_LANG` does not mean "the language shown first". It means "the language whose strings are
the SOURCE" -- the markup holds English, and

    export function t(id, fallback) {
      if (!ready || store.lang === DEFAULT_LANG) return fallback ?? id;
      return store.ui[id] ?? fallback ?? id;
    }

short-circuits the lookup when the current language IS the source language, because the source text
is already correct. Setting `DEFAULT_LANG = 'zh'` therefore made `t('library.title')` return the
STRING "library.title" in Chinese mode -- the panel headings rendered as dictionary keys.

The two concerns are separate:
    DEFAULT_LANG  which language the markup is written in   -> 'en', never changes
    initial lang  which language the UI starts in           -> 'zh', a preference

`detectLang` now returns 'zh' unless the browser explicitly asks for something else, and
`DEFAULT_LANG` goes back to 'en'.
"""
import pathlib
import re
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "js" / "i18n.js"
t = P.read_text(encoding="utf-8")

# 1. Put DEFAULT_LANG back, with the reason recorded.
old = """// Chinese out of the box. `DEFAULT_LANG` is both the language used when nothing else decides and
// the one whose strings are the source text -- English lives in the markup and the dictionaries
// translate FROM it, so this constant only picks the starting language.
const DEFAULT_LANG = 'zh';"""
new = """// THE SOURCE LANGUAGE, NOT THE STARTING LANGUAGE.
//
// The markup and every fallback string are written in English, and the dictionaries translate FROM
// them. `t()` short-circuits when the current language equals this, because the source text is
// already correct. Setting it to 'zh' made `t('library.title')` return the literal string
// "library.title" in Chinese mode -- headings rendered as keys.
//
// Which language the UI starts in is a separate concern, handled by `START_LANG` below.
const DEFAULT_LANG = 'en';

/** The language the UI starts in when nothing else decides. */
const START_LANG = 'zh';"""
if old not in t:
    print("  !! DEFAULT_LANG block not found")
    sys.exit(1)
t = t.replace(old, new, 1)

# 2. detectLang returns START_LANG on a miss.
m = re.search(r"(export function detectLang\(\)\s*\{)(.*?)\n\}", t, re.S)
if not m:
    print("  !! detectLang not found")
    sys.exit(1)
body = m.group(2)
# Replace whatever the tail returns with the new constant.
body2 = re.sub(r"return\s+/\^zh[^;]*;", "return /^zh\\b/i.test(nav) ? 'zh' : START_LANG;", body)
if body2 == body:
    body2 = re.sub(r"return\s+[^;]*;", "return /^zh\\b/i.test(nav) ? 'zh' : START_LANG;", body, count=1)
t = t[:m.start(2)] + body2 + t[m.end(2):]

# 3. Drop the doc comment my previous edit attached to that return.
t = re.sub(r"\n\s*// An explicit choice wins; otherwise Chinese.*?\n\s*// back to only when nothing matched.*?\n", "\n", t, flags=re.S)

P.write_text(t, encoding="utf-8")
print("  i18n.js: DEFAULT_LANG back to 'en', START_LANG = 'zh'")

need = t.count("START_LANG")
print(f"  START_LANG referenced {need} time(s)")
if need < 2:
    print("  !! START_LANG is declared but not used -- detectLang was not rewritten")
    sys.exit(1)
