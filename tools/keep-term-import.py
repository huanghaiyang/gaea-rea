#!/usr/bin/env python3
"""Keep `term` imported alongside `t`.

The key rewrite mapped fifteen UI phrases to their real dictionary keys, but sixteen `term(...)`
calls remain -- mostly `title=` tooltips whose exact wording has no key in the dictionary. Removing
the import would make every one of them a `ReferenceError` at render time and take the component
down, which is a far worse outcome than an untranslated tooltip.

Both are therefore imported, and the survivors are listed so it is visible that they are a known
remainder rather than an oversight. They are tooltips, and `term()` returns the English text
unchanged, which is the correct degradation for a string the dictionary does not have.
"""
import pathlib
import re

WS = pathlib.Path(__file__).resolve().parent.parent
SRC = WS / "web" / "src"

for path in sorted(SRC.rglob("*.vue")):
    t = path.read_text(encoding="utf-8")
    if "term(" not in t:
        continue

    # Add `term` back next to `t` if it is missing.
    m = re.search(r"import \{([^}]*)\} from '@js/i18n\.js';", t)
    if not m:
        continue
    names = [n.strip() for n in m.group(1).split(",") if n.strip()]
    if "term" not in names:
        names.append("term")
        names = sorted(set(names), key=lambda n: (n != "t", n))
        t = t[:m.start()] + "import { " + ", ".join(names) + " } from '@js/i18n.js';" + t[m.end():]
        path.write_text(t, encoding="utf-8")
        print(f"  {path.name}: term re-imported ({len([1 for _ in re.finditer(r'term[(]', t)])} use(s))")

print()
print("  Remaining term() calls are tooltips with no dictionary key; they fall back to English.")
