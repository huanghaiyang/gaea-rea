# Gaea 2.0 engine execution model

Reverse-engineered from `D:\Gaea 2\Gaea.Engine.dll` (not obfuscated, decompiles
cleanly) with supporting evidence from `Gaea.dll`. Every claim is tagged:

- **observed** — a declaration or body read from decompiled metadata
- **inferred** — reasoning about behaviour not directly readable
- **unknown** — could not be established with the evidence available

Decompiled sources are under `evidence/decompiled/engine/`; the member-level
inventory is `evidence/decompiled/Engine.Node.members.txt`.

## Component map

| Type | Namespace | Role |
| --- | --- | --- |
| `Node` | `QuadSpinner.Gaea.Engine.Fx` | Graph node: identity, ports, parameters, lifecycle hooks |
| `Port` | `QuadSpinner.Gaea.Engine.Fx` | One named input or output socket, with a `Connection` |
| `PortType` | `QuadSpinner.Gaea.Engine.Fx` | `[Flags]` enum describing port direction and traits |
| `Connection` / `ConnectionRecord` | `QuadSpinner.Gaea.Engine.Fx` | Edge between an output and an input |
| `Map` | `QuadSpinner.Gaea.Engine.Fx` | Multi-channel terrain buffer (the value passed between nodes) |
| `Channel` | `QuadSpinner.Gaea.Engine.Fx` | Single `float[]` plane at a `Resolution` |
| `Map._RGB` | `QuadSpinner.Gaea.Engine.Fx` | Three-float colour plane |
| `NodeMetadata` | `QuadSpinner.Gaea.Engine.Fx` | Static per-node-type descriptor |
| `BuildContext` | `QuadSpinner.Gaea.Engine.Fx` | `Resolution` + `CacheClusters` + `Bucket` for one build |
| `BuildDefinition` | `QuadSpinner.Gaea.Engine.Fx` | User build settings (tiling, resolution, destination) |
| `NodeState`, `NodeCacheStatus`, `ExportState`, `StateOverride`, `RenderIntent` | `QuadSpinner.Gaea.Engine.Fx` | Lifecycle and cache enums |
| `Cache`, `CacheOptions`, `CacheKeyBuilder` | `QuadSpinner.Gaea.*` | Content-addressed node cache |

*(observed: type names and namespaces from decompiled declarations)*

## The node lifecycle

`Node` exposes explicit lifecycle hooks, in the order the engine appears to call
them. Ordering is **inferred** from naming plus how the bodies reference state;
the individual method existence is **observed**.

```
1. Reconstruct()        rebuild transient state after deserialisation
2. UpdateUI()           refresh VisibilityTable / EnableTable from parameters
3. CheckValidity()      return human-readable validation errors
4. Build()              node-specific; calls the algorithm, then Commit(...)
5. ApplyModifiers()     run attached Modifiers over the produced Map
6. PostBuild(export)    post-processing; may trigger Export(...)
7. OnSaving()           serialisation hook
```

`Migrate()` exists to upgrade older serialised nodes — **observed** method,
migration rules themselves were not enumerated.

### How a node produces a value

Decompiled `QuadSpinner.Gaea.Nodes.MultiFractal` shows the exact shape of a
generator node (**observed**):

```csharp
internal override void Build()
{
    Map map = Noises.MultiFractal(base.context.Resolution, NoiseType, AutoOctaves,
        Octaves, Size, FeatureSize, FractalGain, EdgeSmoothing, Seed, VariationType,
        Variation, Smoothness, VariationContrast, Damping, Bias, Perturb,
        RelativeWarpSize, WarpStrength, WarpComplexity, WarpRoughness, WarpAttenuation,
        WarpIterations, Anisotropy, RelativeWarpAnisotropy, Rotation,
        new Vector2(OffsetX, OffsetY), new Vector2(6, 0), new Vector2(8, 6));

    if (base.In.IsConnected)
    {
        map *= base.In.<something>();   // blend with the connected input
    }
    Commit(map, true, true);
}
```

Four things this establishes:

1. **Deterministic node identity** — `Build()` is the algorithm entry point, one
   override per node type.
2. **Parameters are passed positionally** to a static algorithm facade (`Noises.*`),
   not mutated on shared state.
3. **Input blending is explicit** — an unconnected input is simply skipped
   (`if (base.In.IsConnected)`), which is why the same node works with and
   without an upstream graph.
4. **`Commit(Map, allowMasking, clamp)`** publishes the result to the node's
   output ports.

`BuildContext` supplies the resolution for the current build, so a node is
resolution-agnostic: it asks `base.context.Resolution` rather than storing one.

*(observed: decompiled method body; the two unnamed `Vector2` arguments are
constants whose meaning is **unknown** — they are passed to the noise generator
but not derived from parameters)*

## Ports and connections

`Port` carries `Name`, `DisplayName`, `Accumulator`, `Type`, `Order`,
`Connection`, `Record`, `IsExporting`, `Parent`, `PortalState`, `RenderIntent`.
*(observed)*

`PortType` is a `[Flags]` enum, so a port can be several things at once:

