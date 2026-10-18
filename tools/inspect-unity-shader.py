#!/usr/bin/env python3
"""Dump the real field layout of a Shader object as UnityPy 1.25.4 exposes it.

The first extraction attempt guessed the blob path as
`m_ParsedForm.m_SubShaders[].m_Passes[].m_SubPrograms[].m_Blob` and found nothing, and `m_Name`
came back as "?" -- the guesses were wrong for this version. Rather than guess again, this prints
what the objects actually have.
"""
import pathlib
import sys

sys.path.insert(0, r"D:\tools\UnityPy")
import UnityPy  # noqa: E402

BUNDLE = r"D:\Gaea 2\Gaea.Viewport_Data\data.unity3d"

env = UnityPy.load(BUNDLE)
print(f"  objects: {len(env.objects)}")

# Type census first, so the interesting types are visible rather than assumed.
from collections import Counter  # noqa: E402
census = Counter(o.type.name for o in env.objects)
print("  type census:")
for t, n in census.most_common(18):
    print(f"    {n:5d}  {t}")

shaders = [o for o in env.objects if o.type.name == "Shader"]
print(f"\n  shaders: {len(shaders)}")
if not shaders:
    sys.exit(0)

obj = shaders[0]
print(f"\n  first shader object: type={obj.type.name} path_id={getattr(obj, 'path_id', '?')}")
data = obj.read()
print(f"  read() -> {type(data).__name__}")

# Every attribute the object actually carries, with a short rendering of each.
attrs = [a for a in dir(data) if not a.startswith("__")]
print(f"  attributes ({len(attrs)}):")
for a in sorted(attrs):
    try:
        v = getattr(data, a)
    except Exception as exc:
        print(f"    {a:26} <raises {type(exc).__name__}>")
        continue
    if callable(v):
        continue
    r = repr(v)
    print(f"    {a:26} {type(v).__name__:18} {r[:96]}")

# The fields that matter, probed by the names UnityPy actually exposes.
print("\n  blob hunt:")
for key in ("m_Name", "m_Script", "m_SubPrograms", "m_ParsedForm", "m_ShaderIsBaked", "m_PathName"):
    v = getattr(data, key, "<absent>")
    if isinstance(v, (list, tuple)):
        print(f"    {key}: {type(v).__name__}[{len(v)}]")
    else:
        print(f"    {key}: {repr(v)[:90]}")
