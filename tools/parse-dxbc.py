#!/usr/bin/env python3
"""Parse the DXBC containers Unity baked into Gaea's viewport shaders.

WHAT IS ALREADY KNOWN
Unity's baked payload is a subprogram table, not bare bytecode:

    Custom_UnlitTerrain__D3D11.bin
      04 00 00 00 | 34 00 00 00 | 48 01 00 00   (count=4, offset=52, size=328)
      DXBC magic at offset 450

A DXBC container is:
    "DXBC" | 16-byte digest | u32 version | u32 totalSize | u32 chunkCount | u32 offsets[]
    then per chunk: fourCC + u32 size + payload

The chunks that answer "what does this shader actually do" before any disassembly:
    RDEF  constant buffers and bound resources, WITH THEIR NAMES
    ISGN  input signature: which vertex attributes arrive and in what register
    OSGN  output signature
    STAT  instruction counts, telling you how big the program really is
    SHDR  the token stream itself
"""
import pathlib
import struct

ROOT = pathlib.Path(r"D:\sgames\gaea-rea\evidence\unity-shaders\blobs")


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def parse_unity_table(b):
    """Unity's subprogram table: count, then (offset, size, reserved) per entry."""
    n = u32(b, 0)
    entries = []
    # The first entry's offset is also the end of the table, so the stride is derivable.
    off0 = u32(b, 4)
    stride = 12
    for i in range(n):
        o = 4 + i * stride
        if o + 12 > len(b):
            break
        entries.append({"offset": u32(b, o), "size": u32(b, o + 4), "extra": u32(b, o + 8)})
    return {"count": n, "table_end": off0, "entries": entries}


def parse_dxbc(b, at):
    if b[at:at + 4] != b"DXBC":
        return None
    total = u32(b, at + 24)
    nchunks = u32(b, at + 28)
    offsets = [u32(b, at + 32 + i * 4) for i in range(nchunks)]
    chunks = {}
    for off in offsets:
        p = at + off
        if p + 8 > len(b):
            continue
        fourcc = b[p:p + 4].decode("latin1")
        size = u32(b, p + 4)
        chunks[fourcc] = b[p + 8:p + 8 + size]
    return {"total": total, "chunk_count": nchunks, "chunks": chunks}


# --- RDEF -------------------------------------------------------------------
# Shader input/output register component types, from the D3D11 spec.
COMP = {0: "unknown", 1: "u32", 2: "s32", 3: "f32", 4: "f16"}
CLASS = {0: "scalar", 1: "vector", 2: "matrix_rows", 3: "matrix_columns", 4: "object",
         5: "struct", 6: "interface_class", 7: "interface_pointer"}
DIM = {0: "unknown", 1: "cbuffer", 2: "tbuffer", 3: "texture", 4: "sampler", 5: "uav_rwtyped",
       6: "structured", 7: "byteaddress"}
RET = {0: "unknown", 1: "void", 2: "bool", 3: "int", 4: "float", 5: "string", 6: "texture",
       7: "texture1d", 8: "texture2d", 9: "texture3d", 10: "texturecube"}


def cstr(b, o):
    e = b.find(b"\x00", o)
    return b[o:e].decode("latin1", "replace")


def parse_rdef(d):
    """Constant buffers (with variable names) and bound resources."""
    out = {"buffers": [], "resources": []}
    ncb = u32(d, 0)
    cb_off = u32(d, 4)
    nres = u32(d, 8)
    res_off = u32(d, 12)
    # version / creator strings sit between the header and the tables; not needed here.
    for i in range(ncb):
        o = cb_off + i * 24
        if o + 24 > len(d):
            break
        name_off = u32(d, o)
        nvars = u32(d, o + 8)
        vsize = u32(d, o + 12)
        var_off = u32(d, o + 16)
        buf = {"name": cstr(d, name_off), "vars": nvars, "bytes": vsize, "members": []}
        for vi in range(nvars):
            vo = var_off + vi * 24
            if vo + 24 > len(d):
                break
            no = u32(d, vo)
            vno = u32(d, vo + 4)
            start = u32(d, vo + 8)
            size = u32(d, vo + 12)
            base = 16 + start * 16
            buf["members"].append({
                "name": cstr(d, no), "offset": base, "size": size,
                "type": CLASS.get(u32(d, vo + 20), "?"),
            })
        out["buffers"].append(buf)
    for i in range(nres):
        o = res_off + i * 32
        if o + 32 > len(d):
            break
        no = u32(d, o)
        typ = u32(d, o + 12)
        bind = u32(d, o + 24)
        count = u32(d, o + 28)
        out["resources"].append({
            "name": cstr(d, no), "type": DIM.get(typ, str(typ)), "bind": bind, "count": count,
        })
    return out


