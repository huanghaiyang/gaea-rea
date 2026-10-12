#!/usr/bin/env python3
"""Generate docs/kernels-reference.md, docs/kernels-backends.md and
docs/kernels-node-mapping.md from the collected evidence.

Prose is authored here; every table is generated from
evidence/kernels/{fields-ordered.json,native-symbols.json,node-callsites.json,
obfuscated-field-decoding.json,metadata.json} so each statement stays traceable.
"""
import json
import os
import re
import sys
from collections import OrderedDict

WS = r"D:\sgames\gaea-rea"
EV = os.path.join(WS, "evidence", "kernels")
DOCS = os.path.join(WS, "docs")

ORDERED = json.load(open(os.path.join(EV, "fields-ordered.json"), encoding="utf-8"))
NSYM = json.load(open(os.path.join(EV, "native-symbols.json"), encoding="utf-8"))
CALLS = json.load(open(os.path.join(EV, "node-callsites.json"), encoding="utf-8"))
DEC = json.load(open(os.path.join(EV, "obfuscated-field-decoding.json"), encoding="utf-8"))
META = json.load(open(os.path.join(EV, "metadata.json"), encoding="utf-8"))
PUA = re.compile(r"[\ue000-\uf8ff]")
OBS = "observed"
INF = "inferred"


def esc(s):
    return "".join(c if ord(c) < 0xE000 else "\\u%04X" % ord(c) for c in s)


def split_field(raw):
    m = re.match(r"^(?P<t>[^\s]+(?:<[^>]*>)?(?:\[\]|\*|&)?)\s*(?P<n>.*)$", raw.strip())
    if not m:
        return raw.strip(), ""
    t, n = m.group("t"), m.group("n").strip()
    if t.count("<") != t.count(">"):
        return raw.strip(), ""
    return t, n


def params_fields(kernel):
    """Ordered fields of <kernel>.Parameters with decoded semantics."""
    tfn = "QuadSpinner.Gaea.Engine.SyclFunctions.%s.Parameters" % kernel
    rec = ORDERED["Gaea.Engine.dll"].get(tfn)
    if not rec:
        return None, None
    sem = {f["ordinal"]: f for f in DEC["structs"].get(kernel, {}).get("fields", [])}
    out = []
    for i, raw in enumerate(rec["fields"]):
        t, n = split_field(raw)
        obf = bool(PUA.search(n)) or not n
        s = sem.get(i + 1, {})
        out.append({
            "ordinal": i + 1, "type": t,
            "name": None if obf else n,
            "obf": obf,
            "tok": ("".join("U+%04X" % ord(c) for c in n) if (obf and n) else None),
            "semantics": s.get("observedSemantics", []),
        })
    return out, rec["methods"]


def wrapper_fields(asm, tfn):
    rec = ORDERED[asm].get(tfn)
    if not rec:
        return None, None
    out = []
    for i, raw in enumerate(rec["fields"]):
        t, n = split_field(raw)
        out.append({"ordinal": i + 1, "type": t, "name": n,
                    "obf": bool(PUA.search(n)) or not n})
    return out, rec["methods"]


def native_methods(ns_list, dlls=None):
    rows = []
    for dll, blob in NSYM["dlls"].items():
        if dlls and dll not in dlls:
            continue
        for name, m in sorted(blob["methods"].items()):
            if m["namespace"] not in ns_list:
                continue
            for o in m["overloads"]:
                rows.append((dll, m["namespace"], m["class"] or "-", m["method"],
                             o["args"], m["syclItems"], m["vectorTypes"]))
    return rows


def md_table(head, rows):
    out = ["| " + " | ".join(head) + " |",
           "|" + "|".join(["---"] * len(head)) + "|"]
    for r in rows:
        out.append("| " + " | ".join("" if c is None else str(c) for c in r) + " |")
    return "\n".join(out)


def short_args(a):
    a = a.replace("sycl::buffer<", "buf<").replace("sycl::_V1::", "sycl::")
    a = re.sub(r",alloc<[^>]*>,void>", "", a)
    a = a.replace("sycl::vec<", "vec<").replace(" __ptr64", "")
    a = a.replace("class ", "").replace("struct ", "")
    a = re.sub(r"\s+", " ", a)
    return a[:200]


