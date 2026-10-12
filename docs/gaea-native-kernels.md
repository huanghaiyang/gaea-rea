# Gaea's native kernels (Ghidra)

This is the counterpart to `gaea-spirv-kernels.md`. The oneAPI backend yields its kernels
as readable SPIR-V; the `Native` and `AdaptiveCpp` backends do not, and they are what this
document covers.

## Setup that was required

Ghidra was already present as an unbuilt 12.3 DEV source checkout at `D:\sgames\ghidra`.
A released **12.1.4** distribution at `D:\ghidra_12.1.4_PUBLIC` is the one in use.

| Requirement | State found | Resolution |
| --- | --- | --- |
| Ghidra release | only unbuilt source | used `D:\ghidra_12.1.4_PUBLIC` |
| `dsh-ghidra` plugin | absent | installed; config reloaded by disabling and re-enabling the plugin |
| JDK | JAVA_HOME pointed at JDK 11; Ghidra 12.1.4 requires 21+ | installed Temurin **JDK 25** at `D:\tools\jdk-25` |
| Python for PyGhidra | PATH `python` was MSYS2's, whose platform tag matches no `jpype1` wheel | used Anaconda's native Windows **3.11.4**, `pythonVer: "3.11"` |
| `pyghidra` | absent; PyPI unreachable | `pip install` via the aliyun mirror |

Two traps worth recording, because both produced misleading symptoms:

- **The plugin caches its config at load.** Editing `cordis.patch.yml` had no effect until
  the plugin was disabled and re-enabled (`plugin_manager set_plugin` on
  `include:ghidra-bridge`). Before that, `ghidra_status` reported no Ghidra while a direct
  call to the plugin's own `detectGhidraHome({})` found it.
- **`JAVA_HOME` cannot be fixed from inside the running DSH process.** The plugin's
  `envFor()` spreads `process.env` and has no `javaHome` config field, so the JDK 11 value
  was inherited and Ghidra refused to start. The supported escape hatch is
  `support/launch.properties` → `JAVA_HOME_OVERRIDE`, which pins the JDK regardless of the
  environment. PowerShell's `Set-Content -Encoding utf8` writes a BOM that breaks Ghidra's
  properties parser, so the file must be written as UTF-8 **without** a BOM.

## `Gaea.Native.dll` — 8,105 functions, not stripped

`ghidra_open` on the 4.6 MB image yields **8,105 functions and 78,807 symbols**, with named
exports that expose the kernel API directly:

```
ParallelErosion_Erode          <- Gaea's particle erosion
HydrologicalCorrection         Rivers                Lake_Create
FastBlur_Process               FastBlur4_Process
ShadeIspc                      SunLightIntegralIspc   <- ISPC
MeshPort_HeightmapToMesh       MeshPort_HeightmapToMeshWithAdaptiveSubdivision
MeshPort_PointCloudToMesh      MeshPort_TrianglesToMesh
MeshPort_Load / Save / SavePointCloud / Destroy
MathX_Compute / MathX_Function / MathX_FreeErrorMessage
```

Note `MeshPort_HeightmapToMeshWithAdaptiveSubdivision` — the mesh path this build
approximates. And `ShadeIspc` / `SunLightIntegralIspc` are Intel ISPC kernels, so a
faithful reproduction of Gaea's *shading* is also within reach, not just its erosion.

## `ParallelErosion_Erode` @ `0x18003cfe0`

925 bytes. It is the **allocator and dispatcher**, not the algorithm:

- `allocSize = width * height * 0x50` — so **`Particle` is 80 bytes** per cell.
  A floor of `0x4000000` (64 MB) is applied.
- Memory is obtained through a **function-pointer table** in `param_8[0..7]`, stored into
  globals `PTR_FUN_1803fc6a0` … `PTR_FUN_1803fc6d8`. Gaea's native kernels take their
  allocator and free/memset hooks from the caller rather than linking the CRT directly.
- It then calls, in order: `FUN_18003b720` (parameters), `FUN_18003bc90` (level
  construction), `FUN_18003e3d0`, and **`FUN_1801f24f0` (the erosion worker)**.

## The erosion worker `FUN_1801f24f0`

1,737 bytes, 393 instructions, 48 basic blocks, cyclomatic complexity 30. Called directly
from `ParallelErosion_Erode`.

**It imports `log2f` and `tanf`.** That is the pyramid depth being derived from the image
size — confirming independently what this build does with `pyramidLevelsFor()` — and a
tangent, i.e. an angle computation for droplet direction.

Its largest callee is `FUN_1801f1350` at **2,936 bytes**, which is the best candidate for
the core droplet loop. The others are 233–1,033 bytes each.

### Recovered floating-point constants

`function_context` decodes the literal pool this function references. These are the
**actual tunable constants of Gaea's erosion**, which the earlier gap report listed as
unrecoverable because Eazfuscator had encrypted the managed constant pool — they are
simply present, in the clear, in the native image:

| Literal | Value | Reading |
| --- | --- | --- |
| `0x43340000` | **180.0** | with the π below: degrees ↔ radians |
| `0x40490fdb` | **3.1415927** | π |
| `0x3e2aaaab` | **0.16666667** | 1/6 |
| `0x3e4ccccd` | **0.2** | |
| `0x3f400000` | **0.75** | |
| `0x40c00000` | **6.0** | |
| `0x40200000` | **2.5** | |
| `0x42c80000` | **100.0** | |
| `0x3a83126f` | **0.001** | |
| `0x3f000000` | **0.5** | |
| `0x3f800000` | **1.0** | |

The 180/π pair sitting next to `tanf` is consistent with droplet headings being computed as
angles; 1/6 and 0.001 look like step and epsilon terms. Pinning each to a parameter still
requires reading the code around it, which is the next step rather than a conclusion.

## Method and limits

- Everything above is **static** reading of a shipped artifact. Nothing was executed.
- Names are Ghidra's; `FUN_*` means the internal symbol was not exported. The 78,807
  symbols are heavily weighted to data and strings, so unnamed code is expected.
- Constant identification is by value, and the "reading" column is interpretation, not
  established fact. The *values* are observed.
- `Gaea.AdaptiveCpp.dll` (28 MB) and `Gaea.AdaptiveCpp.HIP.dll` (38 MB) have not been
  opened yet. Since the backend is chosen at runtime, parity on a non-Intel GPU depends on
  those, and nothing here may be assumed to carry over.