def parse_signature(d):
    """Input/output signature: semantic name, index, register, and component type."""
    out = []
    count = u32(d, 0)
    for i in range(count):
        o = 8 + i * 24
        if o + 24 > len(d):
            break
        sem = cstr(d, u32(d, o))
        si = u32(d, o + 4)
        reg = u32(d, o + 8)
        mask = d[o + 12]
        comp = d[o + 16]
        out.append({"semantic": sem, "index": si, "register": reg,
                    "mask": bin(mask), "type": COMP.get(comp, str(comp))})
    return out


def parse_stat(d):
    if len(d) < 24:
        return None
    return {"instructions": u32(d, 4), "temp_registers": u32(d, 8),
            "defines": u32(d, 12), "declarations": u32(d, 16),
            "texture_normal": u32(d, 20)}


for f in sorted(ROOT.glob("*.bin")):
    if "UnlitTerrain" not in f.name and "ClipPlane" not in f.name:
        continue
    b = f.read_bytes()
    print("=" * 78)
    print(f"  {f.name}   ({len(b):,} bytes)")
    print("=" * 78)

    if "D3D11" not in f.name:
        print("    (Vulkan payload; the SPIR-V magic was not found in the previous pass)")
        print(f"    head: {b[:32].hex()}")
        continue

    tbl = parse_unity_table(b)
    print(f"  unity subprogram table: count={tbl['count']} table_end={tbl['table_end']}")
    for i, e in enumerate(tbl["entries"]):
        print(f"    [{i}] offset={e['offset']:>6} size={e['size']:>6} extra={e['extra']}")

    seen = set()
    for i, e in enumerate(tbl["entries"]):
        # THE DXBC CONTAINER IS NOT AT THE ENTRY OFFSET. Unity prefixes each subprogram with its own
        # record (magic `ba 75 0a 0c`), so the container starts somewhere inside the entry's range:
        # for Custom/UnlitTerrain the table says offset=380 while DXBC begins at 450. Scanning the
        # range is what makes this work; assuming the offset is the container start found nothing at
        # all, which is exactly how the first attempt failed silently.
        start = e["offset"]
        end = min(len(b), start + max(e["size"], 1))
        at = b.find(b"DXBC", start, end)
        if at < 0:
            continue
        off = at
        dx = parse_dxbc(b, off)
        if not dx:
            continue
        key = (off, dx["total"])
        if key in seen:
            continue
        seen.add(key)
        print("")
        print(f"  -- subprogram [{i}] at {off}: DXBC total={dx['total']} chunks={dx['chunk_count']}")
        for fourcc in sorted(dx["chunks"]):
            payload = dx["chunks"][fourcc]
            print(f"       {fourcc}  {len(payload):>7} bytes")

        if "RDEF" in dx["chunks"]:
            rdef = parse_rdef(dx["chunks"]["RDEF"])
            print("       constant buffers:")
            for buf in rdef["buffers"]:
                print(f"         {buf['name']!r}  {buf['bytes']} bytes, {buf['vars']} vars")
                for m in buf["members"]:
                    print(f"           +{m['offset']:<4} {m['name']:<34} {m['type']}")
            print("       bound resources:")
            for r in rdef["resources"]:
                print(f"         {r['type']:<9} bind={r['bind']:<3} count={r['count']:<3} {r['name']}")
        for sig in ("ISGN", "OSGN", "PSGN"):
            if sig in dx["chunks"]:
                entries = parse_signature(dx["chunks"][sig])
                print(f"       {sig}:")
                for s in entries:
                    print(f"         {s['semantic']}{s['index']} -> {s['register']} "
                          f"mask={s['mask']} {s['type']}")
        if "STAT" in dx["chunks"]:
            print(f"       STAT: {parse_stat(dx['chunks']['STAT'])}")