# --------------------------------------------------------------------------
# reference document
# --------------------------------------------------------------------------
def build_reference():
    L = []
    A = L.append
    A("# Gaea 2.3.1 — kernel reference: parameter surfaces and algorithm signatures")
    A("")
    A("Targets: `D:\\Gaea 2` (Gaea 2.3.1). This document reconstructs the parameter "
      "surface and the algorithm signature of every terrain-generation kernel that is "
      "reachable from the shipped managed and C++/CLI assemblies.")
    A("")
    A("## 0. Method, evidence classes and what this document does NOT claim")
    A("")
    A("| layer | what was read | how |")
    A("|---|---|---|")
    A("| C++/CLI algorithm wrappers | field list with types, method signatures | "
      "`GaeaDump memb` (`System.Reflection.Metadata`) on `Gaea.CE/CS/CW/TS.dll` |")
    A("| managed SYCL bindings | `*.Parameters` struct field lists, kernel entry "
      "methods, delegate table | `GaeaDump memb` on `Gaea.Engine.dll` |")
    A("| native kernels | demangled C++ signatures, namespaces, buffer element types, "
      "SYCL dimensionality | ASCII symbol table + `dbghelp!UnDecorateSymbolName` on "
      "`Gaea.Native/oneAPI/AdaptiveCpp*.dll` |")
    A("| node → kernel binding | object-initializer assignments from node `Build()` "
      "methods | `evidence/decompiled/Gaea.Nodes.whole.cs` |")
    A("")
    A("**Evidence vocabulary.** `observed` = the token was read directly from metadata "
      "or from a demangled symbol / decompiled assignment. `inferred` = the physical "
      "meaning, tensor role or mathematical form is the analyst's interpretation of the "
      "observed parameter names and native signatures. This document never presents an "
      "inferred item as observed.")
    A("")
    A("**Not claimed, and not obtainable at this layer:**")
    A("")
    A("* numeric defaults, constant folding, iteration counts and loop bounds;")
    A("* the actual arithmetic inside any kernel (no kernel body, no IL for the native "
      "cores, no PDB, and the native DLLs were deliberately not disassembled);")
    A("* native struct byte offsets (managed metadata order is recorded, but the C++ "
      "struct layout was not read);")
    A("* runtime behaviour: nothing here was executed.")
    A("")
    A("### 0.1 Two families of kernels")
    A("")
    A("Gaea 2.3.1 exposes kernels through two independent, *overlapping* layers:")
    A("")
    A("1. **C++/CLI algorithm modules** — `Gaea.CE.dll`, `Gaea.CS.dll`, `Gaea.CW.dll`, "
      "`Gaea.TS.dll`. Each is a mixed-mode assembly containing exactly one "
      "`QuadSpinner.ErosionWrapper*` class whose fields are the full parameter block and "
      "whose `SetVars(...)` method is the authoritative *active* parameter list. These "
      "are the ones the erosion/snow/water/thermal-shaper helpers call directly.")
    A("2. **Managed SYCL bindings** — `QuadSpinner.Gaea.Engine.SyclFunctions.*` in "
      "`Gaea.Engine.dll`, one class + one nested `Parameters` struct per kernel, resolved "
      "into a backend DLL (`Gaea.oneAPI.dll` / `Gaea.AdaptiveCpp*.dll` / `Gaea.Native.dll`) "
      "at runtime.")
    A("")
    A("The two layers do not share a single parameter struct: `ParallelErosion.Parameters` "
      "(23 fields, SYCL layer) and `ErosionWrapper` (45 fields, C++/CLI layer) are "
      "different, differently-sized surfaces for the same algorithm family.")
    A("")

    # ---------- ParallelErosion --------------------------------------------
    A("---")
    A("")
    A("## 1. `ParallelErosion` — particle hydraulic erosion (the Erosion2/EasyErosion core)")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed entry | `QuadSpinner.Gaea.Engine.SyclFunctions.ParallelErosion.Simulation("
      "Parameters, ValueTuple inMaps, out ValueTuple outMaps) -> NativeResult` *(observed)* |")
    A("| native namespaces | `parallel_erosion` (all backends), `parallel_erosion2` "
      "(AdaptiveCpp only) |")
    A("| node entry point | `Erosions.PE(...)` *(observed, "
      "`evidence/decompiled/Gaea.Nodes.whole.cs:732`)* |")
    A("| consumes | `Erosion2`, `EasyErosion` |")
    A("")
    A("### 1.1 Managed parameter block (`ParallelErosion.Parameters`, 23 fields)")
    A("")
    A("Field order is metadata order; names are 3-code-point private-use-area tokens "
      "(deliberate renaming, not an encoding). The *semantics* column is `observed`: it "
      "is the expression that `Erosions.PE` assigns to that exact field. Type sequence "
      "`Resolution, float×6, int, float×14, bool` is consistent with that assignment "
      "order, which is what makes the join safe.")
    A("")
    fields, methods = params_fields("ParallelErosion")
    rows = []
    for f in fields:
        semv = "; ".join(esc(s) for s in f["semantics"]) or "_(not assigned in the available decompilation)_"
        rows.append([f["ordinal"], f["type"], "`%s`" % (f["name"] or f["tok"]), semv])
    A(md_table(["#", "type", "name / token", "observed node-facing semantics"], rows))
    A("")
    A("`QuadSpinner.Gaea.Engine.SyclFunctions.ParallelErosion` declares only its "
      "constructor; the operation itself is reached through the `Sycl.SyclFunctions` "
      "delegate field `ParallelErosionSimulation` *(observed)*.")
    A("")
    A("### 1.2 Native structure (`parallel_erosion::ParallelErosion`)")
    A("")
    rows = []
    for dll, ns, cls, meth, args, items, vecs in native_methods(["parallel_erosion", "parallel_erosion2"]):
        if dll != "Gaea.oneAPI.dll":
            continue
        rows.append([ns, cls, meth, short_args(args), ",".join(items) or "-"])
    A(md_table(["namespace", "class", "method", "parameter list (demangled)",
                "SYCL item"], rows))
    A("")
    A("Nested native types observed by name: `parallel_erosion::Particle` (element type of "
      "a 1-D `sycl::buffer<Particle,1>`), `parallel_erosion::LaplacianLevel` (with "
      "`create_subsequent_level`, `reconstruct`, `reconstruct_previous_level`), and the "
      "`shape<0>` / `shape<10>` template instantiations of `ParallelErosion`.")
    A("")
    A("### 1.3 Tensor I/O")
    A("")
    A("`observed` — from the demangled signatures and the managed binding:")
    A("")
    A("* input: 2-D `float` heightmap (plus optional 2-D mask) — `ValueTuple inMaps`, "
      "`Parameters.Resolution`;")
    A("* output: `ValueTuple outMaps` of five 2-D maps. `Erosions.PE` maps them to "
      "`height`, `wear`(=item2), `flow`(=item5) and `deposit`(=item3): "
      "`array2[0]=Item1 (height)`, `array2[1]=Item2`, `array2[3]=Item3`, "
      "`array2[2]=Item5` *(observed, Gaea.Nodes.whole.cs:802-807)*;")
    A("* internal particle state: 1-D buffers `buffer<Particle,1>` plus three "
      "`buffer<unsigned int,1>` (counters/indices) and a `sycl::range<1>` work size;")
    A("* flow rendering writes both 2-D `float` and 2-D `int` (accumulation) maps.")
    A("")
    A("`inferred` — tensor roles: `Item2` is a wear/erosion-amount field and the "
      "`buffer<int,2>` pair in `render_flow` are a flow-direction/accumulation pair "
      "(confidence: medium for the exact pairing, high for the map count).")
    A("")
    A("### 1.4 Standard mathematical form (inferred)")
    A("")
    A("The native surface is a **particle (droplet) hydraulic-erosion solver on a "
      "Laplacian pyramid**: `Particle` buffers, a seed-driven "
      "`create_random_directions(unsigned, int, queue) -> buffer<vec<float,2>,1>`, an "
      "`erode()` pass, a `flow()` pass and a `render_flow()` pass, driven level by level "
      "through `LaplacianLevel`.")
    A("")
    A("The canonical droplet model this signature matches (Beyer; Mei et al.): for each "
      "particle *p* with position `x ∈ R²`, velocity `v`, water `w` and sediment `s`:")
    A("")
    A("```text")
    A("v  <- normalize(sample_gradient(z, x)) * v + inertia * v      # advect downslope")
    A("x  <- x + dt * v")
    A("c  = capacity(x) * w * speed * sin(slope(x))                   # carrying capacity")
    A("if s < c:  z(x) -= K_e * (c - s);  s += K_e * (c - s)          # erode  (stream power)")
    A("else:      z(x) += K_d * (s - c);  s -= K_d * (s - c)          # deposit")
    A("w  <- (1 - evaporation) * w")
    A("```")
    A("")
    A("The parameter names in the managed struct line up with the **stream-power / "
      "sediment-discharge** family: `SuspendedLoadDischargeAmount|Angle`, "
      "`BedLoadDischargeAmount|Angle`, `CoarseSedimentsDischargeAmount|Angle`, "
      "`Downcutting`, `ErosionScale`, `DepositionBoost`, `ExtraDepositionBoost`, "
      "`NoErosion`, `Shape`, `ShapeSharpness`, `ShapeDetailScale`. The three "
      "*amount/angle* pairs are a size-fractionated sediment transport law (suspended / "
      "bed load / coarse), each with a slope-angle threshold — this is the "
      "\"discharge vs. angle\" curve of the coarse-grained Gaea erosion model. "
      "(confidence: high for the transport-law family, low for each exact mapping "
      "coefficient).")
    A("")
    A("The `LaplacianLevel` pyramid (fields `LaplacianLevel::create_subsequent_level`, "
      "`reconstruct`, `reconstruct_previous_level(Parameters const&, int)`) is `observed`; "
      "interpreting it as a multi-resolution (multigrid) erosion that erodes coarse "
      "levels first and reconstructs detail is `inferred` (confidence: high).")
    A("")
    A("### 1.5 Visibility limits")
    A("")
    A("* `parallel_erosion::Parameters` / `erode()` bodies were not read: iteration "
      "counts, the discharge-curve functional form, the pyramid depth and the "
      "termination rule are all unknown.")
    A("* The `shape<0>` / `shape<10>` instantiations are visible as names only; which "
      "grid/vector width they dispatch on is unknown.")
    A("* 3 of 23 field meanings (ordinals 5, 7, 10) have no observed node assignment.")
    A("")

    # ---------- Classic erosion (CE) ---------------------------------------
    A("---")
    A("")
    A("## 2. `QuadSpinner.ErosionWrapper` (`Gaea.CE.dll`) — \"Classic\" fluvial + thermal erosion")
    A("")
    A("`observed`: `Gaea.Nodes.whole.cs:696` instantiates `new ErosionWrapper()` inside "
      "`Erosions.Classic(...)`, which is called by the `Erosion` and `Wizard` nodes. "
      "`Simulations.Thermal(...)` (line 4771/4800) uses the same wrapper, i.e. the "
      "C++/CLI module carries *both* the fluvial and the thermal stage.")
    A("")
    A("### 2.1 Full field list (45 fields; every field name is readable)")
    A("")
    wf, wm = wrapper_fields("Gaea.CE.dll", "QuadSpinner.ErosionWrapper")
    meaning = {
        "results": ("output: eroded heightmap", "high"),
        "wear": ("output: wear / total eroded volume map", "high"),
        "deposit": ("output: deposited sediment map", "high"),
        "flow": ("output: flow / water map", "high"),
        "erosion": ("native core handle (`Erosion*`)", "high"),
        "heightmap": ("input heightmap (ref)", "high"),
        "mask": ("input area mask (ref)", "high"),
        "sediment_removal_mask": ("input sediment-removal mask (ref)", "high"),
        "ev": ("C++/CLI progress event bridge", "high"),
        "AbortCheck": ("cancellation delegate", "high"),
        "m_resolution": ("grid edge length N (square)", "high"),
        "m_seed": ("RNG seed", "high"),
        "m_size": ("terrain size in metres (`TerrainScale` is passed here)", "high"),
        "m_scale": ("erosion/feature scale (`FeatureScale` is passed here)", "high"),
        "m_duration": ("simulation duration", "high"),
        "m_rock_softness": ("rock softness; scales erodibility", "high"),
        "m_fluvial_erosion_strength": ("fluvial (stream-power) coefficient K", "medium"),
        "m_downcutting": ("vertical incision rate", "medium"),
        "m_base_level": ("base level below which incision stops", "medium"),
        "m_retardation_of_downcutting": ("downcutting inhibition (`Inhibition`)", "high"),
        "m_enable_thermal": ("enable the thermal (mass-wasting) stage", "high"),
        "m_thermal_erosion_strength": ("thermal diffusion rate", "high"),
        "m_thermal_rock_angle": ("rock angle used by the thermal model", "medium"),
        "m_talus_angle": ("talus / angle of repose", "high"),
        "m_thermal_size": ("thermal feature scale", "medium"),
        "m_flow_volume": ("water volume / discharge scale (`Volume`)", "high"),
        "m_mask_by_shader": ("use the mask input at all", "high"),
        "m_invert_mask": ("invert the mask", "high"),
        "m_masking_mode": ("masking mode selector (derived from `AreaEffect`)", "medium"),
        "m_mask_as_thermal_erosion_strength": ("reuse the mask as thermal strength", "medium"),
        "m_thermal_model": ("thermal model selector", "medium"),
        "m_rivers_mode": ("rivers/headwater carving mode", "medium"),
        "m_lakes": ("lake amount", "medium"),
        "m_rivers_depth": ("river incision depth", "medium"),
        "m_rivers_width": ("river channel width", "medium"),
        "m_headwaters_density": ("spring/headwater density", "medium"),
        "m_laminar_flow": ("laminar instead of turbulent flow", "medium"),
        "m_randomness": ("RNG amplitude for particle placement", "medium"),
        "m_threads": ("CPU thread count (not in `SetVars`)", "high"),
        "m_height_range": ("vertical range of the terrain (`Verticality`)", "high"),
        "m_talus_settling": ("thermal settling per iteration (`Settling`)", "medium"),
        "m_thermal_smoothness": ("thermal smoothing", "medium"),
        "m_debris_size": ("debris / boulder size", "medium"),
        "m_thermal_detail": ("thermal detail preservation", "medium"),
        "m_sediment_removal": ("sediment removal strength (`SedimentRemoval`)", "high"),
    }
    rows = []
    for f in wf:
        m, c = meaning.get(f["name"], ("—", "—"))
        rows.append([f["ordinal"], "`%s`" % f["name"], f["type"], m, c])
    A(md_table(["#", "field", "type", "inferred physical meaning", "confidence"], rows))
    A("")
    A("### 2.2 Active parameter list — `SetVars` (observed, authoritative)")
    A("")
    for m in (wm or []):
        if m.startswith("Void SetVars"):
            A("```text")
            A(m)
            A("```")
    A("")
    A("Two overloads exist; they differ only by the position of `sediment_removal`, so the "
      "module supports a build without the sediment-removal stage. `ErodeTerrain` also has "
      "two overloads (`(heightmap, mask, fixed)` and "
      "`(heightmap, mask, sediment_removal_mask, fixed)`) — both `observed`.")
    A("")
    A("The `Erosions.Classic` signature "
      "(`Duration, RockSoftness, Strength, Downcutting, Inhibition, BaseLevel, RealScale, "
      "FeatureScale, TerrainScale, Verticality, Debris, Volume, SedimentRemoval, "
      "AreaEffect, BiasType, Bias, ReverseBias, Seed, AggressiveMode, Deterministic, "
      "areaMask, srMask` — `observed`, line 691) maps positionally onto `SetVars` in the "
      "same order, which is what pins the meanings above.")
    A("")
    A("### 2.3 Standard mathematical form (inferred)")
    A("")
    A("```text")
    A("# fluvial stage: stream-power incision with sediment transport")
    A("dz/dt = -(K * A^m * S^n) * softness + deposition")
    A("downcutting ~ vertical lowering only; base_level clamps the incision floor;")
    A("retardation_of_downcutting damps dz/dt as the surface approaches base_level.")
    A("# thermal stage (enable_thermal): talus-angle mass wasting")
    A("for each cell i, for each neighbour j: if S_ij > talus_angle:")
    A("    move = k * (S_ij - talus_angle) * (z_j - z_i)")
    A("randomness jitters particle/flow placement; laminar_flow switches the")
    A("flow-accumulation to a non-turbulent (sheet) regime.")
    A("```")
    A("")
    A("`rivers_mode`, `headwaters_density`, `rivers_width`, `rivers_depth` and `lakes` "
      "indicate an *explicit channel-network* generator layered on the erosion stage "
      "(`inferred`, confidence medium).")
    A("")
    A("### 2.4 Visibility limits")
    A("")
    A("* `Gaea.CE.dll`'s native code is a mixed-mode C++ image without PDB: the actual "
      "incision/diffusion arithmetic and its constants are not recoverable here.")
    A("* `m_threads` is a field but is not settable through `SetVars`, so the threading "
      "policy is not visible from the managed surface.")
    A("* `m_masking_mode`, `m_thermal_model` are integer selectors whose enumerations are "
      "not declared in this assembly.")
    A("")

    # ---------- Snow (CS) ---------------------------------------------------
    A("---")
    A("")
    A("## 3. `QuadSpinner.ErosionWrapperS` (`Gaea.CS.dll`) — snow accumulation and melt")
    A("")
    A("`observed`: instantiated in `Simulations.Snow(...)` "
      "(`Gaea.Nodes.whole.cs:4568`, `SetVars` at 4567-4586), called by the `Snow`, "
      "`Snowfield`, `Shrubs` and `Trees` nodes. The letter `S` matches the snow field "
      "set; that expansion is `inferred`, the *role* is `observed`.")
    A("")
    A("### 3.1 Fields (49) — shared erosion block plus the snow block")
    A("")
    wf, wm = wrapper_fields("Gaea.CS.dll", "QuadSpinner.ErosionWrapperS")
    snow = {
        "snow": ("output: snow mask/depth map", "high"),
        "hardmask": ("output: hard snow mask", "high"),
        "softmask": ("output: soft/partial snow mask", "high"),
        "version": ("serialisation/parameter version selector", "medium"),
        "latestVersion": ("current parameter version constant", "medium"),
        "m_iduration": ("integer mirror of `m_duration` (cache key / hashing)", "medium"),
        "m_isnowfall_duration": ("integer mirror of `m_snowfall_duration`", "medium"),
        "m_ipost_snowfall_duration": ("integer mirror of `m_post_snowfall_duration`", "medium"),
        "m_duration": ("total simulation duration (`Duration`)", "high"),
        "m_snowfall_duration": ("length of the snowfall phase (`Duration`)", "high"),
        "m_snowfall_intensity": ("snowfall rate (`Intensity`)", "high"),
        "m_post_snowfall_duration": ("settle/thaw phase length (`SettleThaw`)", "high"),
        "m_melting": ("melt rate (`Melt`)", "high"),
        "m_snow_line": ("altitude of the snow line (`SnowLine`)", "high"),
        "m_snowfall_mask": ("use a supplied snowfall-area mask", "high"),
        "m_melt_mask": ("use a supplied melt-area mask", "high"),
        "m_snow_output": ("which snow product to return", "medium"),
        "m_size": ("terrain size (`RealScale`/`Scale`)", "high"),
        "m_scale": ("scale parameter", "medium"),
        "m_debris_size": ("debris size", "medium"),
    }
    rows = []
    for f in wf:
        m, c = snow.get(f["name"], meaning.get(f["name"], ("shared with `ErosionWrapper`", "medium")))
        rows.append([f["ordinal"], "`%s`" % f["name"], f["type"], m, c])
    A(md_table(["#", "field", "type", "inferred physical meaning", "confidence"], rows))
    A("")
    A("### 3.2 Active parameter list — `SetVars` (observed)")
    A("")
    for m in (wm or []):
        if m.startswith("Void SetVars"):
            A("```text")
            A(m)
            A("```")
    A("")
    A("`ErodeTerrain(Single[]& heightmap, Single[]& snowfall_area, Single[]& melt_area, "
      "Boolean fixed)` — **two auxiliary input maps and one snow output map**, which is "
      "the observable difference from `Gaea.CE.dll`.")
    A("")
    A("### 3.3 Tensor I/O")
    A("")
    A("`observed`: in = heightmap, snowfall-area mask, melt-area mask; out = "
      "`results` (height), `snow`, `hardmask`, `softmask`.")
    A("")
    A("### 3.4 Standard mathematical form (inferred)")
    A("")
    A("```text")
    A("# accumulation phase (snowfall_duration)")
    A("snow(x) += intensity * dt * snowfall_mask(x) * (z(x) > snow_line)")
    A("# settle / thaw phase (post_snowfall_duration)")
    A("snow(x) -= melt * dt * melt_mask(x) * temperature_proxy(z, snow_line)")
    A("# masked by hardness/softness -> hardmask / softmask outputs")
    A("```")
    A("A degree-day-style accumulation/ablation model is the standard form that matches "
      "the parameter names (`snowfall_duration/intensity`, `melting`, `snow_line`, "
      "`post_snowfall_duration`). `inferred`, confidence high for the family, low for the "
      "temperature proxy.")
    A("")

    # ---------- Water (CW) --------------------------------------------------
    A("---")
    A("")
    A("## 4. `QuadSpinner.ErosionWrapperW` (`Gaea.CW.dll`) — lakes / sea water level")
    A("")
    A("`observed`: instantiated in `Waters.Lakes(...)` (line 7095) and `Waters.Sea(...)` "
      "(line 7132); the node call sites include `Lake`, `Sea`, `Rivers`. The module "
      "exposes **two additional entry points that no other wrapper has**: "
      "`FloodFill(heightmap, x, y, level, fixed)` and "
      "`EdgeFill(heightmap, level, fixed, mask)`.")
    A("")
    A("### 4.1 Fields (20)")
    A("")
    wf, wm = wrapper_fields("Gaea.CW.dll", "QuadSpinner.ErosionWrapperW")
    water = {
        "results": ("output: terrain with water bodies filled", "high"),
        "depth": ("output: water depth map", "high"),
        "shore": ("output: shoreline / shore mask", "high"),
        "surface": ("output: water surface level map", "high"),
        "m_resolution": ("grid edge length", "high"),
        "m_size": ("terrain size", "high"),
        "m_scale": ("scale", "medium"),
        "m_shore_size": ("shore band width (`ShoreSize`)", "high"),
        "m_precipitation": ("precipitation amount (`Precipitation`)", "high"),
        "m_precipitation_amount": ("precipitation volume scaling", "medium"),
        "m_evaporation": ("evaporation rate", "medium"),
        "m_lake_size_bias": ("bias towards small vs. large lakes (`SmallLakes`)", "high"),
        "m_threads": ("CPU thread count", "high"),
        "m_precipitation_mask": ("use a supplied precipitation-area mask", "high"),
        "m_evaporation_mask": ("use a supplied evaporation-area mask", "high"),
        "m_height_range": ("vertical range of the terrain", "high"),
        "m_altitude_bias": ("altitude bias for lake formation (`AltitudeBias`)", "high"),
        "m_size_bias": ("size bias for lake formation (`SizeBias`)", "high"),
        "m_water_floor": ("floor level of the water body (`WaterFloor`)", "high"),
    }
    rows = []
    for f in wf:
        m, c = water.get(f["name"], ("—", "—"))
        rows.append([f["ordinal"], "`%s`" % f["name"], f["type"], m, c])
    A(md_table(["#", "field", "type", "inferred physical meaning", "confidence"], rows))
    A("")
    A("### 4.2 Active parameter list and entry points (observed)")
    A("")
    for m in (wm or []):
        A("```text")
        A(m)
        A("```")
    A("")
    A("### 4.3 Standard mathematical form (inferred)")
    A("")
    A("```text")
    A("# 1. depression filling (priority-flood, Barnes et al.)")
    A("fill each local minimum up to its lowest spill point -> surface map")
    A("# 2. lake level / spill-over")
    A("surface(x) = max(z(x), level);  water_floor clamps the minimum level;")
    A("altitude_bias and size_bias weight which depressions become lakes;")
    A("lake_size_bias favours many small or few large basins.")
    A("# 3. outputs")
    A("depth(x) = surface(x) - z(x);  shore(x) = depth < shore_size")
    A("```")
    A("`FloodFill(x, y, level)` is the seeded variant (fill from one seed cell) and "
    "`EdgeFill(level, mask)` the boundary-seeded variant (used by the `Sea` node, which "
    "fills from the terrain edge) — `inferred`, confidence high, based on the observed "
    "names and argument lists.")
    A("")

    # ---------- Thermal shaper (TS) ----------------------------------------
    A("---")
    A("")
    A("## 5. `QuadSpinner.ErosionWrapperTS` (`Gaea.TS.dll`) — thermal / profile shaping")
    A("")
    A("`observed`: instantiated in `Profiles.ThermalShaper(...)` "
      "(`Gaea.Nodes.whole.cs:3957`, `ErodeTerrain(ref heightmap)` at 3961).")
    A("")
    A("**Important negative finding:** the class declares 44 fields but its `SetVars` "
      "takes only `resolution, size, scale, duration, intensity`, and `ErodeTerrain` "
      "takes only the heightmap. The other 39 fields — including an entire copy of the "
      "`ErosionWrapper` fluvial/thermal block plus `m_talus_settling`, "
      "`m_thermal_smoothness`, `m_thermal_detail`, `m_debris_size`, "
      "`m_retardation_of_downcutting`, `m_sediment_removal`, `m_influence` — are "
      "therefore *declared but not reachable* from this module's own API "
      "(`observed`: the parameter list is the whole of what `SetVars` accepts).")
    A("")
    A("### 5.1 Fields — active vs. declared")
    A("")
    wf, wm = wrapper_fields("Gaea.TS.dll", "QuadSpinner.ErosionWrapperTS")
    setvars = {"m_resolution", "m_size", "m_scale", "m_duration", "m_intensity"}
    io = {"results", "ev", "AbortCheck", "erosion", "heightmap", "mask",
          "sediment_removal_mask"}
    rows = []
    for f in wf:
        if f["name"] in setvars:
            state = "**active parameter** (`SetVars`)"
        elif f["name"] in io:
            state = "active I/O field (used by `SetEvent`/`ErodeTerrain`/results)"
        else:
            state = "declared, not settable through this module's API"
        rows.append([f["ordinal"], "`%s`" % f["name"], f["type"], state])
    A(md_table(["#", "field", "type", "reachability from this module's API"], rows))
    A("")
    A("### 5.2 Entry points (observed)")
    A("")
    for m in (wm or []):
        A("```text")
        A(m)
        A("```")
    A("")
    A("The actual call is decisive (`observed`, `Gaea.Nodes.whole.cs:3954-3962`):")
    A("")
    A("```csharp")
    A("internal static Map ThermalShaper(Map map, float Influence = 1f, float Shape = 0.25f)")
    A("{")
    A("    ErosionWrapperTS w = new ErosionWrapperTS();")
    A("    w.SetVars(map.Resolution.X, <const>, <const>, <const>, Shape);  // intensity <- Shape")
    A("    float[] heightmap = map.ToArray();")
    A("    w.ErodeTerrain(ref heightmap);")
    A("    return ClassicCombiner.Combine(map.ToArray(), w.results, Influence, ...);")
    A("}")
    A("```")
    A("")
    A("So the kernel receives only `Shape` (as `intensity`) plus three compile-time "
      "constants, and `Influence` is applied **outside** the kernel by the managed "
      "`ClassicCombiner`. `m_influence` is a declared field that nothing in this path "
      "sets. The managed `ThermalShaper.Parameters` (section 7) is a different, richer "
      "surface with `Scale`, `Influence`, `Shape`, `MicrodetailPreservation`; the two "
      "are separate implementations of the thermal-shaper idea (`observed`).")
    A("")
    A("### 5.3 Standard mathematical form (inferred)")
    A("")
    A("```text")
    A("# profile shaping: move the surface towards a shaped target while")
    A("# preserving micro-detail")
    A("t(x)   = shape(scale * z(x))          # shaped profile target")
    A("z'(x) = z(x) + intensity * influence * (t(x) - z(x))")
    A("```")
    A("`inferred`, confidence low: the module's active surface is too small to identify "
      "the shaping function. The 39 unreachable fields suggest this module is a legacy or "
      "reduced build of the erosion core.")
    A("")

    # ---------- Thermal2 ----------------------------------------------------
    A("---")
    A("")
    A("## 6. `Thermal2` — thermal erosion / mass wasting (SYCL layer)")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed entry | `SyclFunctions.Thermal2.ThermalSimulation(Parameters, inMaps, "
      "out outMaps) -> Boolean` *(observed)* |")
    A("| native namespace | `thermal` |")
    A("| node entry point | `Erosions.Thermal2(...)` (line 812), also reached through "
      "`Simulations.Thermal` for the CPU path |")
    A("| nodes | `Thermal`, `Thermal2`, `Erosion2`, `EasyErosion` |")
    A("")
    A("### 6.1 Parameters (11 fields, names readable)")
    A("")
    fields, methods = params_fields("Thermal2")
    t2 = {
        "Resolution": ("grid dimensions", "high"),
        "Duration": ("number of relaxation iterations / time", "high"),
        "Strength": ("diffusion rate", "high"),
        "Anisotropy": ("directional weighting of the talus transport", "high"),
        "TalusAngle": ("angle of repose threshold (`Angle`)", "high"),
        "ErosionScale": ("feature scale (`FeatureScale`)", "high"),
        "HeightmapSize": ("terrain width in world units", "high"),
        "HeightmapHeight": ("terrain height in world units", "high"),
        "SedimentRemoval": ("sediment removal strength", "high"),
        "UseAreaMask": ("apply an area mask", "high"),
        "UseSedimentRemovalMask": ("apply a sediment-removal mask", "high"),
    }
    rows = [[f["ordinal"], "`%s`" % f["name"], f["type"], t2.get(f["name"], ("—", "—"))[0],
             t2.get(f["name"], ("—", "—"))[1]] for f in fields]
    A(md_table(["#", "field", "type", "inferred physical meaning", "confidence"], rows))
    A("")
    A("`observed` node assignment (`Erosions.Thermal2`, line 814) confirms "
      "`TalusAngle <- Angle`, `ErosionScale <- FeatureScale`, "
      "`HeightmapSize <- Terrain.Width`, `HeightmapHeight <- Terrain.Height`, "
      "`UseAreaMask <- (area != null)`, `UseSedimentRemovalMask <- (sedimentRemoval != null)`.")
    A("")
    A("### 6.2 Native structure (`thermal::Thermal`)")
    A("")
    rows = []
    for dll, ns, cls, meth, args, items, vecs in native_methods(["thermal"]):
        if dll != "Gaea.oneAPI.dll":
            continue
        rows.append([ns, cls, meth, short_args(args)])
    A(md_table(["namespace", "class", "method", "parameter list (demangled)"], rows))
    A("")
    A("`thermal::LaplacianLevel` also exists, and its `reconstruct_previous_level` takes "
      "a `thermal::Parameters const&` — the same pyramid structure as `parallel_erosion`.")
    A("")
    A("### 6.3 Tensor I/O")
    A("")
    A("`observed`: 2-D `float` buffers only (no particle buffer, unlike "
      "`parallel_erosion`); `ValueTuple inMaps` / `ValueTuple outMaps` in the managed "
      "binding, with `height`, `deposition` and `wear` named in the "
      "`Erosions.Thermal2` `out` tuple (line 812).")
    A("")
    A("### 6.4 Standard mathematical form (inferred)")
    A("")
    A("```text")
    A("# talus-angle (thermal) erosion, Musgrave-style with anisotropy")
    A("for each cell i:  T_i = talus_angle * anisotropy(neighbour direction)")
    A("for each neighbour j:  d = z_i - z_j")
    A("    if d > T_ij:  transfer += strength * (d - T_ij) / 2")
    A("z_i -= transfer;  neighbours += transfer/n")
    A("repeat `duration` times;  sediment_removal drains transferred material")
    A("```")
    A("`inferred`, confidence high for the family, low for the exact per-neighbour split.")
    A("")

    # ---------- ThermalShaper ----------------------------------------------
    A("---")
    A("")
    A("## 7. `ThermalShaper` (SYCL layer)")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed entry | `SyclFunctions.ThermalShaper.Process(Parameters, inMaps, "
      "out Map) -> Boolean` *(observed)* |")
    A("| native namespace | `thermal_shaper` |")
    A("| node | `ThermalShaper.Build()` (line 31965); the C++/CLI counterpart is "
      "`ErosionWrapperTS` (section 5) via `Profiles.ThermalShaper` |")
    A("")
    A("### 7.1 Parameters (7 fields — all names recovered)")
    A("")
    fields, methods = params_fields("ThermalShaper")
    ts = {
        "Resolution": ("grid dimensions", "high"),
        "TerrainWidth": ("terrain width in world units", "high"),
        "TerrainHeight": ("terrain height in world units", "high"),
        "Scale": ("shaping scale (`Scale`)", "high"),
        "Influence": ("blend amount of the shaped profile (`Influence`)", "high"),
        "Shape": ("profile curve parameter (`Shape`)", "high"),
        "MicrodetailPreservation": ("how much fine detail is retained "
                                    "(`MicrodetailPreservation`)", "high"),
    }
    rows = []
    for f in fields:
        semv = "; ".join(esc(s) for s in f["semantics"]) or "—"
        m, c = ts.get(f["name"] or "", ("—", "—"))
        rows.append([f["ordinal"], f["type"], "`%s`" % (f["name"] or f["tok"]),
                     semv, m, c])
    A(md_table(["#", "type", "name / token", "observed node assignment",
                "inferred physical meaning", "confidence"], rows))
    A("")
    A("The native `thermal_shaper::ThermalShaper::process` operates on the same "
      "`LaplacianLevel` pyramid "
      "(`thermal_shaper::LaplacianLevel::reconstruct_previous_level(Parameters const&)`), "
      "so this kernel is a pyramid-shaped profile operator rather than a per-cell filter "
      "(`observed` for the pyramid, `inferred` for the consequence).")
    A("")
    A("### 7.2 Tensor I/O and form")
    A("")
    A("`observed`: 2-D `float` in-maps, single 2-D `float` output map. "
      "`inferred` form:")
    A("")
    A("```text")
    A("t(x)   = shape_curve(scale * z(x))                     # target profile")
    A("z'(x)  = lerp(z(x), t(x), influence)")
    A("z'(x) += microdetail_preservation * (z(x) - blur(z(x)))")
    A("```")
    A("")

    # ---------- Flow --------------------------------------------------------
    A("---")
    A("")
    A("## 8. `Flow` — flow accumulation / flow map")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed entry | `SyclFunctions.Flow.Simulation(Parameters, inMaps, out Map) -> "
      "Boolean` *(observed)* |")
    A("| native namespace | `flow` |")
    A("| node entry point | `Simulations.Flow2(...)` (line 4508/4510) |")
    A("| nodes | `FlowMap`, `FlowMapClassic` (via `Simulations.CreateFlowMap`), "
      "`SuperColor`, `Dusting`, `Scree`, `Shrubs`, `Trees`, `Texturize`, `Anastomosis` |")
    A("")
    A("### 8.1 Parameters (4 fields, names readable)")
    A("")
    fields, methods = params_fields("Flow")
    fl = {"Resolution": ("grid dimensions", "high"),
          "FlowLength": ("flow path length / integration distance", "high"),
          "FlowVolume": ("water volume per particle", "high"),
          "Seed": ("RNG seed for particle placement", "high")}
    rows = [[f["ordinal"], "`%s`" % f["name"], f["type"], fl[f["name"]][0], fl[f["name"]][1]]
            for f in fields]
    A(md_table(["#", "field", "type", "inferred physical meaning", "confidence"], rows))
    A("")
    A("`observed` node assignment: `Resolution <- map.Resolution`, "
      "`FlowLength <- Strength` (`SuperColor`) or `FlowLength` (`Simulations.Flow2`), "
      "`FlowVolume`, `Seed`.")
    A("")
    A("### 8.2 Native structure (`flow::Flow`)")
    A("")
    rows = []
    for dll, ns, cls, meth, args, items, vecs in native_methods(["flow"]):
        if dll != "Gaea.oneAPI.dll":
            continue
        rows.append([cls, meth, short_args(args), ",".join(items) or "-", ",".join(vecs) or "-"])
    A(md_table(["class", "method", "parameter list (demangled)", "SYCL item", "vector"], rows))
    A("")
    A("`flow()` takes a **1-D `buffer<vec<float,2>,1>`** (particles, i.e. positions) plus "
      "four `unsigned int` scalars, two 2-D `float` maps and another 1-D `vec<float,2>` "
      "buffer. `fill_pits` has a 2-buffer and a 3-buffer overload. There is no particle "
      "*struct* here — unlike `parallel_erosion::Particle` — so the flow particle carries "
      "position only (`observed` for the buffers, `inferred` for the interpretation).")
    A("")
    A("### 8.3 Tensor I/O")
    A("")
    A("`observed`: in = 2-D heightmap (+ optional 2-D precipitation map); out = single "
      "2-D `float` flow map. Internally: particle buffer + pit-filled height + "
      "flow-accumulation map.")
    A("")
    A("### 8.4 Standard mathematical form (inferred)")
    A("")
    A("```text")
    A("# 1. depression filling (fill_pits) so every cell has a downslope path")
    A("# 2. particle flow routing")
    A("for each of N particles released at random cells (seed):")
    A("    follow the steepest-descent / D-infinity direction for flow_length steps")
    A("    accumulate 1/flow_volume into the visited cells")
    A("# 3. output = accumulation (optionally oriented by a guide map)")
    A("```")
    A("The two-buffer `fill_pits` overload is consistent with priority-flood "
      "`(height, filled)`; the three-buffer overload with "
      "`(height, filled, marker)` (`inferred`). `Simulations.CreateFlowMap(height, width, "
      "m_iterations, heights, rain, oriented)` — `observed` at line 4619 — shows an "
      "*iterative* variant, and its `oriented` flag matches the `FlowMap` node's "
      "`Oriented` parameter.")
    A("")

    # ---------- ColorTransport ---------------------------------------------
    A("---")
    A("")
    A("## 9. `ColorTransport` — sediment colour advection")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed entry | `SyclFunctions.ColorTransport.Simulation(Parameters, inMaps, "
      "out Map) -> Boolean` *(observed)* |")
    A("| native namespace | `color_transport` |")
    A("| nodes | `Cartography`, `Weathering`, `SuperColor`, `ColorErosion`, `Dusting` |")
    A("")
    A("### 9.1 Parameters (8 fields, names readable)")
    A("")
    fields, methods = params_fields("ColorTransport")
    ct = {"Resolution": ("grid dimensions", "high"),
          "TransportDistance": ("advection distance of the colour along the flow", "high"),
          "SedimentDensity": ("sediment concentration controlling colour pickup", "high"),
          "Blend": ("blend amount between transported and original colour", "high"),
          "FlowVolume": ("water volume used for the advection step", "high"),
          "ColorHold": ("resistance of the colour to being transported", "medium"),
          "LaminarFlow": ("laminar vs. turbulent advection", "high"),
          "Seed": ("RNG seed", "high")}
    rows = [[f["ordinal"], "`%s`" % f["name"], f["type"], ct[f["name"]][0], ct[f["name"]][1]]
            for f in fields]
    A(md_table(["#", "field", "type", "inferred physical meaning", "confidence"], rows))
    A("")
    A("`observed` node assignment (`Cartography`, line 8664): "
      "`Resolution <- context.Resolution`, `LaminarFlow`, `Seed`; "
      "`Dusting` (line 35324) assigns all eight.")
    A("")
    A("### 9.2 Native structure")
    A("")
    rows = []
    for dll, ns, cls, meth, args, items, vecs in native_methods(["color_transport"]):
        if dll != "Gaea.oneAPI.dll":
            continue
        rows.append([ns, cls, meth,
                     "(%d parameters) %s" % (len(args.split(",")), short_args(args)),
                     ",".join(vecs) or "-"])
    A(md_table(["namespace", "class", "method", "parameter list (demangled)", "vector"],
               rows))
    A("")
    A("`ColorTransport::color_transport*` takes 16 parameters: a 1-D "
      "`buffer<vec<float,2>,1>` (particles), 4 scalars "
      "(`unsigned, unsigned, float, unsigned` — consistent with particle count, "
      "iterations, transport distance and seed) and **eleven 2-D `float` maps**. "
      "`ColorTransport::fill_pits` and `color_transport::LaplacianLevel` are also present. "
      "`observed`.")
    A("")
    A("### 9.3 Tensor I/O and form")
    A("")
    A("`observed`: in = heightmap + colour/guide maps; out = a single colour map. "
      "`inferred` form:")
    A("")
    A("```text")
    A("# semi-Lagrangian advection of colour along the flow field, with sediment")
    A("# exchange (pickup where erosion is strong, deposit where it is weak)")
    A("c'(x) = lerp(c(x), c(x - v(x) * transport_distance), blend)")
    A("c'(x) *= (1 - color_hold);  pickup/deposit weighted by sediment_density")
    A("```")
    A("")

    # ---------- MedianFilter -----------------------------------------------
    A("---")
    A("")
    A("## 10. `MedianFilter`")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed entry | `Classic(Map heightmap, Int32 radius, Int32 iterations, Boolean "
      "smooth) -> Map` and `ResolutionIndependent(Map heightmap, Int32 strength, "
      "MedianQuality quality, Boolean smooth) -> Map` *(observed)* |")
    A("| native namespace | `median_filter` |")
    A("| backend availability | oneAPI + AdaptiveCpp only (**not** in `Gaea.Native.dll**) |")
    A("| node | `Median` (`MedianFilter.ResolutionIndependent(map, Strength, Quality, ...)`, "
      "line 27930) |")
    A("")
    A("### 10.1 Parameters (4 fields) and enum")
    A("")
    fields, methods = params_fields("MedianFilter")
    mf = {"Resolution": ("grid dimensions", "high"),
          "Radius": ("kernel radius in cells (`Classic`)", "high"),
          "Iterations": ("number of passes (`Classic`)", "high"),
          "Smooth": ("blend the median result instead of replacing", "medium")}
    rows = [[f["ordinal"], "`%s`" % f["name"], f["type"], mf[f["name"]][0], mf[f["name"]][1]]
            for f in fields]
    A(md_table(["#", "field", "type", "inferred physical meaning", "confidence"], rows))
    A("")
    A("`MedianQuality` enum members *(observed)*: `Low`, `Medium`, `High`; the node's "
      "`Quality` property is annotated `[Parameter(Parameters.HorizontalList, "
      "MedianFilter.MedianQuality.Low, 0f, 1f)]`. `ResolutionIndependent` converts a "
      "0–1 `strength` into `radius`/`iterations` via the quality tier "
      "(`inferred`, confidence high).")
    A("")
    A("### 10.2 Form (inferred)")
    A("")
    A("```text")
    A("for iteration in 1..iterations:")
    A("    out(x) = median{ z(y) : |x - y| <= radius }")
    A("# smooth=true -> out = lerp(z, out, k)")
    A("```")
    A("")

    # ---------- Cellular3D --------------------------------------------------
    A("---")
    A("")
    A("## 11. `Cellular3D` — 3-D cellular (Worley) noise")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed entry | `SyclFunctions.Cellular3D.Render(Parameters, inMaps, out outMaps) "
      "-> Boolean` *(observed)* |")
    A("| native scope | class `Cellular3D` (no lowercase namespace exists in the binaries) |")
    A("| nodes | `Cellular3D`, `IceFloe`, `Shrubs` (`BuildGrowthCells`), `Trees` "
      "(`BuildGrowthCells`) |")
    A("")
    A("### 11.1 Parameters (13 fields — names recovered from node assignments)")
    A("")
    fields, methods = params_fields("Cellular3D")
    c3 = {
        "Resolution": ("grid dimensions", "high"),
        "Size": ("cell/tile size", "medium"),
        "Gap": ("F2-F1 band width (cell walls)", "medium"),
        "ScaleX": ("per-axis cell scale", "medium"),
        "ScaleY": ("per-axis cell scale", "medium"),
        "ScaleZ": ("per-axis cell scale", "medium"),
        "JitterX": ("per-axis feature-point jitter", "medium"),
        "JitterY": ("per-axis feature-point jitter", "medium"),
        "JitterZ": ("per-axis feature-point jitter", "medium"),
        "Seed": ("RNG seed", "high"),
        "TerrainWidth": ("terrain width in world units", "high"),
        "TerrainHeight": ("terrain height in world units", "high"),
        "Flag": ("int32 selector, never assigned by an available node", "low"),
    }
    rows = []
    for f in fields:
        semv = "; ".join(esc(s) for s in f["semantics"]) or "—"
        nm = f["name"] or f["tok"]
        m, c = c3.get(f["name"] or "", ("—", "—"))
        rows.append([f["ordinal"], f["type"], "`%s`" % nm, semv, m, c])
    A(md_table(["#", "type", "name / token", "observed node assignment",
                "inferred physical meaning", "confidence"], rows))
    A("")
    A("The names in the third column are the *node-facing* quantities: ordinal 3 is "
      "`Gap` in the `Cellular3D` node and `Density` in `IceFloe`; ordinal 6 is `ScaleZ` "
      "in `Cellular3D` and `81 * Layers` in `IceFloe`. The field is a generic kernel "
      "slot whose role is fixed by the calling node (`observed`). The type sequence "
      "`Resolution, float×8, uint, float, float, int` pins ordinals 2–9 to floats and "
      "ordinal 10 to the seed.")
    A("")
    A("### 11.2 Tensor I/O and form")
    A("")
    A("`observed`: in = a `ValueTuple` of input maps (a warp/coordinate pair), out = a "
      "`ValueTuple` of maps; `Render` is called with the parameter block plus "
      "`base.context.Resolution`.")
    A("`inferred` form (classic Worley/cellular noise in 3-D):")
    A("")
    A("```text")
    A("p = (x*scale_x + jitter_x*r, y*scale_y + jitter_y*r, z*scale_z + jitter_z*r)")
    A("F1, F2 = two nearest feature-point distances in the scaled 3-D lattice")
    A("cell    = F1")
    A("gap     = F2 - F1                    # thin walls / crack network")
    A("```")
    A("`seed` selects the feature-point hash; `TerrainWidth/Height` only rescale world "
      "units. Confidence: high for the noise family, medium for which output slot each "
      "of `cell`/`gap` lands in.")
    A("")

    # ---------- MeshRasterizer ---------------------------------------------
    A("---")
    A("")
    A("## 12. `MeshRasterizer` — mesh / point-cloud to heightmap")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed entries | `RenderMesh(map, out warpmap, mesh)`, "
      "`RenderMesh(map, warpmap)`, `RenderMeshWithTriplanarDisplacement(...)`, "
      "`RasterizePointCloud(Parameters, Vector3[] points, out ValueTuple, Map texture)` "
      "*(observed; method names partly rendered as PUA because the decompiler could not "
      "print them)* |")
    A("| native namespaces | `mesh_rasterizer` (lower-case, free functions) and "
      "`MeshRasterizer` (class, oneAPI) |")
    A("| nodes | `Object`, `Meshify`, `Transform3D`, `TriplanarDisplacement`, `MeshWarp`, "
      "`TextureBaker` |")
    A("")
    A("### 12.1 Parameters (15 fields — 14 of 15 recovered)")
    A("")
    fields, methods = params_fields("MeshRasterizer")
    mr = {
        "Resolution": ("grid dimensions", "high"),
        "Mode": ("int32 selector — never assigned by an available node", "low"),
        "TerrainAspect": ("`Terrain.Height / Terrain.Width`", "high"),
        "Pitch": ("X rotation of the mesh", "high"),
        "Yaw": ("Y rotation of the mesh", "high"),
        "Roll": ("Z rotation of the mesh", "high"),
        "Scale": ("uniform mesh scale", "high"),
        "OffsetX": ("translation", "high"),
        "OffsetY": ("translation", "high"),
        "OffsetZ": ("translation", "high"),
        "Strength": ("triplanar displacement strength (`Strength`)", "high"),
        "Offset": ("triplanar displacement offset (`Offset`)", "high"),
        "Horizontal": ("horizontal-only displacement (`Horizontal`)", "high"),
        "DropToFloor": ("translate the mesh so its minimum sits at the terrain floor", "high"),
        "Antialiasing": ("enable edge antialiasing during rasterisation", "high"),
    }
    rows = []
    for f in fields:
        semv = "; ".join(esc(s) for s in f["semantics"]) or "—"
        nm = f["name"] or f["tok"]
        m, c = mr.get(f["name"] or "", ("—", "—"))
        rows.append([f["ordinal"], f["type"], "`%s`" % nm, semv, m, c])
    A(md_table(["#", "type", "name / token", "observed node assignment",
                "inferred physical meaning", "confidence"], rows))
    A("")
    A("The `MeshRasterizer` node assigns ordinals 1 and 3–10 and 14–15; "
      "`TriplanarDisplacement` assigns 1, 3, 11–13; `Meshify` assigns only 1. The type "
      "sequence `Resolution, int, float×10, bool×3` matches the recovered layout exactly, "
      "which is the cross-check on the join. Ordinal 13 (`Horizontal`) is the first "
      "`Boolean` in metadata order and is assigned a boolean — consistent.")
    A("")
    A("### 12.2 Native structure")
    A("")
    rows = []
    for dll, ns, cls, meth, args, items, vecs in native_methods(["mesh_rasterizer", "MeshRasterizer"]):
        if dll not in ("Gaea.oneAPI.dll",):
            continue
        rows.append([ns, cls, meth, short_args(args)])
    A(md_table(["namespace", "class", "method", "parameter list (demangled)"], rows))
    A("")
    A("### 12.3 Tensor I/O and form")
    A("")
    A("`observed`: input is a `Vector3[]` point cloud (or an imported mesh handle obtained "
      "from the Assimp-style loader in `Gaea.Native.dll`), plus an optional texture map; "
      "output is `(heightmap, warpmap)` — i.e. the rasteriser also returns the UV/flow "
      "warp map used by `MeshWarp` and `TextureBaker`.")
    A("`inferred` form: standard z-buffered triangle rasterisation,")
    A("")
    A("```text")
    A("M = scale * rotate(pitch, yaw, roll);  p' = M*p + offset")
    A("for each triangle: rasterise with barycentric interpolation, z-buffer test")
    A("if displacement: z += strength * texture(p'.xz or p'.yz) - offset")
    A("if drop_to_floor: p'.y -= min_y(p')")
    A("```")
    A("")

    # ---------- NativeLighting ---------------------------------------------
    A("---")
    A("")
    A("## 13. `NativeLighting` — sun/sky lighting, shadows and ambient occlusion")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed type | `SyclFunctions.NativeLighting.Parameters` (26 fields). The class "
      "itself has no methods; the entry points are the `Sycl.SyclFunctions` delegate "
      "fields `Shade` and `SunLightIntegral` *(observed)* |")
    A("| native namespaces | `lighting` (all backends), `lighting_x` (AdaptiveCpp only), "
      "`ispc_lighting` (`Gaea.Native.dll`, ISPC) |")
    A("| nodes | `Sunlight`, `LightX`, `AO`, `Occlusion`, `Shade`, `Normals`, `SatMap`, "
      "`TextureBase` (the last two consume baked light/AO maps) *(inferred)* |")
    A("")
    A("### 13.1 Parameters (26 fields, all names readable)")
    A("")
    fields, methods = params_fields("NativeLighting")
    nl = {
        "Resolution": ("grid dimensions", "high"),
        "TerrainWidth": ("terrain width in world units", "high"),
        "TerrainHeight": ("terrain height in world units", "high"),
        "SunDirection": ("sun vector", "high"),
        "ShadowQuality": ("shadow-map / ray quality tier", "high"),
        "SunAngularDiameter": ("angular size of the sun disc (soft shadows)", "high"),
        "AOModel": ("ambient-occlusion model selector", "high"),
        "RaytracedAOQuality": ("AO ray count/quality", "high"),
        "HybridAOQuality": ("hybrid AO quality tier", "high"),
        "HybridAOOctaves": ("hybrid AO octave count", "high"),
        "Exposure": ("output exposure", "high"),
        "SunIntensity": ("direct light intensity", "high"),
        "AmbientIntensity": ("ambient light intensity", "high"),
        "SunColor": ("direct light colour", "high"),
        "AmbientColor": ("ambient light colour", "high"),
        "DefaultColor": ("colour for unlit/invalid samples", "medium"),
        "DayBegin": ("start day-of-year of the sun path", "high"),
        "DayEnd": ("end day-of-year of the sun path", "high"),
        "Latitude": ("geographic latitude driving the sun path", "high"),
        "NorthDirection": ("map rotation of true north", "high"),
        "AirDensity": ("atmospheric density for Rayleigh scattering", "medium"),
        "UseDirectLighting": ("enable direct lighting", "high"),
        "UseAmbientLighting": ("enable ambient lighting", "high"),
        "UseShadows": ("enable shadows", "high"),
        "UseAmbientOcclusion": ("enable AO", "high"),
        "AoCached": ("reuse a cached AO map", "high"),
    }
    rows = [[f["ordinal"], "`%s`" % f["name"], f["type"], nl[f["name"]][0], nl[f["name"]][1]]
            for f in fields]
    A(md_table(["#", "field", "type", "inferred physical meaning", "confidence"], rows))
    A("")
    A("### 13.2 Native structure")
    A("")
    rows = []
    for dll, ns, cls, meth, args, items, vecs in native_methods(["lighting", "lighting_x", "ispc_lighting"]):
        if dll not in ("Gaea.oneAPI.dll", "Gaea.Native.dll"):
            continue
        rows.append([dll, ns, cls, meth, "(%d) %s" % (len(args.split(",")), short_args(args))])
    A(md_table(["assembly", "namespace", "class", "method", "parameter list"], rows))
    A("")
    A("Split of the lighting kernel into passes is `observed`: "
      "`compute_normals_and_init_photonmap`, `compute_diffuse_light`, `raytrace_shadows`, "
      "`raytrace_ao`, `raytrace_ao_sl` (single-level / sun-list variant, adds a "
      "`buffer<float,1>` of sun samples and a `float` threshold), `compute_hybrid_ao`, "
      "`compose_light`. Buffer element types are 2-D `float`, 2-D `int` and 2-D "
      "`vec<float,3>`.")
    A("")
    A("### 13.3 Form (inferred)")
    A("")
    A("```text")
    A("N(x)  = -normalize(gradient(z))                       # compute_normals_and_init_photonmap")
    A("L     = raytrace_shadows(N, sun_direction, sun_angular_diameter, shadow_quality)")
    A("AO    = raytrace_ao(...)  or  compute_hybrid_ao(...)  # hemisphere sampling")
    A("color = exposure * (sun_intensity*sun_color*L*max(0,N.S)")
    A("                 + ambient_intensity*ambient_color*AO)")
    A("sky   = rayleigh(air_density, day_of_year(latitude, day_begin..day_end))")
    A("```")
    A("The name `photonmap` points at an explicit photon/ray map that is later used for "
      "AO and shadows (`inferred`, confidence medium).")
    A("")
    A("### 13.4 Visibility limits")
    A("")
    A("* The `AOModel` enumeration and the quality-tier enumerations are not declared in "
      "`Gaea.Engine.dll` (the field types resolve to enums defined elsewhere in the "
      "Engine assembly, not in `SyclFunctions`).")
    A("* Whether `AoCached` reuses an on-disk cache cannot be decided statically here.")
    A("")

    # ---------- Debris ------------------------------------------------------
    A("---")
    A("")
    A("## 14. `Debris` — rock/debris scattering")
    A("")
    A("| binding | value |")
    A("|---|---|")
    A("| managed type | `SyclFunctions.Debris.Parameters` (12 fields) + "
      "`SizeDistribution { Uniform, Natural }`; the class itself has no methods — the "
      "call goes through the `Engine` core (`debrisCore.Simulation(...)`) *(observed)* |")
    A("| native namespace | `Debris` (AdaptiveCpp only; absent from oneAPI and Native) |")
    A("| node | `Debris` |")
    A("")
    A("### 14.1 Parameters (12 fields, all names readable)")
    A("")
    fields, methods = params_fields("Debris")
    db = {
        "Resolution": ("grid dimensions", "high"),
        "TerrainWidth": ("terrain width in world units", "high"),
        "TerrainHeight": ("terrain height in world units", "high"),
        "DebrisCount": ("number of scattered rocks", "high"),
        "MaxDebrisSize": ("upper size bound", "high"),
        "MinDebrisSize": ("lower size bound", "high"),
        "FrictionCoefficient": ("sliding friction after a bounce", "high"),
        "RestitutionCoefficient": ("bounce elasticity", "high"),
        "Durability": ("resistance to breaking/settling", "medium"),
        "RenderStillRocks": ("also render rocks that never moved", "high"),
        "SizeDistribution": ("`Uniform` or `Natural` size sampling", "high"),
        "Seed": ("RNG seed", "high"),
    }
    rows = [[f["ordinal"], "`%s`" % f["name"], f["type"], db[f["name"]][0], db[f["name"]][1]]
            for f in fields]
    A(md_table(["#", "field", "type", "inferred physical meaning", "confidence"], rows))
    A("")
    A("### 14.2 Form (inferred)")
    A("")
    A("```text")
    A("for i in 1..debris_count:")
    A("    r = sample_size(size_distribution) in [min_debris_size, max_debris_size]")
    A("    p = random position (seed);  roll downhill with friction,")
    A("    bounce with restitution;  stop when kinetic energy < durability")
    A("```")
    A("`Natural` most likely means a power-law/log-normal size sample and `Uniform` a "
      "flat one (`inferred`, confidence medium).")
    A("")

    # ---------- binding-less natives ---------------------------------------
    A("---")
    A("")
    A("## 15. Native kernels with no managed binding in this build")
    A("")
    A("These namespaces exist in the shipped native binaries but have no "
      "`SyclFunctions.*` entry in `Gaea.Engine.dll`. They are reached through other "
      "managed code paths (the Engine core calls them directly) or are internal "
      "infrastructure (`observed` for the names, `inferred` for the role).")
    A("")
    rows = []
    for ns in ["resampling", "stamp_instancer", "texture3d", "arrakis", "lake",
               "interopmesh", "mesh_port", "shm", "spline"]:
        dlls = sorted({d for d, blob in NSYM["dlls"].items()
                       if ns in blob["namespaces"]})
        if not dlls:
            continue
        meths = []
        for dll in dlls:
            for name, m in NSYM["dlls"][dll]["methods"].items():
                if m["namespace"] == ns:
                    meths.append("%s::%s" % (m["class"], m["method"]) if m["class"]
                                 else m["method"])
        rows.append([ns, ", ".join(d.replace("Gaea.", "").replace(".dll", "")
                                   for d in dlls),
                     ", ".join(sorted(set(meths))[:6]) or "(class only)"])
    A(md_table(["namespace", "present in", "observed methods"], rows))
    A("")
    A("Observed signatures worth recording (`Gaea.Native.dll`):")
    A("")
    A("```text")
    A("lake::lake_create(lake::Parameters, float*, float*, float*, float*, InteropBridge)")
    A("lake::search_min(Map<float>&, int, int, float, int&, int&, float&)")
    A("lake::search_closest(Map<float>&, int, int, float, int&, int&, float&, float, float)")
    A("mesh_port::heightmap_to_mesh(float*, mesh_port::Parameters, InteropBridge) -> interopmesh::Mesh*")
    A("shm::heightmap_to_mesh_adaptive_subdivision(float*, mesh_port::Parameters, InteropBridge) -> interopmesh::Mesh*")
    A("```")
    A("")
    A("`lake_create` takes **four `float*` map pointers** plus the interop bridge, which "
      "matches the four CW outputs (height, depth, shore, surface); `search_min` / "
      "`search_closest` are the spill-point search primitives of a priority-flood style "
      "depression filler, which independently corroborates the section 4 form "
      "(`observed` signatures, `inferred` reading). `interopmesh::Mesh` is the CPU mesh "
      "handle type shared by the mesh ports.")
    A("")
    A("Notes (`inferred`): `resampling` provides the box/`magic` downsample, sharpen and "
      "upsample used to build the multi-resolution pyramids (both `sycl::buffer` and "
      "`usm_ptr<float,2>` overloads are `observed`, so a USM path exists alongside the "
      "buffer path); `stamp_instancer` most likely instances scatter/stamp geometry; "
      "`texture3d` is a 3-D texture sampler; `arrakis` is an AdaptiveCpp runtime "
      "component, not a terrain kernel; `lake` is the CPU-side water solver that pairs "
      "with `ErosionWrapperW`; `mesh_port` / `shm` are the two CPU mesh builders behind "
      "the `MeshPort_*` exports and `interopmesh` is their shared mesh type.")
    A("")
    A("`exprtk` (5 267 symbol hits), `tinyobj` and `Assimp` in `Gaea.Native.dll` are "
      "third-party libraries (expression evaluation and mesh import) — `observed` as "
      "symbols only.")
    A("")

    # ---------- node parameter mapping table --------------------------------
    A("---")
    A("")
    A("---")
    A("")
    A("## 16. The CPU C API of `Gaea.Native.dll` (19 named exports, observed)")
    A("")
    A("`Gaea.Native.dll` ships a readable export-name table. The same 19 names also appear "
      "as string literals in `Gaea.Engine.dll`, i.e. they are resolved by name through "
      "`SyclLibrary.LoadFunction(...)`. This is the complete CPU-side kernel surface, and "
      "it is *not* the same set as `SyclFunctions`:")
    A("")
    A("```text")
    A("FastBlur4_Process                     ParallelErosion_Erode")
    A("FastBlur_Process                      Rivers")
    A("HydrologicalCorrection                ShadeIspc")
    A("Lake_Create                           SunLightIntegralIspc")
    A("MathX_Compute                         MeshPort_Destroy")
    A("MathX_FreeErrorMessage                MeshPort_HeightmapToMesh")
    A("MathX_Function                        MeshPort_HeightmapToMeshWithAdaptiveSubdivision")
    A("                                      MeshPort_Load")
    A("                                      MeshPort_PointCloudToMesh")
    A("                                      MeshPort_Save")
    A("                                      MeshPort_SavePointCloud")
    A("                                      MeshPort_TrianglesToMesh")
    A("```")
    A("")
    A("`inferred` roles: `ParallelErosion_Erode` is the CPU erosion entry (the counterpart "
      "of `parallel_erosion` and of the C++/CLI `ErosionWrapper`); `Lake_Create` is the CPU "
      "water solver (counterpart of `ErosionWrapperW` / the `lake` scope); `Rivers` backs "
      "the `Rivers` node through `Waters.Rivers`; `HydrologicalCorrection` backs `HydroFix`; "
      "`ShadeIspc` / `SunLightIntegralIspc` are the ISPC lighting pair (counterpart of "
      "`SyclFunctions.Shade` / `.SunLightIntegral`); `FastBlur*` are blurs; `MathX_*` "
      "evaluate the MathX expression language on top of the bundled `exprtk`; `MeshPort_*` "
      "convert and persist meshes and point clouds on top of the bundled Assimp.")
    A("")
    A("Note the asymmetry: `HydrologicalCorrection`, `Rivers`, `Lake_Create` and the "
      "`FastBlur` pair have **no** `SyclFunctions` counterpart in this build, so those "
      "operations are CPU-only (`observed` for the export list, `inferred` for the "
      "conclusion).")
    A("")
    A("## 17. Cross-layer parameter-name correspondences (observed)")
    A("")
    A("These are the places where a readable node-facing parameter name and a "
      "kernel-side parameter name are joined by an actual assignment in the decompiled "
      "`Build()` code. They are the strongest available evidence for the semantics in "
      "sections 1–14.")
    A("")
    rows = []
    for c in CALLS:
        if not c["assignments"]:
            continue
        for k, v in list(c["assignments"].items())[:40]:
            if PUA.search(k):
                continue
            rows.append([c["ownerType"], c["symbol"], "`%s`" % k, esc(v)[:60]])
    A(md_table(["node / helper", "kernel call", "kernel-side field", "assigned expression"],
               rows[:90]))
    A("")
    A("*(Rows are deduplicated per call site; the complete set is in "
      "`docs/kernels-inventory.json` under `nodeCallSites` and in "
      "`evidence/kernels/node-callsites.json`.)*")
    A("")
    A("## 18. Summary of what remains unknown")
    A("")
    A("* No kernel body, constant, iteration count or numeric default was recovered for "
      "any kernel: the native DLLs were not disassembled and the C++/CLI cores are "
      "IL-less mixed-mode code.")
    A("* Native struct layouts (byte offsets, padding, alignment) are not asserted.")
    A("* 3 `ParallelErosion.Parameters` fields, 1 `MeshRasterizer.Parameters` field, and "
      "the `AOModel`/quality enumerations have no observed assignment.")
    A("* The mapping in section 16 only covers nodes present in the 2 MB partial "
      "decompilation of `Gaea.Nodes.dll`.")
    return "\n".join(L)


def main():
    os.makedirs(DOCS, exist_ok=True)
    ref = build_reference()
    with open(os.path.join(DOCS, "kernels-reference.md"), "w", encoding="utf-8") as fh:
        fh.write(ref + "\n")
    print("wrote docs/kernels-reference.md", len(ref), "chars")
    return 0


if __name__ == "__main__":
    sys.exit(main())
