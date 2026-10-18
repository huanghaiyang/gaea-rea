#!/usr/bin/env python3
"""Read the Material assets, so the shader variant the viewport actually uses is known.

WHY THIS COMES BEFORE MODIFYING ANYTHING
`Gaea/Tessellation` carries 28 `ps_4_0` variants. They differ by keyword -- forward vs deferred,
shadows on and off, a 3D-LUT colour path behind `if cb3[0].x == 1`, and so on. Copying the first
variant into the web renderer would be copying a path the viewport may never take. Unity records
the enabled keywords on each Material, so the question is answerable from data rather than by
guessing which of 28 branches matters.

Also dumps every Texture3D and Texture2D the materials reference: the 3D texture bound to `t1` is
the colour lookup itself, and it is the actual colour-mapping data rather than a shader branch.
"""
import json
import pathlib
import sys

sys.path.insert(0, r"D:\tools\UnityPy")
import UnityPy  # noqa: E402

BUNDLE = r"D:\Gaea 2\Gaea.Viewport_Data\data.unity3d"
OUT = pathlib.Path(r"D:\sgames\gaea-rea\evidence\unity-shaders")

env = UnityPy.load(BUNDLE)

# path_id -> name, so a PPtr can be resolved to the shader it points at.
names = {}
types = {}
for o in env.objects:
    try:
        d = o.read()
    except Exception:
        continue
    names[o.path_id] = getattr(d, "m_Name", "") or ""
    types[o.path_id] = o.type.name

report = {"materials": [], "textures3d": [], "textures2d": []}

# ---- Materials -------------------------------------------------------------------
for o in env.objects:
    if o.type.name != "Material":
        continue
    d = o.read()
    kw = getattr(d, "m_ShaderKeywords", "") or getattr(d, "m_ValidKeywords", "")
    if isinstance(kw, (list, tuple)):
        kw = " ".join(str(x) for x in kw)
    shader_pptr = getattr(d, "m_Shader", None)
    shader_name = ""
    file_id = 0
    if shader_pptr is not None:
        file_id = getattr(shader_pptr, "m_FileID", 0)
        path_id = getattr(shader_pptr, "m_PathID", 0)
        # A PPtr carries a FileID: 0 means "this file", anything else means an external bundle.
        # Ignoring it resolved cross-file pointers against this file's path ids and produced shader
        # names like `DebugUIFloatField` and `Checkmark`, which are MonoBehaviour class names --
        # a wrong answer that looked plausible.
        shader_name = names.get(path_id, f"<unresolved {path_id}>") if file_id == 0 else f"<external file {file_id}>"
    # Saved properties hold the texture bindings by name.
    saved = getattr(d, "m_SavedProperties", None)
    tex_envs = []
    if saved is not None:
        texs = getattr(saved, "m_TexEnvs", None) or []
        for entry in texs:
            try:
                key = entry[0] if isinstance(entry, (list, tuple)) else getattr(entry, "first", "")
                val = entry[1] if isinstance(entry, (list, tuple)) else getattr(entry, "second", None)
                tex = getattr(val, "m_Texture", None)
                tid = getattr(tex, "m_PathID", 0) if tex is not None else 0
                tex_envs.append({"slot": str(key), "texture": names.get(tid, ""), "path_id": tid})
            except Exception:
                continue
    report["materials"].append({
        "name": getattr(d, "m_Name", ""), "shader": shader_name,
        "keywords": str(kw), "textures": tex_envs,
    })

# ---- Textures --------------------------------------------------------------------
for o in env.objects:
    if o.type.name not in ("Texture3D", "Texture2D"):
        continue
    d = o.read()
    w = int(getattr(d, "m_Width", 0) or 0)
    h = int(getattr(d, "m_Height", 0) or 0)
    dep = int(getattr(d, "m_Depth", 0) or 0)
    fmt = getattr(d, "m_TextureFormat", None)
    rec = {"name": getattr(d, "m_Name", ""), "w": w, "h": h, "depth": dep, "format": str(fmt)}
    if o.type.name == "Texture3D":
        report["textures3d"].append(rec)
    else:
        report["textures2d"].append(rec)

print("  materials:")
for m in report["materials"]:
    print(f"    {m['name']!r}")
    print(f"      shader   {m['shader']}")
    print(f"      keywords {m['keywords'] or '(none)'}")
    for t in m["textures"]:
        if t["texture"]:
            print(f"      tex      {t['slot']} -> {t['texture']}")

print("")
print(f"  Texture3D: {len(report['textures3d'])}")
for t in report["textures3d"]:
    print(f"    {t['name']!r}  {t['w']}x{t['h']}x{t['depth']}  fmt={t['format']}")
print(f"  Texture2D: {len(report['textures2d'])}")
for t in report["textures2d"][:24]:
    print(f"    {t['name']!r}  {t['w']}x{t['h']}  fmt={t['format']}")

(OUT / "materials.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
print("")
print(f"  wrote {OUT / 'materials.json'}")
