# Gaea's oneAPI kernels: an interface inventory, not implementations

> **Correction.** An earlier version of this document claimed that `Gaea.oneAPI.dll`'s
> embedded SPIR-V made Gaea's particle-erosion **bodies** readable, and that the SPIR-V route
> therefore removed the need for Ghidra. **That was wrong and is retracted here.** It rested
> on a carve that ran from one SPIR-V magic to the next, swallowing a `0x17171717` fill
> pattern and the adjacent data after it. That trailing region decoded as plausible
> instructions — 76 "functions" with recognisable names — which made a metadata blob look
> like executable code.

## What the modules actually are

`Gaea.oneAPI.dll` (15,393,280 bytes) contains **13 embedded SPIR-V modules**, each ~76,000 to
82,000 words. With the carve stopped correctly at the filler, every one of them audits as
**reflection metadata only**:

| Module | instructions | types | constants | functions | debug/reflection |
| --- | --- | --- | --- | --- | --- |
| m00–m12 (each) | ~5,500 | **0** | **0** | **0** | ~5,500 |

The instruction census for `m12.spv` accounts for all 5,537 instructions exactly:

```
5441 OpString   56 OpName   22 OpEntryPoint   10 OpCapability
   4 other      2 OpExtInstImport   1 OpMemoryModel   1 OpSource
```

No `OpType*`, no `OpConstant*`, no `OpFunction`. **There are no algorithm bodies in these
modules, no literals and no control flow.**

The `0x17171717` pattern that follows each module is why the first carve overran: it is a
repeated-byte filler, and the word there encodes as `wordCount = 0x1717, opcode = 0x1717`,
which is not a valid instruction. Stopping at an undefined opcode recovers the exact module
boundary. `tools/spirv-recarve.py` does that; `tools/spirv-content-audit.py` proves the
resulting content class.

## What the modules DO give, and it is worth having

They carry `OpEntryPoint` and `OpName`, and DPC++ mangles the **full C++ signature** into the
kernel name. So the blobs yield a genuine **interface inventory**:

**118 distinct kernel owners** across 13 modules, in 10 namespaces:

| Namespace | Kernels |
| --- | --- |
| `resampling` | `downsample_box`, `upsample_box`, `downsample_magic`, `upsample_magic`, `sharpen_magic`, `downsample_gaussian_5x5` |
| `parallel_erosion` | `erode`, `erode_level`, `flow`, `render_flow`, `shape<>`, `create_random_directions`, `LaplacianLevel::*` |
| `thermal` | `Thermal::simulation`, `LaplacianLevel::*` |
| `thermal_shaper` | `process`, `process_level`, `LaplacianLevel::*` |
| `flow` | `Flow::flow`, `fill_pits`, `process`, `LaplacianLevel::reconstruct` |
| `color_transport` | `color_transport`, `color_transport_full`, `fill_pits`, `process` |
| `lighting` | `compute_normals_and_init_photonmap`, `raytrace_ao`, `raytrace_ao_sl`, `compute_diffuse_light`, `compute_hybrid_ao`, `raytrace_shadows`, `compose_light` |
| `MeshRasterizer` | `render`, `render3`, `render3_cpu`, `process_vertices`, `process_vertices_with_displacement`, `compute_tangent_space_normals` |
| `Cellular3D` | `render` |
| `stamp_instancer` | `populate` |

Because the names are mangled signatures, each entry also states its **parameter types and
arity** — for example `flow(buffer<parallel_erosion::Particle,1,…>&, buffer<unsigned int,1,…>&,
range<1>, buffer<float,2>&, …, buffer<int,2>&, …, buffer<float,2>&, buffer<float,2>&)` — and
confirms that `Particle` is a distinct struct type passed by buffer.

That is a real finding: it is the **kernel interface**, obtained without disassembly. What it
is not is an implementation.

### The metadata does more than list names

Because SYCL encodes the kernel's `item` dimensionality into the mangled type, the metadata
also reports **how many passes a stage runs and in how many dimensions**. For
`erode_level` it enumerates exactly three lambdas:

```
RoundedRangeKernel<item<1, true>, 1, erode_level(...)::{lambda(handler&)#1}...>
RoundedRangeKernel<item<1, true>, 1, erode_level(...)::{lambda(handler&)#2}...>
RoundedRangeKernel<item<2, true>, 2, erode_level(...)::{lambda(handler&)#3}...>
```

**Two 1-D passes and one 2-D pass.** This is an independent corroboration of what the Ghidra
decompilation of `FUN_1801f1350` showed structurally — three parallel passes per iteration,
two unconditional and one gated — and it adds a detail the native side did not make obvious,
namely that two of them are 1-D. Two sources, different mechanisms, agreeing.

That is the right role for these blobs: they cannot supply an algorithm, but they can
**confirm structure** that a decompiler suggests, and they cannot be misled by calling
conventions or inlining.

## Consequence for the objective

**Kernel bodies must come from disassembling the native libraries.** There is no shortcut
through `Gaea.oneAPI.dll`. The two sources and what each yields:

| Source | Yields |
| --- | --- |
| `Gaea.oneAPI.dll` SPIR-V | 118 kernel names, full C++ signatures, namespaces, arity |
| `Gaea.Native.dll` via Ghidra | actual bodies: `ParallelErosion_Erode` and its call graph, the float constant pool, the 3×3 relaxation arithmetic |
| `Gaea.AdaptiveCpp.dll` / `HIP.dll` | not yet opened; no SPIR-V in either |

The recovered erosion work recorded in `gaea-erosion-kernel-recovered.md` is unaffected by
this correction — it came from Ghidra all along.

## Reproduce

```
python tools/spirv-recarve.py "D:/Gaea 2/Gaea.oneAPI.dll" .build/spirv2
python tools/spirv-content-audit.py .build/spirv2      # -> all "metadata only"
python tools/spirv-inventory.py .build/spirv2 --json docs/kernel-inventory-oneapi.json
python tools/spirv-symbols.py .build/spirv2/m12.spv --match resampling
```

`spirv-dis.py`, `spirv-stats.py` and `spirv-opcodes.py` remain useful for diagnosing a carve,
but note that there is nothing to disassemble in these modules — `--list` correctly reports
zero functions, and that zero is the truthful answer, not a bug.

## The lesson

The error was not the parse itself but the conclusion drawn from it. An over-long carve
produced 76 functions with convincing names, and the names matched the kernel inventory, so
the result looked corroborated. It was not: the names came from the metadata's `OpName`
records and the "bodies" came from unrelated bytes. **A carve whose end is guessed cannot be
used to claim that code exists.** Checking the census — does the module contain *any*
`OpType*` or `OpFunction` — would have settled it in one step, and that check is now a tool.
