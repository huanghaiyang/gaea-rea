# Reading Gaea's native code: two kinds of kernel, two strategies

After fifteen rounds of reading `Gaea.Native.dll` this is the most useful thing learned about
the codebase itself, and it changes how the remaining work should be approached.

## The two kinds

| | Scalar reference kernels | SIMD hot kernels |
| --- | --- | --- |
| Example | the nine erosion passes (`FUN_1801f0c60`, `FUN_1801f35f0`, …) | `FastBlur`'s inner box (`FUN_18000fc90`) |
| Size | 110 B – 1.6 KB each | **23 KB, 4,600 instructions** |
| Cyclomatic complexity | 30 – 35 | **83** |
| Decompiles to | readable arithmetic with named constants | thousands of `local_XX[16]` shuffles |
| What it is | the algorithm | the algorithm, vectorised and unrolled |

**The readable ones are readable because they are scalar.** The erosion reconstruction worked
because those nine passes are not vectorised — they are per-pixel loops with straightforward
arithmetic. Gaea keeps them scalar even in the native backend.

**The blur is the opposite.** `FUN_18000fc90` is one box filter, hand-unrolled across three
runtime-selected SIMD feature levels, and no amount of decompilation will state it more
clearly than "a normalised window sum". Reading it is not a good use of effort.

## Runtime SIMD dispatch

`FUN_180001210` is not a kernel at all; it is a feature-level dispatcher:

```c
if (DAT_1803fc000 < 2) abort();
else if (DAT_1803fc000 < 4) FUN_18001bc70(...);   // SSE
else if (DAT_1803fc000 < 6) FUN_18000fc00(...);   // AVX2
else                        FUN_1800035c0(...);   // AVX-512
```

Two consequences:

1. **Reading one variant is enough** for the algorithm. The others must be numerically
   equivalent or the build would produce different images on different CPUs.
2. **There is a second split by radius.** `FUN_18001bc70` compares against
   `0x18035637c` = **32.0** and calls either `FUN_18000fc90` (small radii) or
   `FUN_180015800` (large). The reason is efficiency — a direct window for small radii, a
   different scheme for large — not a different filter.

## The strategy that follows

**For scalar kernels: read the body.** That is where the algorithm is.

**For SIMD kernels: read the structure, not the body.** Every algorithmic decision lives
outside the vector loop:

- the dispatch and its thresholds
- the iteration count and what drives it
- the parameter derivation — for FastBlur, `FUN_180048880` turned out to be a plain `min()`,
  giving the radius cap `min(requested, w/2 - 1, h/2 - 1)`
- the buffer pairing, which reveals separability

That is enough to reimplement the filter faithfully, and it is honest to label the result
`approx` rather than `exact`, because the summation order inside the SIMD body is not
reproduced.

## What this yielded: `FastBlur`

Gaea's blur is **an iterated separable box filter**, not a Gaussian:

```
radius = min(requestedRadius, width/2 - 1, height/2 - 1)
for (i = 0; i < iterations; i++) { horizontalBox(radius); verticalBox(radius); }
```

with the iteration count in the caller's fourth rect field and a fixed tile height of 16 in
the parallel dispatch.

**This build used a true Gaussian.** Iterating a box converges towards a Gaussian but is not
one: at one or two iterations the kernel is visibly flatter in the centre and sharper at the
edge. Substituting a Gaussian changes the image in a way a user would see as "this build's
Blur looks different", so Gaea's own form is now implemented as `gaeaFastBlur`.

The replacement is verified by the property that distinguishes the two filters rather than by
resemblance: **one pass turns an impulse into a UNIFORM `(2r+1)²` block**, with finite
support, and a Gaussian — whose weights are never equal across the window — cannot do either.
Twelve assertions cover that, the radius cap, conservation, separability, symmetry, the
identity cases, and monotone variance reduction across iterations.

## Where this leaves the objective

The knowledge that scalar kernels are readable and SIMD ones are not is what makes the
remaining 117 kernels triageable: the ones with scalar bodies are worth reading, and the ones
that are pure SIMD are worth mapping structurally and labelling `approx`.

The 20 named exports in `Gaea.Native.dll` are the place to start, because each is a node entry
point with a small wrapper whose body is scalar and whose callees can be classified quickly:

```
FastBlur_Process · FastBlur4_Process · HydrologicalCorrection · Lake_Create
MathX_Compute · MathX_Function · Rivers · ShadeIspc · SunLightIntegralIspc
MeshPort_{Load,Save,Destroy,HeightmapToMesh,HeightmapToMeshWithAdaptiveSubdivision,
          PointCloudToMesh,TrianglesToMesh,SavePointCloud}
```
