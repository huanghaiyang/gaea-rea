# Where each node's algorithm actually lives

The single most useful routing fact for the remaining work. Up to this round I had been
looking for every node in `Gaea.Native.dll`, which is right for a handful of them and wrong
for most.

## The census

`evidence/decompiled/Gaea.Nodes.whole.cs` is the decompiled managed assembly — 66,177 lines.
It contains **195 `Node` subclasses** and its methods are the real per-node implementations.

| Where | How to read it | Roughly how many nodes |
| --- | --- | --- |
| `Gaea.Native.dll` exports | Ghidra, scalar functions are readable | **20 exports**, of which ~8 are node entries |
| Managed `Gaea.Nodes.whole.cs` | already decompiled, plain C# structure | the bulk of the catalogue |
| SPIR-V in `Gaea.oneAPI.dll` | **metadata only — no bodies** | names and signatures, not algorithms |
| ImageMagick (inside the managed layer) | published deterministic formulas | ~20–25 nodes |

**43 references to `MagickImage`** in the managed source, using `Normalize` (20), `Resize`
(25), `Blur` (5), `GammaCorrect` (1), `AutoGamma` (1), `Threshold` (1), `Negate` (1).

## Why this matters

`Gaea.Native.dll` exports 20 symbols. **None of them is a gamma, blur, resize or normalize
kernel**, because those algorithms are not Gaea's — they belong to ImageMagick and ship in the
managed layer. Searching the native libraries for them is a dead end that would consume rounds
without producing anything.

`Gamma` is the clearest case. Its entire `Build()` is:

```csharp
Map map = base.In.Heightmap();
MagickImage magickImage = <copy>(map);
if (map.NumberOfChannels > 1) RenderAsColor(true); else RenderAsHeightfield(true);
if (Automatic) magickImage.AutoGamma();
else           magickImage.GammaCorrect(GammaValue);
Commit(<toMap>(magickImage), true, true);
```

## The two cross-checks that make this trustworthy

**1. The parameter metadata agrees across two independent artefacts.** The managed source
carries

```csharp
[Parameter(0.44f, 0f, 4f)] [Name("Gamma")] public float GammaValue
```

and the catalogue independently reports `ilDefault = 0.44, ilMin = 0, ilMax = 4`. A build that
guessed a 0..1 range — which is what this one had been doing for several nodes — would be
wrong in a way no smoke test would catch.

**2. `AutoGamma` has a defining property, so it can be tested rather than eyeballed.** The
operation chooses the gamma that puts the image mean at mid-grey:

```
g = log(mean) / log(0.5)          so that     pow(mean, 1/g) == 0.5
```

The test asserts that identity at eight different means, and separately that a mean of 0.25
gives exactly gamma 2 — which is a check on the whole derivation, not on the code's shape.

## What was implemented

`web/js/kernels/imaging.js` — `magickGammaCorrect`, `magickGammaForMean`, `magickAutoGamma`,
and the `Gamma` node, registered in the registry so it is no longer catalog-only.
44 assertions in `gaea-imaging-test.mjs`.

Fidelity `exact` **on the formula**: `pow(v, 1/gamma)` and `log(mean)/log(0.5)` are published
and deterministic on the normalised 0..1 values this app uses. The label would drop to
`approx` if ImageMagick's quantisation or its internal lookup table were being reproduced —
they are not, because this app works in floats throughout.

### The direction that is easy to invert

`GammaCorrect(g)` raises samples to `1/g`. With `gamma > 1` the exponent is *below* 1, which
**raises** midtones. Inverting the reciprocal produces the opposite look, so the tests assert
the direction rather than leaving it to inspection — the same failure mode the discharge-angle
clamp had, where a plausible-looking formula is right in shape and wrong in sign.

## Revised strategy for the remaining nodes

Read the managed source first. It is already decompiled, its parameter attributes are
authoritative, and for the ImageMagick-backed nodes the operation name is the whole algorithm.
Reach for Ghidra only when a node's `Build()` calls into something the managed layer does not
implement — which is exactly the ~8 native node entries plus the erosion pipeline.

This turns the remaining ~130 nodes from "each needs a Ghidra session" into "most need a read
of a C# method and a lookup of a published formula".
