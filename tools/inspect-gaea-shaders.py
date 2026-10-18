#!/usr/bin/env python3
"""Show Gaea's own shaders and the real container Unity wraps their bytecode in.

The first pass reported `language: unknown` for every blob because `classify()` inspected the first
four bytes of the DECOMPRESSED PLATFORM PAYLOAD -- and that payload is not bare DXBC. Unity's baked
shader format puts its own header in front of the compiled programs, so the magic has to be looked
for inside, not at offset zero.
"""
import json
import pathlib

ROOT = pathlib.Path(r"D:\sgames\gaea-rea\evidence\unity-shaders")
inv = json.loads((ROOT / "inventory.json").read_text(encoding="utf-8"))

TARGETS = ["Gaea/Tessellation", "Custom/UnlitTerrain", "ClipPlane",
           "sHTiF/AdvancedHandleShader", "Nature/Terrain/Standard"]

print("  Gaea's own shaders:")
for s in inv["shaders"]:
    if s["name"] not in TARGETS:
        continue
    print(f"    {s['name']}   path_id={s['path_id']}  subshaders={s['subshaders']}")
    for p in s["platforms"]:
        print(f"        {p['api']:8} {p['bytes']:>9,} B   stages={p['stages']}")
    for v in s["variants"][:8]:
        pn = (v.get("pass_name") or "")[:44]
        en = (v.get("entry") or "")[:34]
        print(f"          sub{v['subshader']} pass{v['pass']}  name={pn!r}  entry={en!r}")
    print("")

# What the payload actually starts with, and where the real magic is.
print("  payload forensics:")
for f in sorted((ROOT / "blobs").glob("*.bin")):
    if not any(t.split("/")[-1] in f.name for t in TARGETS):
        continue
    b = f.read_bytes()
    marks = {}
    for magic, label in ((b"DXBC", "DXBC"), (b"\x03\x02\x23\x07", "SPIR-V"),
                         (b"DXIL", "DXIL"), (b"\xfe\xff", "raw DXBC")):
        i = b.find(magic)
        if i >= 0:
            marks[label] = i
    print(f"    {f.name}")
    print(f"      {len(b):,} B   head={b[:16].hex()}")
    print(f"      magic offsets: {marks or 'none found'}")
