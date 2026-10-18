#!/usr/bin/env python3
"""Resolve every obfuscated constant reference in the recovered node source.

THE PROBLEM THIS SOLVES
The recovered C# is readable in structure but peppered with
`\\ue0003.\\ue002(161)` and `\\ue0003.\\ue000(7)` -- indices into Eazfuscator's encrypted pools.
Statiscally those pools are opaque; at runtime they decrypt into int[], long[], float[] and double[]
arrays, which `tools/gaea-probe` now extracts (`evidence/pool_Gaea.Nodes_*.json`).

With the pools on disk, every reference becomes a literal number. One pass turns 109 nodes'
algorithms from "structure known, numbers missing" into fully readable source -- which is a more
complete answer than implementing them one at a time from guesses.

NAMES
Eazfuscator's identifiers are private-use characters:
    U+E000 followed by '3'   -> the container class
    U+E002 followed by mark  -> the float lookup
    U+E000 followed by mark  -> the int lookup
so the patterns are matched on the actual code points, not on escape sequences.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
EV = ROOT / "evidence"

# THE FILE HOLDS THE ESCAPE AS LITERAL TEXT, not the characters themselves.
#
# The decompiler wrote `\ue0003.\ue002(161)` as nine ASCII characters plus a call, so matching on
# real U+E000 code points resolved nothing at all -- the first run reported 0 replacements against a
# 1.9 MB source. The patterns therefore match the backslash-u TEXT, which is why they are raw
# strings with doubled backslashes.
FLOAT_PATTERN = r"\\ue0003\.\\ue002\((\d+)\)"     # float lookup
INT_PATTERN = r"\\ue0003\.\\ue000\((\d+)\)"       # int lookup (same prefix, no digit)
# The double pool is a THIRD lookup. Missing it left 63 references behind, all of them on the
# erosion wrappers' tuning values, which is exactly the code where a wrong number looks plausible.
DOUBLE_PATTERN = r"\\ue0003\.\\ue003\((\d+)\)"     # double lookup
# `\ue004(...)` is a method (an array copy), not a constant, so it is deliberately not replaced.


def load(name, fallback_note=""):
    p = EV / name
    if not p.is_file():
        print(f"  missing {p.name} {fallback_note}")
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def fmt(v):
    """Render a number the way C# source would, without pretending to more precision."""
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e15:
            return f"{int(v)}.0"
        return repr(round(v, 10))
    return str(v)


def main() -> int:
    floats = load("pool_Gaea.Nodes_float.json")
    ints = load("pool_Gaea.Nodes_int.json")
    doubles = load("pool_Gaea.Nodes_double.json")
    if floats is None or ints is None:
        return 1

    src_path = EV / "decompiled" / "Gaea.Nodes.whole.cs"
    src = src_path.read_text(encoding="utf-8", errors="replace")
    print(f"  source: {src_path.name}  ({len(src):,} chars)")

    stats = {"float": 0, "int": 0, "double": 0, "unresolved": 0}
    unresolved = []

    # ---- float / double lookups: \ue0003.\ue002(N) --------------------------------
    pat_f = re.compile(FLOAT_PATTERN)
    # ---- int lookups: \ue0003.\ue000(N) -----------------------------------------
    pat_i = re.compile(INT_PATTERN)
    # ---- double lookups: \ue0003.\ue003(N) --------------------------------------
    pat_d = re.compile(DOUBLE_PATTERN)

    def sub_double(m):
        n = int(m.group(1))
        if doubles and n < len(doubles):
            stats["double"] += 1
            return fmt(doubles[n])
        stats["unresolved"] += 1
        unresolved.append(("double", n))
        return m.group(0)

    def sub_float(m):
        n = int(m.group(1))
        if n < len(floats):
            stats["float"] += 1
            return fmt(floats[n]) + "f"
        if doubles and n < len(doubles):
            stats["double"] += 1
            return fmt(doubles[n])
        stats["unresolved"] += 1
        unresolved.append(("float", n))
        return m.group(0)

    def sub_int(m):
        n = int(m.group(1))
        if n < len(ints):
            stats["int"] += 1
            return fmt(ints[n])
        if floats and n < len(floats):
            # A handful of sites use the int lookup on a value that is actually a float constant in
            # the same pool; resolve rather than leave it.
            stats["float"] += 1
            return fmt(floats[n])
        stats["unresolved"] += 1
        unresolved.append(("int", n))
        return m.group(0)

    out = pat_f.sub(sub_float, src)
    out = pat_i.sub(sub_int, out)
    out = pat_d.sub(sub_double, out)

    dst = EV / "decompiled" / "Gaea.Nodes.resolved.cs"
    dst.write_text(out, encoding="utf-8")

    print("")
    print(f"  resolved floats : {stats['float']}")
    print(f"  resolved ints   : {stats['int']}")
    print(f"  resolved doubles: {stats['double']}")
    print(f"  unresolved      : {stats['unresolved']}")
    if unresolved:
        seen = {}
        for kind, n in unresolved:
            seen[(kind, n)] = seen.get((kind, n), 0) + 1
        print("  unresolved detail:")
        for (kind, n), c in sorted(seen.items())[:16]:
            print(f"    {kind}[{n}] x{c}")
    print("")
    print(f"  wrote {dst}  ({len(out):,} chars)")

    # A quick, concrete sample so the result is visible rather than asserted.
    m = re.search(r"internal static Map Shaper\(.*?\n\t\t\}", out, re.S)
    if m:
        body = m.group(0)
        print("")
        print("  ---- Profiles.Shaper, constants resolved ----")
        for line in body.splitlines()[:26]:
            print("    " + line.rstrip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
