#!/usr/bin/env python3
"""Stop rendering `algorithmOf(...)`, with the exact source text this time.

The previous attempt replaced a two-line string that did not match the file (it had been reflowed
by an earlier edit), so the replacement silently did nothing and the screenshot still opened with

    function outputNode(ctx) { const src = ctx.input(0); ... }

`algorithmOf` returns the registry's function OBJECT, so interpolating it stringifies the function.
"""
import pathlib
import sys

P = pathlib.Path(__file__).resolve().parent.parent / "web" / "src" / "components" / "ParamPanel.vue"
t = P.read_text(encoding="utf-8")

start = t.find('        <span v-if="algorithmOf(selNode.name)" class="pill">')
if start < 0:
    print("  !! algorithmOf span not found")
    # Show what is actually there, so the next attempt is not another guess.
    for i, line in enumerate(t.splitlines(), 1):
        if "algorithmOf" in line and "import" not in line and "computed" not in line and "*" not in line:
            print(f"    L{i}: {line!r}")
    sys.exit(1)

# Find the end of the span it opens.
end = t.find("</span>", start)
if end < 0:
    print("  !! closing span not found")
    sys.exit(1)
end += len("</span>")

replacement = """        <span v-if="hasKernel" class="pill">{{ term('kernel') }}</span>"""
t = t[:start] + replacement + t[end:]
P.write_text(t, encoding="utf-8")
print("  ParamPanel.vue: algorithmOf span replaced with a kernel existence pill")