| Flag | Value | Meaning |
| --- | --- | --- |
| `In` | 1 | accepts upstream input |
| `Out` | 2 | produces output |
| `Primary` | 4 | the node's main port |
| `Required` | 8 | must be connected for a valid build |
| `Agnostic` | 0x10 | accepts any channel kind |
| `Collapsed` | 0x20 | drawn collapsed in the graph |
| `PostProcess` | 0x40 | output produced during post-processing |
| `CollapsedOut` | 0x22 | `Out \| Collapsed` |
| `CollapsedIN` | 0x21 | `In \| Collapsed` |
| `PrimaryIn` | 5 | `In \| Primary` |
| `PrimaryOut` | 0x46 | `Out \| Primary \| PostProcess` |

*(observed: enum values. `PrimaryOut` including `PostProcess` suggests primary
outputs are written in the post-build phase — **inferred**.)*

### Connectivity semantics

`Port.IsConnected` is direction-dependent (**observed**):

```csharp
public bool IsConnected
{
    get
    {
        if (Type.HasFlag(PortType.In))
            return Connection?.Target?.Parent != null;          // pull from upstream
        return <node registry>.Any(node => node.Ins.Any(p => p.Connection?.Target == this));
    }
}
```

An **input** is connected when it holds a `Connection` whose target has a parent
node. An **output** is connected when *some* node's input points back at it. This
is a directed acyclic graph with a single edge object stored on the consuming
(input) side, which is why output connectivity must be discovered by search.

### Portals

`PortalState` (`None`, `Consuming`, `Publishing`, `Portal`) lets a node publish a
value under a name and another node consume it without a direct edge. `Node`
also exposes `Ins`, `Outs`, and `Exportables` derived from `Ports`.
*(observed)*

## The `Map` data structure

`Map` is the universal inter-node value: a container of **named channels**, each a
`Channel` holding a `float[]` plus a `Resolution`. *(observed from
`Fx.Map.cs`)*

| Member | Signature | Purpose |
| --- | --- | --- |
| `Channel` | `class Channel : IDisposable` | one `float[]` plane at a resolution |
| `Channel.this[x, y]` | `float` | element access |
| `Channel.InterpolateBilinear(Vector2, EdgeBehaviour)` | `float` | filtered sampling for warps and remaps |
| `Channel.AtomicAdd(x, y, value)` | `float` | race-free accumulation across threads |
| `Channel.ToArray()` | `float[]` | extraction |
| `Map.this[x, y]` | `float` | default channel element access |
| `Map` colour plane | `class _RGB` with `Color this[x, y]` | three floats for colour channels |
| `Map.Allocate(minimumLength)` | `static float[]` | pooled backing arrays |
| `Map.CalculateChunks(resX, resY)` | `(int chunks, int chunkLength)` | tiled processing |
| `Map.MaxNumberOfChannels(params Map[])` | `static int` | channel-count reconciliation |
| floating-point helpers | `CalculateEpsilon/SafeRatio/AlmostEqual` | numerically safe arithmetic |

Two design consequences matter for a reimplementation:

- **`AtomicAdd` implies parallel writes.** An erosion pass accumulates into
  shared buffers from multiple threads, so the channel type must tolerate
  unordered accumulation (or an ordered reduction must reproduce it).
- **`Allocate`/`Return` pooling** with `CalculateChunks` indicates work is split
  into rectangular chunks with reused buffers, not one allocation per pass.

Channel identity is a **name** (height, mask, colour, flow, …), which is how a
single node can emit several outputs and how `Accumulator` can sweep "all
available nodes" for a map type. The exact channel-name vocabulary was not
enumerated — **unknown**.

`Map` arithmetic is overloaded (`map *= mask` in the `MultiFractal` body), so
blending is expressed as operator application rather than explicit per-pixel loops.

## Cache, parity, and invalidation

| Mechanism | Evidence | Role |
| --- | --- | --- |
| `Node.CacheStatus` (`NodeCacheStatus`) | `Fx.Node.cs` | current cache state of the node's output |
| `CacheKeyAttribute`, `CacheKeyBuilder` | `Util.CacheKey.cs` | build a cache key from marked members |
| `Node.Parity` / `LastParity` / `GetParityString()` / `UpdateParity()` | `Fx.Node.cs` | fingerprint of the inputs that affect the result |
| `Node.Thumbprint` (`Guid`) | `Fx.Node.cs` | identity of the produced artefact |
| `Node.Dictionary _p` | `Fx.Node.cs` | cached parameter values (guessed purpose) |
| `Context.Cluster` (`CacheClusters`), `Context.Tile` (`Bucket`) | `Fx.Build.cs` | cache partitioning by cluster and tile |

**Inferred mechanism:** `UpdateParity()` computes a fingerprint over the
node's parameters *and* the parity of its connected inputs. If the new parity
matches the stored one, the cached output is reused; otherwise the node rebuilds.
`CacheKeyBuilder` exists because not every field should participate in the key —
`[CacheKey]` marks the ones that should.

`CacheClusters` and `Bucket` extend this to partial builds: caching can be scoped
to a region, so changing one corner of a tiled terrain does not invalidate the
whole graph. `BuildDefinition.PreserveTiledCache` supports that workflow.

