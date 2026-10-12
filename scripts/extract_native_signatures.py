#!/usr/bin/env python3
"""Extract structured kernel signatures from demangled native symbols.

Reads evidence/kernels/symbols/*.demangled.tsv and writes
evidence/kernels/native-symbols.json plus a stdin-friendly summary.

Every record is observed data: the string came from the shipped DLL's
symbol/string table and was demangled by dbghelp!UnDecorateSymbolName.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

WS = r"D:\sgames\gaea-rea"
SYM = os.path.join(WS, "evidence", "kernels", "symbols")
OUT = os.path.join(WS, "evidence", "kernels", "native-symbols.json")

FQ = re.compile(r"([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_~][A-Za-z0-9_]*)+)\s*\(")
BUF = re.compile(
    r"(?:sycl::_V1::)?buffer<\s*(?P<elem>.*?)\s*,\s*(?P<dim>\d+)\s*,"
)
ITEM = re.compile(r"(?:sycl::_V1::)?(?:nd_)?item<\s*(?P<dims>\d+)\s*,\s*(?P<off>\d+)\s*>")
VEC = re.compile(r"vec<\s*(?P<t>[A-Za-z_][A-Za-z0-9_]*)\s*,\s*(?P<n>\d+)\s*>")

NOISE = re.compile(
    r"^(?:\?\?\s*)?(?:`[^`]*`\s*)*"
)


def balanced_args(s, start):
    """s[start] == '(' ; return arg text inside balanced parens or None."""
    depth = 0
    for i in range(start, len(s)):
        ch = s[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return s[start + 1 : i]
    return None


def split_args(argtext):
    """Split on top-level commas."""
    out, depth, cur = [], 0, []
    for ch in argtext:
        if ch in "<([{":
            depth += 1
        elif ch in ">)]}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if cur:
        out.append("".join(cur).strip())
    return [a for a in out if a]


def simplify(t):
    """Shorten a demangled parameter type for readability."""
    t = t.replace("class ", "").replace("struct ", "").replace("enum ", "")
    t = t.replace("sycl::_V1::detail::aligned_allocator<", "alloc<")
    t = re.sub(r",alloc<[^>]*>,void>", ",D>", t)
    t = t.replace("sycl::_V1::", "sycl::")
    t = t.replace(" __ptr64", "").replace(" const &", " const&")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def main():
    result = {"source": "dbghelp!UnDecorateSymbolName over ASCII symbol table of shipped DLLs",
              "dlls": {}}
    for fn in sorted(os.listdir(SYM)):
        if not fn.endswith(".demangled.tsv"):
            continue
        dll = fn[: -len(".demangled.tsv")]
        sigs = {}
        ns_census = Counter()
        for line in open(os.path.join(SYM, fn), encoding="utf-8"):
            line = line.rstrip("\n")
            if "\t" not in line:
                continue
            mangled, demo = line.split("\t", 1)
            for m in FQ.finditer(demo):
                fq = m.group(1)
                parts = fq.split("::")
                if parts[0] in ("std", "sycl", "hipsycl", "detail", "boost"):
                    continue
                ns_census[parts[0]] += 1
                if len(parts) < 2:
                    continue
                args = balanced_args(demo, m.end() - 1)
                if args is None:
                    continue
                key = "::".join(parts[1:]) + "(" + str(len(split_args(args))) + ")"
                entry = sigs.setdefault(
                    "::".join(parts[1:]),
                    {"namespace": parts[0], "class": "::".join(parts[1:-1]),
                     "method": parts[-1], "overloads": []},
                )
                if args not in [o["args"] for o in entry["overloads"]]:
                    entry["overloads"].append(
                        {"args": simplify(args),
                         "params": [simplify(a) for a in split_args(args)]}
                    )
        # dedupe overloads (identical demangled signatures repeat across the
        # many symbol-table fragments that contain each name)
        for name, e in sigs.items():
            seen, uniq = set(), []
            for o in e["overloads"]:
                if o["args"] in seen:
                    continue
                seen.add(o["args"])
                uniq.append(o)
            e["overloads"] = uniq

        # buffer/item/vec profile per method
        for name, e in sigs.items():
            dims, elems, items, vecs = set(), set(), set(), set()
            for o in e["overloads"]:
                for a in o["params"]:
                    for b in BUF.finditer(a):
                        elems.add(simplify(b.group("elem")))
                        dims.add(int(b.group("dim")))
                    for it in ITEM.finditer(a):
                        items.add("%sD" % it.group("dims"))
                    for v in VEC.finditer(a):
                        vecs.add("%s%s" % (v.group("t"), v.group("n")))
                for it in ITEM.finditer(" ".join(o["params"])):
                    items.add("%sD" % it.group("dims"))
            e["bufferElementTypes"] = sorted(elems)
            e["bufferDims"] = sorted(dims)
            e["syclItems"] = sorted(items)
            e["vectorTypes"] = sorted(vecs)
        result["dlls"][dll] = {
            "namespaces": dict(ns_census.most_common()),
            "methods": dict(sorted(sigs.items())),
        }
        print("%-26s ns=%-3d methods=%d" % (dll, len(ns_census), len(sigs)), flush=True)

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=1, sort_keys=True)
    print("wrote", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
