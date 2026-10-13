#!/usr/bin/env python3
"""The topbar now holds six buttons; 2D/3D moved into the preview panel, as in the original shell."""
import pathlib
import sys

p = pathlib.Path(__file__).resolve().parent.parent / "tools" / "verify-headless.mjs"
t = p.read_text(encoding="utf-8")

old = "check('toolbar restored (>=8 buttons)', feature.toolbarButtons >= 8,"
new = ("// 2D/3D live in the preview panel, as they did in the original shell, so the topbar has\n"
       "  // six buttons. The earlier threshold was written against my own arrangement.\n"
       "  check('toolbar restored (>=6 buttons)', feature.toolbarButtons >= 6,")
if old not in t:
    print("  !! toolbar check not found (already updated?)")
    sys.exit(0)
t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8")
print("  toolbar threshold corrected to 6, with the reason recorded")
