#!/usr/bin/env python3
"""Teach validate_web.py that `web/src/` is resolved by Vite, not by the page's import map.

The validator was written for the zero-build app, where every bare specifier has to appear in the
import map because the browser resolves it. Files under `web/src/` are compiled by Vite and use its
aliases (`@js/`, `@kernels/`, `@`), which no import map declares -- so the validator reported

    src\\stores\\session.js: bare specifier '@js/state.js' is not declared in the import map

for a file that Vite resolves correctly on every load.

A validator that reports a false positive is worse than one that reports nothing: it trains the
reader to ignore the output, which is exactly how a real error gets missed later.
"""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "validate_web.py"
t = p.read_text(encoding="utf-8")

if "VITE_ALIAS_PREFIXES" in t:
    print("  already aware of the Vite aliases")
    sys.exit(0)

# Find the bare-specifier check and exempt the Vite-compiled tree.
import re
m = re.search(r"^(\s*)(if\s+.*import map.*:\s*)$", t, re.M)
anchor = None
for cand in (
    "            not in import_map",
    "        not in import_map",
    "    not in import_map",
):
    if cand in t:
        anchor = cand
        break

if anchor is None:
    # Locate the message itself and guard the statement that produces it.
    i = t.find("bare specifier")
    if i < 0:
        print("  !! could not find the bare-specifier check")
        sys.exit(1)
    line_start = t.rfind("\n", 0, i) + 1
    indent = len(t[line_start:]) - len(t[line_start:].lstrip())
    # Walk back to the `if` that guards it.
    if_start = t.rfind("\n" + " " * indent + "if ", 0, i)
    if if_start < 0:
        print("  !! could not find the guarding if")
        sys.exit(1)
    guard_line_start = if_start + 1
    guard_end = t.find("\n", guard_line_start)
    guard = t[guard_line_start:guard_end]
    new_guard = (guard.rstrip().rstrip(":") + "\n"
                 + " " * indent
                 + "    # web/src is compiled by Vite, whose aliases no import map declares.\n"
                 + " " * indent
                 + "    and not str(f).replace('\\\\', '/').startswith('src/')\n"
                 + " " * indent
                 + "    and '/src/' not in str(f).replace('\\\\', '/')\n"
                 + " " * indent
                 + ":")
    t = t[:guard_line_start] + new_guard + t[guard_end:]
    p.write_text(t, encoding="utf-8")
    print("  validate_web.py: web/src excluded from the import-map check")
else:
    t = t.replace(anchor, anchor + "\n            # Vite resolves web/src; no import map declares its aliases.\n            and 'src/' not in str(f).replace('\\\\', '/')", 1)
    p.write_text(t, encoding="utf-8")
    print("  validate_web.py: web/src excluded from the import-map check")
