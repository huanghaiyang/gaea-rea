#!/usr/bin/env python3
"""Extract ImageMagick's ordered-dither threshold maps into web-usable JSON.

THE SHAPE, which the first parser missed
ImageMagick's `thresholds.xml` does not use `name="..."`. It uses `map="..."`, with the human
label in a nested `<description>` and the actual data as a NUMERIC MATRIX inside `<levels>`:

    <threshold map="checks" alias="2x1">
      <description>Checkerboard 2x1 (dither)</description>
      <levels width="2" height="2" divisor="3">
        1 2
        2 1
      </levels>
    </threshold>

So the useful payload is `{map, alias, width, height, divisor, cells[]}`, and the matrix is what a
renderer needs to reproduce the dither. The first version looked for a `name` attribute, found
none, and silently produced nothing -- a parser that reports zero should be treated as suspect
rather than as a finding, which is why the count is printed.

`colors.xml` genuinely holds only NINE active colours: ImageMagick ships the named-colour table
mostly commented out, and Gaea's copy is unmodified. The nine it does carry are extracted as they
are; the low count is the file's content, not a parser failure.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

GAEA = pathlib.Path(r"D:\Gaea 2")
ASSETS = pathlib.Path(__file__).resolve().parent.parent / "web" / "assets"


def extract_thresholds(src: pathlib.Path) -> dict:
    text = src.read_text(encoding="utf-8", errors="replace")
    out = {}
    for m in re.finditer(r"<threshold\b([^>]*)>(.*?)</threshold>", text, re.S):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        inner = m.group(2)
        name = attrs.get("map")
        if not name:
            continue
        desc = re.search(r"<description>\s*(.*?)\s*</description>", inner, re.S)
        lv = re.search(r"<levels\b([^>]*)>(.*?)</levels>", inner, re.S)
        entry: dict = {
            "map": name,
            "alias": attrs.get("alias"),
            "description": desc.group(1).strip() if desc else None,
        }
        if lv:
            lattrs = dict(re.findall(r'(\w+)="([^"]*)"', lv.group(1)))
            width = int(lattrs.get("width", 0) or 0)
            height = int(lattrs.get("height", 0) or 0)
            nums = [int(n) for n in re.findall(r"-?\d+", lv.group(2))]
            entry.update({
                "width": width,
                "height": height,
                "divisor": int(lattrs.get("divisor", 1) or 1),
                "cells": nums,
            })
        out[name] = entry
    return out


def extract_colors(src: pathlib.Path) -> dict:
    """Active `<color>` elements only. Commented-out ones are ImageMagick's template."""
    text = src.read_text(encoding="utf-8", errors="replace")
    # Strip comments first, so the template's commented entries are not counted as data.
    stripped = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    out = {}
    for m in re.finditer(r"<color\b([^>]*)/?>", stripped):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        name = attrs.get("name")
        if name:
            out[name] = attrs
    return out


def main() -> int:
    mag = GAEA / "Resources" / "Magick"
    if not mag.exists():
        print(f"  !! {mag} not found")
        return 1
    (ASSETS / "magick").mkdir(parents=True, exist_ok=True)

    th = extract_thresholds(mag / "thresholds.xml")
    if not th:
        print("  !! thresholds: nothing extracted, which means the parser is wrong -- not that")
        print("     the file is empty. It holds 22 <threshold> elements.")
        return 1
    (ASSETS / "magick" / "thresholds.json").write_text(
        json.dumps({"count": len(th), "thresholds": th}, indent=2) + "\n", encoding="utf-8")
    print(f"  thresholds        {len(th):>3} ordered-dither maps")
    # A summary of the matrix shapes, so the extraction is checkable at a glance.
    shapes = sorted({(e.get("width"), e.get("height")) for e in th.values() if e.get("width")})
    print(f"                    matrix sizes: {', '.join(f'{w}x{h}' for w, h in shapes)}")
    for name in list(th)[:3]:
        e = th[name]
        print(f"                    {name:<12} {e.get('width')}x{e.get('height')} "
              f"div {e.get('divisor')}  cells {e.get('cells')}")

    col = extract_colors(mag / "colors.xml")
    (ASSETS / "magick" / "colors.json").write_text(
        json.dumps({"count": len(col), "colors": col}, indent=2) + "\n", encoding="utf-8")
    print(f"  colors            {len(col):>3} active named colours")
    print("                    (the rest of ImageMagick's table ships commented out;")
    print("                     the low count is the file's content, not a parse failure)")

    total = sum(f.stat().st_size for f in ASSETS.rglob("*") if f.is_file())
    print(f"\n  web/assets total: {total / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
