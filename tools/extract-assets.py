#!/usr/bin/env python3
"""Extract Gaea's material and colour data into web-usable assets.

WHAT IS IN THE INSTALLATION
    Resources/Color/*.clut        8 files, ~3 MB   the CLUTer node's grading tables
    Resources/Overlays/*.png      8 files, ~1 MB   overlay textures
    Resources/Magick/*.xml        20 ordered-dither maps, 9 commented-out colours

THE .clut FORMAT -- corrected in this revision
A little-endian uint32 row count, then `count` rows of **1536 bytes each**. Those 1536 bytes are
**512 RGB TRIPLES**, not 384 RGBA quads.

The first version of this script assumed RGBA, because 1536 divides evenly by 4 and the parse
therefore raised nothing. It produced eight PNGs that were structurally valid and visually wrong
-- a washed-out grey slab where a rock palette belonged -- because every pixel was reading its
channels from three different entries. **Looking at the output is what caught it.** A byte count
that divides evenly is not evidence that the stride is right.

Checked against the raw bytes: as RGB the leading values of `Rock.clut` are
`(36,32,20) (36,33,20) (37,35,21)`, which are rock browns; as RGBA they interleave into noise.
Every file's row width comes to exactly 1536, confirming 512 entries per row:

    14 x 1536 = 21504   Masks
    29 x 1536 = 44544   2D
    61 x 1536 = 93696   Color
   594 x 1536 = 912384  Rock

WHY THE CLUTs BECOME PNGs RATHER THAN JSON
A CLUT IS ALREADY AN IMAGE. Writing it as hex strings cost 10.5 MB for 3 MB of data. As a PNG the
browser decodes it with `createImageBitmap` and samples it with no parsing at all. Only a small
1D sample stays in JSON, for code that wants the default gradient without touching a texture.

The overlays are copied byte for byte rather than re-encoded.
"""
from __future__ import annotations

import json
import pathlib
import struct
import sys
import zlib

GAEA = pathlib.Path(r"D:\Gaea 2")
WS = pathlib.Path(__file__).resolve().parent.parent
ASSETS = WS / "web" / "assets"

ROW_BYTES = 1536
ENTRY_BYTES = 3          # RGB, NOT RGBA -- see the module docstring


def png_encode(width: int, height: int, rgba: bytes) -> bytes:
    """A minimal RGBA8 PNG encoder; `zlib` is the only dependency and it is in the stdlib."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)                                   # filter type 0 (None)
        raw += rgba[y * stride:(y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def parse_clut(path: pathlib.Path):
    """Return (rows, cols, rgba_bytes) for a .clut, or (None, reason) when it does not fit."""
    b = path.read_bytes()
    if len(b) < 4:
        return None, "shorter than its header"
    n = struct.unpack("<I", b[:4])[0]
    body = b[4:]
    if n == 0:
        return None, "zero rows"
    if len(body) % n:
        return None, f"{len(body)} bytes do not divide into {n} rows"
    per = len(body) // n
    if per % ENTRY_BYTES:
        return None, f"a row of {per} bytes is not a whole number of RGB triples"
    cols = per // ENTRY_BYTES
    # Expand to RGBA: the PNG needs four channels and these tables carry no alpha.
    rgba = bytearray(cols * n * 4)
    for i in range(cols * n):
        r, g, bl = body[i * 3], body[i * 3 + 1], body[i * 3 + 2]
        o = i * 4
        rgba[o] = r
        rgba[o + 1] = g
        rgba[o + 2] = bl
        rgba[o + 3] = 255
    return (n, cols, bytes(rgba)), None


def main() -> int:
    if not GAEA.exists():
        print(f"  !! {GAEA} not found")
        return 1
    for sub in ("color", "overlays", "magick"):
        (ASSETS / sub).mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------- CLUTs
    index = []
    for p in sorted((GAEA / "Resources" / "Color").glob("*.clut")):
        parsed, why = parse_clut(p)
        if parsed is None:
            print(f"  !! {p.name}: {why}")
            continue
        rows, cols, rgba = parsed
        dest = ASSETS / "color" / f"{p.stem}.png"
        dest.write_bytes(png_encode(cols, rows, rgba))

        mid = rows // 2
        off = mid * cols * 4
        sample = [f"#{rgba[off + c * 4]:02x}{rgba[off + c * 4 + 1]:02x}{rgba[off + c * 4 + 2]:02x}"
                  for c in range(cols)]
        (ASSETS / "color" / f"{p.stem}.1d.json").write_text(
            json.dumps({"name": p.stem, "cols": cols, "sample1d": sample},
                       separators=(",", ":")) + "\n", encoding="utf-8")

        index.append({
            "name": p.stem, "rows": rows, "cols": cols, "file": f"{p.stem}.png",
            "sampleFile": f"{p.stem}.1d.json", "channels": "rgb-expanded-to-rgba",
            "source": str(p.relative_to(GAEA)), "sourceBytes": p.stat().st_size,
            "pngBytes": dest.stat().st_size,
        })
        # The first RGB triple, printed so a wrong stride is visible in the log rather than only
        # in the image. Rock should be brown, Masks near-white.
        first = f"({rgba[0]},{rgba[1]},{rgba[2]})"
        print(f"  CLUT {p.stem:<8} {rows:>3} x {cols:<3}  first RGB {first:<14}"
              f" {p.stat().st_size:>8} B -> {dest.stat().st_size:>7} B")

    (ASSETS / "color" / "index.json").write_text(
        json.dumps({"count": len(index), "cluts": index}, indent=2) + "\n", encoding="utf-8")

    # ------------------------------------------------------------- overlays
    ov_index = []
    for p in sorted((GAEA / "Resources" / "Overlays").glob("*.png")):
        dest = ASSETS / "overlays" / p.name
        dest.write_bytes(p.read_bytes())
        ov_index.append({"name": p.stem, "file": p.name, "bytes": p.stat().st_size,
                         "source": str(p.relative_to(GAEA))})
    (ASSETS / "overlays" / "index.json").write_text(
        json.dumps({"count": len(ov_index), "overlays": ov_index}, indent=2) + "\n",
        encoding="utf-8")
    print(f"  overlays          {len(ov_index)} PNGs copied byte for byte")

    per_dir = {}
    for f in ASSETS.rglob("*"):
        if f.is_file():
            per_dir[f.parent.name] = per_dir.get(f.parent.name, 0) + f.stat().st_size
    print()
    print("  web/assets by directory:")
    for k in sorted(per_dir):
        print(f"    {k:<10} {per_dir[k] / 1024:>8.0f} KB")
    print(f"    {'TOTAL':<10} {sum(per_dir.values()) / 1024:>8.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