*(observed: type and member existence. The exact hash composition and cluster
semantics were not established — `unknown`.)*

## Build settings and tiling

`BuildDefinition` is the user-facing build configuration (**observed** fields):

| Field | Type | Note |
| --- | --- | --- |
| `Type` | `BuildType` | build mode |
| `Portion` | `WorldPortion` | which part of the world |
| `Destination` | `string` | output path |
| `OverwriteMode` | `OverwriteMode` | collision policy |
| `Subdivision` | `HybridSubdivision` | mesh subdivision |
| `Resolution` | `int` | main build resolution |
| `BakeResolution` | `int` | bake resolution |
| `TileResolution` | `int` | per-tile resolution |
| `BucketResolution` | `int` | bucket size for streaming |
| `OutputType` | `OutputType` | target format |
| `NumberOfTiles` | `int` | tiling grid width |
| `PreserveTiledCache` | `bool` | reuse per-tile cache |
| `EdgeBlending` | `float` | seam blending between tiles |
| `FlipY` | `bool` | vertical orientation |
| `OverlappingPixels` | `int` | tile overlap for seamless continuation |
| `TilePadDigits`, `TileZeroIndex`, `TilePattern` | mixed | filename construction |
| `OrganizeFiles` | `OrganizeFiles` | output directory layout |

The presence of `TileResolution`, `BucketResolution`, `OverlappingPixels`, and
`EdgeBlending` together establishes that Gaea builds large terrains as a grid of
independently computed tiles with deliberate overlap and post-hoc seam blending.
That is the single most important architectural fact for a reimplementation that
must handle resolutions larger than one texture.

`BuildReport` (7 fields / 10 properties) and `BuildResult` / `BuildContext`
provide the outcome record.

## Serialisation

`Node` is `[Serializable]` and drives JSON through Newtonsoft, with explicit
control:

- `OnSaving()` hook
- `ShouldSerializeThumbprint()` and `Port.ShouldSerializeConnection()` — selective
  emission, so an unconnected port writes no connection
- `Reconstruct()` and `Migrate()` to rebuild transient state and upgrade old files
- `SaveDefinition` / `SaveDefinitions` to declare what gets persisted
- `Port.Record` (`ConnectionRecord`) to persist an edge target without a live
  object reference
- `[JsonIgnore]` on derived members such as `Port.Order`, `Port.IsRequired`,
  `Port.WillPostProcess`, `Port.IsConnected`, `Port.IsPortal`

*(observed)*

A `.gaea` project therefore stores nodes with their parameter dictionaries, their
port records, and layout metadata (`Position`, `IsExpanded`, `Group`, `IsLocked`)
— enough to reconstruct the graph without storing computed terrain, which is
regenerated from the cache or by rebuilding.

## Build flow

Reconstructed from the members above; the **sequence** is inferred, the
**existence** of each step is observed.

```
open .gaea
   |
   v
deserialise nodes + ports          Node.Reconstruct() per node
   |
   v
resolve connections                Port.Record -> Port.Connection
   |
   v
refresh derived UI state           Node.UpdateUI()  (VisibilityTable/EnableTable)
   |
   v
validate                           Node.CheckValidity()
   |
   v
order the graph                    BuildOrder (topological)
   |
   +--> for each node:
   |      parity = UpdateParity()
   |      if parity unchanged and CacheStatus valid:
   |          reuse Thumbprint artefact        <-- cache hit
   |      else:
   |          Node.Build()  -> algorithm(Map, params...)
   |          Node.ApplyModifiers()
   |          Node.Commit(Map, allowMasking, clamp)
   |          Node.PostBuild(export)
   |
   v
tile/bucket assembly               BuildDefinition tiling + EdgeBlending
   |
   v
Node.Export(map, filename, port, extraObjects)
```

`CacheClusters` and `Bucket` allow the loop to run per region rather than over the
whole terrain, and `BuildDefinition.PreserveTiledCache` keeps per-tile results
between runs.

## Implications for a web reimplementation

1. **`Map` is multi-channel and named.** A single-field design cannot express a
   node that emits height, mask, and flow simultaneously.
2. **Tiles are first-class.** Overlap plus edge blending is architectural, not an
   afterthought; resolution above one texture requires it.
3. **Unconnected inputs are normal.** Algorithms must accept absent inputs rather
   than requiring a full graph.
4. **Caching is parity-based and per-node.** Recomputing only the affected
   subgraph is a design requirement, not an optimisation.
5. **Ports carry intent.** `RenderIntent` and `PortType` mean an edge can request
   a specific interpretation (height vs mask vs colour) of the same output.

## Gaps

- Channel-name vocabulary and the exact `Map` channel enumeration: **unknown**
- Cache-key hash composition and cluster partitioning rules: **unknown**
- `BuildOrder` assignment algorithm (topological sort location): **unknown**
- Purpose of `Node.r1`–`r4` and `Node._p`: **unknown**
- The two unnamed `Vector2` constants in `MultiFractal.Build`: **unknown**
- `Migrate()` upgrade rules across Gaea versions: **unknown**
