#!/usr/bin/env python3
"""Recover readable Gaea kernel signatures from an extracted SPIR-V module.

SPIR-V produced by DPC++ keeps the C++ symbol names, so the mangled names inside a
module can be demangled back to real signatures. That is what turns
`_ZN16parallel_erosion15ParallelErosion11erode_levelEPNS_14LaplacianLevelE` into
`parallel_erosion::ParallelErosion::erode_level(parallel_erosion::LaplacianLevel*)`.

This is the payoff of the SPIR-V route: Gaea's own kernel API becomes readable symbols
instead of `FUN_xxxx`, and no machine-code disassembler is involved.

Demangling uses c++filt if present (Itanium ABI); otherwise the raw names are reported
rather than guessed at.
"""
from __future__ import annotations

import argparse
import pathlib
import re
import shutil
import subprocess
import sys
from collections import Counter

CXXFILT_CANDIDATES = [
    "c++filt",
    r"D:\msys64\mingw64\bin\c++filt.exe",
    "/usr/bin/c++filt",
]


def find_cxxfilt() -> str | None:
    for c in CXXFILT_CANDIDATES:
        p = shutil.which(c) if not c.startswith(("D:", "/")) else (c if pathlib.Path(c).is_file() else None)
        if p:
            return p
    return None


def demangle_all(names: list[str]) -> dict[str, str]:
    filt = find_cxxfilt()
    if not filt or not names:
        return {n: n for n in names}
    # One process for the whole batch; c++filt reads names on stdin.
    p = subprocess.run(
        [filt, "--no-strip-underscore"],
        input="\n".join(names),
        capture_output=True,
        text=True,
        errors="replace",
    )
    out = [l for l in p.stdout.splitlines() if l.strip()]
    if len(out) != len(names):
        # Line counts can differ if a name caused a parse error; fall back per-name.
        res = {}
        for n in names:
            q = subprocess.run([filt], input=n, capture_output=True, text=True, errors="replace")
            res[n] = q.stdout.strip() or n
        return res
    return dict(zip(names, out))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("module")
    ap.add_argument("--match", default=r"parallel_erosion|LaplacianLevel|Particle|thermal",
                    help="regex selecting which symbols to keep")
    ap.add_argument("--all", action="store_true", help="do not filter")
    args = ap.parse_args()

    path = pathlib.Path(args.module)
    raw = path.read_bytes()
    text = raw.decode("latin-1")

    names = sorted(set(re.findall(r"_Z[A-Za-z0-9_]+", text)))
    sel = re.compile(args.match)
    keep = names if args.all else [n for n in names if sel.search(n)]

    print(f"module           : {path.name}  ({len(raw):,} bytes)")
    print(f"mangled names    : {len(names)} total, {len(keep)} selected by /{args.match}/")
    print(f"demangler        : {find_cxxfilt() or 'NOT FOUND (names shown raw)'}")

    dm = demangle_all(keep)
    readable = sorted(set(dm.values()))

    # Group by leading namespace so the output is an API surface, not a wall of names.
    groups: dict[str, list[str]] = {}
    for r in readable:
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_:]*)", r)
        head = m.group(1) if m else r
        # group on the first two component namespaces
        parts = head.split("::")
        key = "::".join(parts[:2]) if len(parts) >= 2 else parts[0]
        groups.setdefault(key, []).append(r)

    print()
    for key in sorted(groups):
        rows = sorted(set(groups[key]))
        print(f"--- {key}  ({len(rows)})")
        for r in rows:
            # strip the long sycl/oneapi template noise for readability
            short = re.sub(r"sycl::_V1::detail::", "sycl::detail::", r)
            if len(short) > 200:
                short = short[:200] + " …"
            print(f"      {short}")
        print()

    # Which names appear most often is a rough hot-spot signal inside the module.
    counts = Counter(n for n in re.findall(r"_Z[A-Za-z0-9_]+", text) if sel.search(n))
    if counts:
        print("MOST-REFERENCED SELECTED SYMBOLS (occurrence count in the module)")
        for n, c in counts.most_common(15):
            print(f"  {c:>4}  {dm.get(n, n)[:150]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
