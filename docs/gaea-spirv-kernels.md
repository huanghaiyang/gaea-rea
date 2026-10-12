# Gaea's oneAPI kernels are embedded SPIR-V

## What was found

`Gaea.oneAPI.dll` (15,393,280 bytes) contains **13 embedded SPIR-V modules**. SPIR-V is a
well-specified IR, not opaque machine code, so these are **readable kernel bodies** — and
they carry C++ symbol names from Intel's DPC++ (generator `0x6000e`).

This changes the earlier conclusion in `gaps-vs-gaea.md`. That document recorded, correctly
for the time, that the native kernels were never disassembled and that only 15 kernel
signatures were known. But `Gaea.oneAPI.dll` did not need disassembling: **Gaea's actual
particle-erosion kernels can be read out of it directly**, with names, without Ghidra.

| Module | Entry points | Content |
| --- | --- | --- |
| `module00.spv` | 12 | `thermal_shaper` (Laplacian pyramid + ThermalShaper) |
| `module01.spv` | 20 | `thermal` (Thermal simulation + LaplacianLevel) |
| **`module03.spv`** | (76 functions) | **`parallel_erosion` — Gaea's Erosion2 particle erosion** |
| `module11.spv` | — | additional `thermal` entry points |

`Gaea.AdaptiveCpp.dll` and `Gaea.Native.dll` contain **no** SPIR-V, so those two backends
still need native disassembly. The oneAPI backend does not.

## Recovered API surface

Demangled with `c++filt`. This is Gaea's own code, not inferred:

### `parallel_erosion::ParallelErosion`

| Symbol | Notes |
| --- | --- |
| `erode()` | top-level driver |
| `erode_level(LaplacianLevel*)` | **three** inner passes |
| `flow(buffer<Particle,1>&, buffer<unsigned int,1>&, range<1>, buffer<float,2>&, …, buffer<int,2>&, …, buffer<float,2>&, buffer<float,2>&)` | the particle-flow kernel; operates on a **`Particle`** array |
| `render_flow(buffer<Particle,1>&, buffer<unsigned int,1>&, …)` | splats particles into the heightfield |
| `shape<false>(…)` / `shape<true>(…)` | shaping, templated on a bool |
| `create_random_directions(unsigned int, int, queue)` | precomputed random-direction table |
| `add_atomic<float, accessor<float,2,…>>(…)` | **atomic** accumulation into a float 2-D field |
| `add_atomic<unsigned int, accessor<unsigned int,1,…>>(…)` | atomic accumulation into a uint 1-D field |
| `sample<accessor<float,2,…>>(…)` | bilinear sampler |

### `parallel_erosion::LaplacianLevel`

| Symbol | Notes |
| --- | --- |
| `LaplacianLevel(queue&, LaplacianLevel*)` | constructor takes a **parent-level pointer** |
| `init<false>()` / `init<true>()` | templated initialisation |
| `reconstruct_previous_level(Parameters const&, int)` | takes a **level index** |
| `create_subsequent_level(Parameters&)` | builds the next level |

Structs `parallel_erosion::Particle` and `parallel_erosion::Parameters` are declared in the
module, so their field layout is recoverable too.

## Function sizes (basic blocks / instructions)

Taken from the module's own function table, not estimated:

| Kernel | Labels | Instructions |
| --- | --- | --- |
| `erode_level` pass 1 (`id<2>`) | 11 | 206 |
| `erode_level` pass 2 (`id<1>`) | 1 | 91 |
| `erode_level` pass 3 (`id<1>`) | 3 | 144 |
| `render_flow` | 13 | 370 |
| `erode` | 11 | 165 |
| `shape<false>` pass A / B | 11 / 25 | 209 / 455 |
| `shape<true>` pass A / B | 25 / 11 | 618 / 209 |
| `LaplacianLevel::init<false>` / `<true>` | 1 / 1 | 156 / 192 |
| `LaplacianLevel::reconstruct_previous_level` | 16 | 404 |
| `LaplacianLevel::LaplacianLevel(queue&, parent*)` | 4 | 152 |

## Concrete differences from this build's `Erosion2`

Each of these is a real algorithmic divergence, observed in Gaea's symbols rather than
guessed. This is the roadmap to moving `Erosion2` from `model` toward `exact`:

1. **Random directions are precomputed, not drawn per step.**
   `create_random_directions(unsigned int, int, queue)` builds a direction table that
   `flow(...)` consumes. This build draws a fresh direction from an RNG at every droplet
   step. That is not a detail: a shared, fixed direction field produces visibly different
   flow organisation from per-step sampling.
2. **Erosion accumulates through atomics.**
   `add_atomic<float, accessor<float,2>>` and `add_atomic<unsigned int, accessor<unsigned int,1>>`
   mean Gaea's parallel work-items accumulate contributions order-independently. This
   build writes sequentially per droplet, so accumulation order differs.
3. **`erode_level` runs three passes**, this build runs one. Sizes 206 / 91 / 144 suggest a
   2-D pass followed by two 1-D passes — most likely a separable reduction or a second
   sweep, not three independent 2-D kernels.
4. **`shape` is far more elaborate** — up to 618 instructions against this build's single
   `applyShaping` helper, and it is templated on a bool that selects between two variants.
5. **`reconstruct_previous_level` takes a level index**, so the pyramid walk is driven by an
   explicit index rather than by array order as here.
6. **`LaplacianLevel` is a linked structure** (parent pointer in the constructor). This
   build uses a flat array of levels, which is functionally similar but not the same shape
   and would matter if a level were reused or depth varied per node.

## Why this matters more than Ghidra here

- It is the **actual implementation**, so anything read from it is ground truth, not a
  published algorithm fitted to Gaea's parameter names.
- It needs **no disassembler**, and therefore no multi-hour download: the extraction and
  demangling tools are in `tools/`.
- `Gaea.oneAPI.dll` covers the erosion kernels specifically named as the priority.

Ghidra remains the only route to `Gaea.AdaptiveCpp.dll` and `Gaea.Native.dll`. Those matter
because the backend is chosen at runtime, so a user on a non-Intel GPU runs different code.
See `ghidra-setup.md` for the state of that.

## Reproduce

```bash
python tools/extract_spirv.py "D:/Gaea 2/Gaea.oneAPI.dll" .build/spirv   # 13 modules
python tools/spirv-report.py .build/spirv/module03.spv --calls           # functions + call graph
python tools/spirv-symbols.py .build/spirv/module03.spv --match parallel_erosion
```

`tools/spirv-symbols.py` demangles through `c++filt` and reports the API surface grouped by
namespace. It reports raw names rather than guessing if no demangler is present.

## Limitations stated plainly

- This is **static** reading of an IR. It shows what the kernels *are*, not what they
  produce at runtime.
- SPIR-V instruction-level bodies are not yet decoded into C-like pseudocode here; what is
  established is the API surface, symbol set, struct declarations and function sizes.
- The modules are DPC++ output for the **oneAPI backend only**. Behaviour under
  `AdaptiveCpp` is not covered by this evidence and must not be assumed identical.
