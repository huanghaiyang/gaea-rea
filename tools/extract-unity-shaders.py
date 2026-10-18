#!/usr/bin/env python3
"""Extract Gaea's baked Unity shaders with the field layout UnityPy actually exposes.

THE STRUCTURE, read off a real object rather than guessed
    m_ShaderIsBaked        True                     the bytecode is in compressedBlob
    m_Name                 ''                       NOT the name; it lives in m_ParsedForm.m_Name
    m_ParsedForm           SerializedShader         -> .m_Name, .m_SubShaders[]
    platforms              [4, 18]                  GraphicsDeviceType: D3D11, Vulkan
    stageCounts            [2, 1]                   per platform: stages in the blob
    compressedBlob         [...]                    all platforms concatenated
    compressedLengths      [[4471], [12592]]        per platform, per block
    decompressedLengths    [[38168], [41388]]
    offsets                [[0], [4471]]

WHY THIS IS WORTH DOING
Vulkan (18) means the bundle carries SPIR-V, which is an SSA intermediate representation with named
entry points and intact type information -- far more analysable than DXIL, and much closer to
readable than D3D11 DXBC. D3D11 (4) is present too, so the two can be cross-checked against each
other, which is the strongest evidence available without running the game.

Output:
    inventory.json                  every shader with its subshaders, keywords and per-platform sizes
    blobs/<shader>__<api>.bin       the decompressed bytecode, one file per platform
"""
import json
import lz4.block
import pathlib
import struct
import sys

sys.path.insert(0, r"D:\tools\UnityPy")
import UnityPy  # noqa: E402

BUNDLE = r"D:\Gaea 2\Gaea.Viewport_Data\data.unity3d"
OUT = pathlib.Path(r"D:\sgames\gaea-rea\evidence\unity-shaders")

# Unity's GraphicsDeviceType, reduced to the ones this bundle uses.
GFX = {
    2: ("D3D9", "dxbc"),
    4: ("D3D11", "dxbc"),
    13: ("D3D12", "dxil"),
    18: ("Vulkan", "spirv"),
    21: ("Metal", "metal"),
}


def classify(blob: bytes) -> dict:
    """Identify the shading language from the bytecode's own magic."""
    head = blob[:4]
    if head == b"DXBC":
        dxil = b"DXIL" in blob[:4096]
        return {"container": "DXBC", "language": "DXIL" if dxil else "DXBC",
                "note": "LLVM bitcode, hard to lift" if dxil else "D3D11 bytecode, liftable"}
    if head == b"\x03\x02\x23\x07":
        return {"container": "SPIR-V", "language": "SPIR-V", "note": "SSA IR, most analysable"}
    # Shader model 4/5 bytecode sometimes appears bare, starting with 0xFFFE.....
    if head[:2] == b"\xfe\xff":
        return {"container": "raw DXBC", "language": "DXBC", "note": "no container header"}
    return {"container": head.hex(), "language": "unknown", "note": ""}


def subprogram_names(parsed) -> list:
    """Pass and program names, which carry the keyword variants."""
    out = []
    for si, sub in enumerate(getattr(parsed, "m_SubShaders", []) or []):
        for pi, p in enumerate(getattr(sub, "m_Passes", []) or []):
            pn = getattr(p, "m_Name", "") or ""
            state = getattr(p, "m_State", None)
            # The fragment/vertex entry names live on the state object.
            entry = ""
            for attr in ("m_ProgramID", "m_Name"):
                v = getattr(state, attr, None) if state is not None else None
                if isinstance(v, str) and v:
                    entry = v
                    break
            out.append({"subshader": si, "pass": pi, "pass_name": pn, "entry": entry})
    return out


def main() -> int:
    bundle = pathlib.Path(BUNDLE)
    env = UnityPy.load(str(bundle))
    shaders = [o for o in env.objects if o.type.name == "Shader"]
    print(f"  bundle: {bundle.name}  objects={len(env.objects)}  shaders={len(shaders)}")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "blobs").mkdir(exist_ok=True)

    inventory = []
    for obj in shaders:
        data = obj.read()
        parsed = getattr(data, "m_ParsedForm", None)
        # THE NAME IS HERE, not on the Shader object (whose m_Name is empty).
        name = (getattr(parsed, "m_Name", "") or "").strip() or f"unnamed_{obj.path_id}"

        blob = bytes(getattr(data, "compressedBlob", b"") or b"")
        platforms = list(getattr(data, "platforms", []) or [])
        comp = list(getattr(data, "compressedLengths", []) or [])
        decomp = list(getattr(data, "decompressedLengths", []) or [])
        offsets = list(getattr(data, "offsets", []) or [])
        stages = list(getattr(data, "stageCounts", []) or [])

        entry = {
            "name": name,
            "path_id": obj.path_id,
            "subshaders": len(getattr(parsed, "m_SubShaders", []) or []),
            "variants": subprogram_names(parsed) if parsed is not None else [],
            "platforms": [],
        }

        for pi, plat in enumerate(platforms):
            api, kind = GFX.get(plat, (f"gfx{plat}", "?"))
            cblocks = comp[pi] if pi < len(comp) else []
            dblocks = decomp[pi] if pi < len(decomp) else []
            offs = offsets[pi] if pi < len(offsets) else []
            # Each platform is a run of LZ4 blocks; reassemble them in order.
            parts = []
            for bi, (cb, db) in enumerate(zip(cblocks, dblocks)):
                start = (offs[bi] if bi < len(offs) else sum(cblocks[:bi]))
                raw = blob[start:start + cb]
                try:
                    parts.append(lz4.block.decompress(bytes(raw), uncompressed_size=db))
                except Exception as exc:
                    parts.append(b"")
                    entry.setdefault("errors", []).append(f"{api} block {bi}: {exc}")
            payload = b"".join(parts)
            info = classify(payload) if payload else {"container": "-", "language": "-", "note": "empty"}

            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:70]
            fn = OUT / "blobs" / f"{safe}__{api}.bin"
            if payload:
                fn.write_bytes(payload)

            entry["platforms"].append({
                "gfx": plat, "api": api, "stages": stages[pi] if pi < len(stages) else None,
                "bytes": len(payload), "file": fn.name if payload else None, **info,
            })
        inventory.append(entry)

    # Print what decides the next step: which shader is the terrain one, and in what form.
    print("")
    print(f"  {'shader':44} {'sub':>4} {'platforms'}")
    print(f"  {'-'*44} {'-'*4} {'-'*40}")
    for e in inventory[:60]:
        plats = "  ".join(f"{p['api']}:{p['language']}:{p['bytes']}B" for p in e["platforms"])
        print(f"  {e['name'][:44]:44} {e['subshaders']:>4} {plats}")

    (OUT / "inventory.json").write_text(
        json.dumps({"bundle": str(bundle), "count": len(inventory), "shaders": inventory},
                   indent=2, ensure_ascii=False), encoding="utf-8")

    spirv = [e for e in inventory if any(p["language"] == "SPIR-V" for p in e["platforms"])]
    dxbc = [e for e in inventory if any(p["language"] == "DXBC" for p in e["platforms"])]
    print("")
    print(f"  shaders with SPIR-V : {len(spirv)}")
    print(f"  shaders with DXBC   : {len(dxbc)}")
    print(f"  wrote {OUT / 'inventory.json'}")
    print(f"  wrote {OUT / 'blobs'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
