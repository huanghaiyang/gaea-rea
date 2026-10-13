#!/usr/bin/env python3
"""Link a favicon, and stop treating its absence as an application error."""
import pathlib

WS = pathlib.Path(__file__).resolve().parent.parent

h = WS / "web" / "index.html"
s = h.read_text(encoding="utf-8")
if 'rel="icon"' not in s:
    s = s.replace('<link rel="stylesheet"',
                  '<link rel="icon" href="/vite.svg" />\n    <link rel="stylesheet"', 1)
    h.write_text(s, encoding="utf-8")
    print("  index.html: favicon linked (the 404 was the only remaining failure)")
else:
    print("  favicon already linked")

v = WS / "tools" / "verify-headless.mjs"
t = v.read_text(encoding="utf-8")
if "realErrors" not in t:
    old = "  if (pageErrors.length) {"
    new = ("  // A missing favicon is a browser convenience request, not an application error. Treating\n"
           "  // it as one failed the whole run while every real check passed, which is the kind of\n"
           "  // false negative that trains a reader to ignore the result.\n"
           "  const realErrors = pageErrors.filter((e) => !/favicon\\.ico/i.test(String(e)));\n"
           "  if (realErrors.length) {")
    if old not in t:
        print("  !! pageErrors block not found")
    else:
        t = t.replace(old, new, 1)
        t = t.replace("for (const e of pageErrors.slice(0, 8))", "for (const e of realErrors.slice(0, 8))", 1)
        v.write_text(t, encoding="utf-8")
        print("  verifier: favicon 404 filtered out")
else:
    print("  verifier already filters favicon")
