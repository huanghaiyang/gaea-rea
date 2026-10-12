# Gaea 2.3.1 节点参考库（182 节点全量）

本文件由 `tools/catalog/build_docs.py` 自动生成，数据来源有两个，均属**观察所得**：

| 来源 | 路径 | 提供内容 |
|---|---|---|
| 节点目录 | `D:\Gaea 2\Resources\Nodes.json`（UTF-8，420,649 字节） | 节点名、说明、参数树、枚举成员 |
| 实现程序集 | `D:\Gaea 2\Gaea.Nodes.dll` | 实现类、`[Toolbox]` 分类、`[Group]` 分组、`[Parameter]` 默认值/范围、属性类型 |
| 属性定义 | `D:\Gaea 2\Gaea.Engine.dll` | `ToolboxAttribute`/`ParameterAttribute`/`GroupAttribute`/`NodeCategory`/`PortType` 的定义 |

反编译方式：ICSharpCode.Decompiler 9.1.0，经 `tools/GaeaDump`（`whole` 模式）导出整模块 C#（4,002,700 字节）。

> 复现说明：`tools/GaeaDump/Program.cs` 中已含 `whole` 模式，但仓库里已编译的 
> `tools/GaeaDump/bin/Release/net8.0/GaeaDump.exe` 早于该模式（调用会报 `unknown mode: whole`）。
> 本项目未覆盖原二进制，而是另建到 `tools/GaeaDump/bin/Whole/`：
> `dotnet build tools/GaeaDump/GaeaDump.csproj -c Release -o tools/GaeaDump/bin/Whole --no-restore`。
> 该工程直接 `Reference` 本地 Trae 扩展内的 `ICSharpCode.Decompiler.dll`，无需联网还原包。

另需注意：`GaeaDump` 的 `dump`/`whole` 模式把反编译文本写在 **stdout**，进度写在 stderr；
而 `memb` 的字段行在关键字后有**两个空格**（`field  Int32 value__`），解析时须用正则而非按单空格切分。

> **关于本表中"推断"的边界**：节点名、说明、参数名、参数类型、枚举成员、默认值、范围、分组、分类全部来自上述文件，属观察结果。
> 唯一属于推断的是 **`参数 → C# 属性` 的配对**（Nodes.json 不记录属性名，需按显示名/分组归一化匹配）以及 **端口方向**（`PortType` 取值被混淆，见 `nodes-crosscheck.md`）。

## 目录

- [Primitive（23）](#primitive)
- [Terrain（14）](#terrain)
- [Modify（40）](#modify)
- [Surface（21）](#surface)
- [Simulate（25）](#simulate)
- [Derive（14）](#derive)
- [Colorize（13）](#colorize)
- [Output（12）](#output)
- [Utility（20）](#utility)

合计 **182** 个节点、**1341** 个顶层条目（1215 个真实参数 + 126 个 UI 分组标题）、**1238** 个实现属性。

---

## Primitive

*地形基元：噪声与基础形状生成器* — `NodeCategory.Primitive`，共 23 个节点。

### Cellular

`QuadSpinner.Gaea.Nodes.Cellular` · Family `Extended` · Classification `Generator` · ShortCode `ll` · Keywords `cellular`

> Cellular creates cell-based patterns and noises that can be quite versatile as they're ever-present in nature.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `0.25f`，范围 0f … 1f | Controls the overall scale of the cellular pattern. Higher values produce smaller cells (finer detail); lower values produce larger cells (coarser detail). |
| Density | Int32 `int` | `1`，范围 0 … 10 | Controls how many feature points are generated per area. Higher density creates more, smaller cells; lower density creates fewer, larger cells. |
| Jitter | Single `float` | `1f`，范围 0f … 1f | Randomizes feature-point placement. Low values are more uniform/structured; higher values create more organic, irregular cells. |
| Metric Morph | Single `float` | `1f`，范围 0f … 1f | Blends between the paired distance behaviors implied by the selected Distance Metric (e.g., Euclidian ↔ Manhattan/Chebyshev), changing cell geometry continuously. |
| Distance Metric | Enum `DistanceMetric` | `DistanceMetric.Euclidian_Chebyshev`，范围 0f … 1f | `Euclidian_Manhattan` — Morph between rounded Euclidian cells and diamond-like Manhattan cells (axis-aligned, sharper corners) using Metric Morph.<br>`Euclidian_Chebyshev` — Morph between rounded Euclidian cells and square-like Chebyshev cells using Metric Morph.<br>`Minkowski` — Generalized metric that spans a continuous family of distance shapes (useful for smoothly varying from rounded to more boxy forms). |
| Coordinate Axes Jitter | Single `float` | `1f`，范围 0f … 1f | Adds jitter in coordinate/axis space before evaluation, warping the field and introducing directional wobble and boundary distortion. |
| CAJ Clustering | Single `float` | `1f`，范围 1f … 5f | Controls how Coordinate Axes Jitter groups together. Low values spread distortion evenly; higher values create patchy/clumped distortion regions. |
| Anisotropy | Single `float` | `0f`，范围 0f … 1f | Stretches the pattern directionally, producing elongated/elliptical cells and emphasizing a dominant direction. |
| Distance Function | Enum `DistanceFunction` | `DistanceFunction.Hash`，范围 0f … 1f | `Hash` — Outputs a stable random value per cell region (cell ID-style mask), useful for random patching, selection, and variation.<br>`DistanceInv` — Outputs inverse distance to the nearest feature point (bright centers fading toward borders).<br>`Distance2Inv` — Outputs inverse distance to the second-nearest feature point, producing a different internal falloff useful for variation and breakup.<br>`DistanceDiff` — Outputs the difference between nearest distances (classic Voronoi edge emphasis), great for ridges, veins, and cell borders.<br>`DistanceToEdge` — Outputs distance to the nearest cell border, ideal for crack networks and edge masks when remapped. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Changes the random distribution of feature points without changing other settings. |

### Cellular3D

`QuadSpinner.Gaea.Nodes.Cellular3D` · Family `Extended` · Classification `Generator` · ShortCode `c3`

> Generates three-dimensional cellular noise useful for volumetric-looking patterns and complex terrain breakup.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `0.1f`，范围 0.0001f … 0.5f | Controls the overall scale of the 3D cellular pattern. Higher values produce larger, more widely spaced cells. |
| Gap | Single `float` | `0f`，范围 0f … 0.5f | Sets the distance or separation between individual cells, affecting the openness and density of the pattern. |
| Jitter X | Single `float` | `1f`，范围 0f … 1f | Applies random offset to cell positions along the X axis, introducing irregularity and breaking uniformity. |
| Jitter Y | Single `float` | `1f`，范围 0f … 1f | Applies random offset to cell positions along the Y axis, adding variation and natural randomness. |
| Jitter Z | Single `float` | `1f`，范围 0f … 1f | Applies random offset to cell positions along the Z axis, further enhancing the organic appearance of the 3D pattern. |
| Scale X | Single `float` | `1f`，范围 0.1f … 10f | Adjusts the scale of the cellular pattern along the X axis, stretching or compressing cells horizontally. |
| Scale Y | Single `float` | `1f`，范围 0.1f … 10f | Adjusts the scale of the cellular pattern along the Y axis, stretching or compressing cells vertically. |
| Scale Z | Single `float` | `1f`，范围 0.1f … 10f | Adjusts the scale of the cellular pattern along the Z axis, stretching or compressing cells in depth. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for generating unique variations of the 3D cellular pattern. Changing the seed produces different cell arrangements. |
| Normalize Input | Boolean `bool` | `false`，范围 0f … 1f | If enabled, normalizes the input values to a standard range before applying the cellular pattern, ensuring consistent results regardless of input scale. |

### Cone

`QuadSpinner.Gaea.Nodes.Cone` · Family `Gradient` · Classification `Generator` · ShortCode `con`

> Generates a simple conical gradient that is useful as a primitive shape or mask.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `1f`，范围 0f … 4f | Controls the overall size (radius) of the cone. |
| Height | Single `float` | `1f`，范围 0f … 1f | Controls the height (amplitude) of the cone. |
| X | Single `float` | `0.5f`，范围 0f … 1f | Offsets the cone’s center along the X axis. |
| Y | Single `float` | `0.5f`，范围 0f … 1f | Offsets the cone’s center along the Y axis. |

### Constant

`QuadSpinner.Gaea.Nodes.Constant` · Family `Basic` · Classification `Generator` · ShortCode `k` · Keywords `constant color`

> Constant creates a blank terrain of the height specified, or a flat color output.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Constant** *(分组标题)* | — | — | `[Group]` 由 `Output`, `Height`, `Color` 声明 |
| Output | Enum `ConstantType` | `ConstantType.Height`，范围 0f … 1f | `Height` — Create a flat terrain of the specified height.<br>`Color` — Create a flat color output of the specified color. |
| Height | Single `float` | `0.5f`，范围 0f … 1f | The height of the blank terrain. |
| Color | Color `Color` | `0.5f`，范围 0f … 1f | The color to use for creating a flat, color output. |

### Cracks

`QuadSpinner.Gaea.Nodes.Cracks` · Family `Basic` · Classification `Generator` · ShortCode `ck`

> Cracks primitive creates large, cracked patterns on a flat base.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Cracks** *(分组标题)* | — | — | `[Group]` 由 `Style`, `Octaves`, `Scale`, `Depth` 声明 |
| Style | Enum `CrackStyle` | (HorizontalList，默认值在混淆常量表中) | `Normal` — The default style that creates cracks that gentle slope inward.<br>`Hard` — The edges of the cracks are not refined and may show aliasing. This may be useful if the softer edges create artifacts in other nodes.<br>`Classic` — The default style from previous versions of Gaea. This is creates very thin cracks without a slope curve. |
| Octaves | Int32 `int` | `1`，范围 1 … 10 | The number of crack pattern sets to generate. |
| Scale | Single `float` | `0.25f`，范围 0.0001f … 1f | The overall size of the cracked pattern. |
| Depth | Single `float` | `0.35f`，范围 0.0001f … 1f | The depth of the cracks. It also widens the cracks. |
| Jitter | Single `float` | `0.5f`，范围 0f … 1f | Control the offset of the cracks between symmetrical and chaotic. |
| Warp Strength | Single `float` | `0.2f`，范围 0f … 1f | The strength of the warp distortion applied to the cracks. |
| Warp Size | Single `float` | `0.35f`，范围 0f … 1f | The size of the warp distortion applied to the cracks. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |
| **Advanced settings** *(分组标题)* | — | — | `[Group]` 由 `ScaleX`, `ScaleY` 声明 |
| Scale X | Single `float` | `2f`，范围 0f … 100f | The non-uniform scale on the X axis. |
| Scale Y | Single `float` | `2f`，范围 0f … 100f | The non-uniform scale on the Y axis. |

### DotNoise

`QuadSpinner.Gaea.Nodes.DotNoise` · Family `Extended` · Classification `Generator` · ShortCode `dot`

> Generates dotted or speckled noise patterns for texturing and breakup.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Style | Enum `DotNoiseStyle` | `DotNoiseStyle.Dot`，范围 0f … 1f | `Dot` — Generates round blobs or spheres, creating soft, circular noise patterns.<br>`Square` — Generates square-shaped blobs, resulting in blocky, grid-like noise patterns. |
| Iterations | Int32 `int` | `50`，范围 2 … 500 | Sets the number of times dots or blobs are placed on the surface. Higher values increase the density and coverage of the noise. |
| Multiplier | Single `float` | `1f`，范围 0f … 20f | Scales the intensity or strength of the dot noise effect, amplifying the contribution of each blob. |
| Size | Float2 `Float2` | `0.2f`，范围 0.0001f … 1f | Controls the average size of each dot, blob, or sphere. Larger values produce bigger features. |
| Height | Single `float` | `0.2f`，范围 0.0001f … 1f | Sets the maximum elevation or intensity of the dots or blobs above the base surface. |
| Blend Mode | Enum `BombBlendMode` | `BombBlendMode.Max`，范围 0f … 1f | `None` — No blending is applied; the dot noise is used as-is.<br>`Blend` — Blends the dot noise with the input using standard alpha or linear blending.<br>`Add` — Adds the dot noise values to the input, increasing elevation or intensity where dots are present.<br>`Subtract` — Subtracts the dot noise from the input, creating depressions or pits where dots are placed.<br>`Difference` — Applies a difference operation, emphasizing areas where the dot noise and input differ.<br>`Multiply` — Multiplies the dot noise with the input, modulating the surface based on dot presence.<br>`Screen` — Uses a screen blend, lightening the surface where dots are present.<br>`Max` — Takes the maximum value between the dot noise and the input at each point.<br>`Min` — Takes the minimum value between the dot noise and the input at each point. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for dot placement and variation. Changing the seed produces different dot patterns. |

### Draw

`QuadSpinner.Gaea.Nodes.Draw` · Family `Basic` · Classification `Generator` · ShortCode `vm` · Keywords `vector mask`

> Draw draws entire mountain ranges in the shape you choose.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Soften | Single `float` | `0f`，范围 0f … 5f |  |
| Height | Single `float` | `1f`，范围 0f … 1f |  |
| Open Painter | Command `bool` | `"brush"` | *C# 属性 `OpenPainter`* |
| Stroke Data | String `string` | — |  |

### DriftNoise

`QuadSpinner.Gaea.Nodes.DriftNoise` · Family `Extended` · Classification `Generator` · ShortCode `dr`

> DriftNoise is a unique primitive that can create overlapping "shelves". It is a versatile primitive noise that can be used in various scenarios from cliffs to crack production.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Passes | Int32 `int` | `2`，范围 2 … 10 |  |
| Chaos | Single `float` | `0.25f`，范围 0f … 1f | Gives uneveness to the overlapping shelves. |
| Scale Large | Single `float` | `0.4f`，范围 0.05f … 1f |  |
| Scale Small | Single `float` | `0.4f`，范围 0.05f … 1f |  |
| Turbulence Large | Single `float` | `0.4f`，范围 0.15f … 1f |  |
| Turbulence Small | Single `float` | `0.4f`，范围 0.1f … 1f |  |
| Wind Direction Large | Single `float` | `0f`，范围 0f … 360f |  |
| Wind Direction Small | Single `float` | `0f`，范围 0f … 360f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |
| Overlap Shapes | Boolean `bool` | `false`，范围 0f … 1f |  |

### File

`QuadSpinner.Gaea.Nodes.File` · Family `Assets` · Classification `Generator` · ShortCode `f` · Keywords `file`

> File loads any supported image or data file as a terrain, and supports all major file formats. You can also transform the input.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| File | String `string` | — | Specifies the file to load as input for the node. This can be a heightmap, mask, or other supported data file.<br>*C# 属性 `FileName`* |
| Relative Path | Boolean `bool` | `false`，范围 0f … 1f | Defines the file path relative to the project or asset directory, ensuring portability and correct asset referencing. |
| Is RGB | Boolean `bool` | `false`，范围 0f … 1f | Indicates whether the loaded file should be interpreted as an RGB image. Enable this for color maps or multi-channel data. |
| Enforce Linear Gamma | Boolean `bool` | `false`，范围 0f … 1f | Forces the loaded terrain or image data to use linear gamma correction, ensuring accurate color and height interpretation. |
| Allow Unclamped | Boolean `bool` | `false`，范围 0f … 1f | Allows values outside the standard 0–1 range to be loaded, preserving high dynamic range or special data in the file. |
| Crop to Square | Boolean `bool` | `false`，范围 0f … 1f | Automatically crops the loaded file to a square aspect ratio, which is often required for terrain processing. |
| Prepare for Bridge | Command `bool` | `"transfer-in"` | Prepares the loaded file for use with the Bridge system, enabling compatibility with external tools or workflows.<br>*C# 属性 `HoudiniIn`* |
| Information Houdini | Byte `byte` | — | Displays or stores metadata related to Houdini integration, such as file attributes or import status. |
| **Caching** *(分组标题)* | — | — | `[Group]` 由 `PurgeCache`, `NeverCache` 声明 |
| Purge Cache | Command `bool` | `"file-shredder"` | Clears the cached version of the loaded file, forcing a reload from disk on the next access. |
| Never Cache | Boolean `bool` | `false`，范围 0f … 1f | Prevents the loaded file from being cached, ensuring it is always read directly from disk. |

### Gabor

`QuadSpinner.Gaea.Nodes.Gabor` · Family `Basic` · Classification `Generator` · ShortCode `g` · Keywords `gabor`

> Gabor noise is one of the lesser used noises, but provides a wonderful pattern-friendly noise that can be used to simulate various aspects of nature.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Gabor** *(分组标题)* | — | — | `[Group]` 由 `Size`, `Entropy`, `Anisotropy`, `AnisotropyAzimuth` 声明 |
| Size | Single `float` | `0.5`，范围 0f … 1f | Controls the scale of the Gabor noise features. Larger values produce broader, more widely spaced patterns, while smaller values create finer details. |
| Entropy | Single `float` | `0.5`，范围 0f … 1f | Adjusts the randomness or complexity of the Gabor noise. Higher entropy values result in more chaotic and less predictable patterns. |
| Anisotropy | Single `float` | `1f`，范围 0f … 1f | Determines the degree of directionality in the noise. Higher values stretch the pattern along a specific axis, creating elongated or striated features. |
| Azimuth | Single `float` | `0f`，范围 0f … 360f | Sets the orientation angle (in degrees) for the anisotropic direction of the Gabor noise, controlling the alignment of elongated features.<br>*C# 属性 `AnisotropyAzimuth`* |
| Gain | Single `float` | `0.5f`，范围 0.0001f … 1f | Controls the amplitude or intensity of the Gabor noise, affecting the contrast and prominence of the generated features. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. Changing the seed produces different variations of the Gabor noise. |

### Hemisphere

`QuadSpinner.Gaea.Nodes.Hemisphere` · Family `Gradient` · Classification `Generator` · ShortCode `do` · Keywords `dome`

> Generates a hemispherical gradient useful for domes, mounds, and radial falloffs.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `1f`，范围 0f … 4f | Controls the overall size of the hemisphere. Larger values increase the radius and footprint of the shape on the terrain. |
| Height | Single `float` | `1f`，范围 0f … 1f | Sets the maximum elevation of the hemisphere, determining how tall the dome rises above the base level. |
| X | Single `float` | `0.5f`，范围 0f … 1f | Adjusts the horizontal position of the hemisphere along the X axis, allowing you to move it left or right within the terrain. |
| Y | Single `float` | `0.5f`，范围 0f … 1f | Adjusts the horizontal position of the hemisphere along the Y axis, allowing you to move it forward or backward within the terrain. |
| Flatten | Boolean `bool` | `false`，范围 0f … 1f | Flattens the top of the hemisphere, creating a dome with a plateau or truncated appearance instead of a perfect curve. |

### LinearGradient

`QuadSpinner.Gaea.Nodes.LinearGradient` · Family `Gradient` · Classification `Generator` · ShortCode `lg` · Keywords `lineargradient`

> Generates a straight linear gradient across the terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `1f`，范围 0f … 4f |  |
| Direction | Int32 `int` | `0`，范围 0 … 360 |  |
| Edge Behavior | Enum `GradientEdgeBehaviour` | (Enum，默认值在混淆常量表中) | `Clip` — <desc><br>`Repeat` — <desc><br>`Mirror` — <desc><br>*C# 属性 `Edge`* |

### LineNoise

`QuadSpinner.Gaea.Nodes.LineNoise` · Family `Basic` · Classification `Generator` · ShortCode `ln` · Keywords `noise linenoise lines stripe`

> LineNoise is a geometry generator that creates sets of lines which can be distorted and used with other noises and fractals to produce layered ridges.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Bucket Size | Enum `LineNoiseSize` | `LineNoiseSize.X1`，范围 0f … 1f | `X1` — <desc><br>`X2` — <desc><br>`X3` — <desc><br>`X4` — <desc> |
| Style | Enum `LineNoiseStyle` | `LineNoiseStyle.Sharp`，范围 0f … 1f | `Sharp` — <desc><br>`Soft` — <desc><br>`Flat` — <desc><br>`Vague` — <desc> |
| Clamp | Single `float` | `1f`，范围 0.0001f … 1f |  |
| Direction | Int32 `int` | `0`，范围 0 … 360 |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### MultiFractal

`QuadSpinner.Gaea.Nodes.MultiFractal` · Family `Extended` · Classification `Generator` · ShortCode `mf` · Keywords `multifractal`

> MultiFractal creates a multi-noise that can have a large level of variations. Often useful for texturing.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Fractal** *(分组标题)* | — | — | `[Group]` 由 `NoiseType`, `AutoOctaves`, `Octaves`, `Size` 声明 |
| Noise Type | Enum `MultifractalNoiseType` | `MultifractalNoiseType.FBM`，范围 0f … 1f | `FBM` — Fractal Brownian Motion. Produces varied, natural-looking noise with a balanced mix of peaks and valleys.<br>`Billowy` — Creates softer, rounded, and bulbous shapes, ideal for rolling hills or smooth terrain.<br>`Ridged` — Generates sharp, jagged features, resulting in more dramatic and rugged terrain.<br>*C# 属性 `NoiseType`* |
| Auto Octaves | Boolean `bool` | — | Automatically determines the optimal number of octaves for the fractal, balancing detail and performance.<br>*C# 属性 `AutoOctaves`* |
| Octaves | Int32 `int` | `10`，范围 1 … 14 | Specifies the number of noise layers (octaves) used. Higher values increase detail and complexity, but may impact performance. |
| Scale | Single `float` | `0.5f`，范围 0f … 1f | Controls the overall size of the fractal features. Lower values create larger features, while higher values produce finer details.<br>*C# 属性 `Size`* |
| Relative Feature Scale | Single `float` | `0.5f`，范围 0f … 1f | Adjusts the scale of features relative to the terrain size, allowing for proportional detail regardless of resolution.<br>*C# 属性 `FeatureSize`* |
| Roughness | Single `float` | `0.5f`，范围 0f … 1f | Determines the roughness of the fractal. Lower values result in smoother shapes, while higher values create more rugged, detailed surfaces.<br>*C# 属性 `FractalGain`* |
| Edge smoothing | Single `float` | `0.1f`，范围 0f … 1f | Smooths the edges of the generated terrain, reducing harsh transitions and creating a more natural appearance.<br>*C# 属性 `EdgeSmoothing`* |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Sets the random seed for noise generation. Changing the seed produces different terrain patterns while keeping other settings the same. |
| **Variation** *(分组标题)* | — | — | `[Group]` 由 `VariationType`, `Variation`, `Smoothness`, `VariationContrast` 声明 |
| Type | Enum `VariationType` | `VariationType.SecondaryFractal`，范围 0f … 1f | `SecondaryFractal` — Uses a secondary fractal to modulate the main fractal, adding additional layers of complexity and detail.<br>`SelfModulation` — Applies self-modulation, where the fractal modulates itself to create more intricate and unique patterns.<br>*C# 属性 `VariationType`* |
| Variation | Single `float` | `2f`，范围 -5f … 5f | Selects the method of applying variation to the fractal. |
| Smoothness | Single `float` | `0f`，范围 -1f … 1f | Adjusts the smoothness of the variation, with higher values producing gentler transitions and lower values creating sharper changes. |
| Contrast | Single `float` | `0.3f`，范围 0f … 1f | Controls the contrast of the variation, increasing or decreasing the difference between high and low areas.<br>*C# 属性 `VariationContrast`* |
| Damping | Single `float` | `0.25f`，范围 0f … 1f | Reduces the intensity of variation or modulation, helping to prevent overly chaotic or extreme results. |
| Bias | Single `float` | `0.5f`，范围 -1f … 1f | Shifts the overall output of the variation, allowing you to favor higher or lower values in the resulting terrain. |
| **Position** *(分组标题)* | — | — | `[Group]` 由 `Rotation`, `Anisotropy`, `OffsetX`, `OffsetY` 声明 |
| Rotation | Single `float` | `0f`，范围 0f … 360f | Rotates the fractal pattern, changing the orientation of features across the terrain. |
| Anisotropy | Single `float` | `0f`，范围 -1f … 1f | Applies directional scaling to the fractal, stretching or compressing features along a specific axis. |
| Offset X | Single `float` | `0f`，范围 -5f … 5f | Shifts the fractal pattern horizontally, moving features left or right across the terrain. |
| Offset Y | Single `float` | `0f`，范围 -5f … 5f | Shifts the fractal pattern vertically, moving features up or down across the terrain. |
| **Warp** *(分组标题)* | — | — | `[Group]` 由 `Perturb`, `RelativeWarpSize`, `WarpStrength`, `WarpComplexity` 声明 |
| Perturb | Enum `Perturb` | `Perturb.None`，范围 0f … 1f | `None` — No warping is applied. The fractal pattern remains unaltered.<br>`Simple` — Applies basic, soft warping to the fractal, gently distorting features for a more natural look.<br>`Complex` — Applies advanced, turbulent warping, creating highly irregular and dynamic terrain features. |
| Relative Size | Single `float` | `1f`，范围 0.25f … 4f | Controls the size of the warp effect relative to the overall terrain, allowing for proportional distortion.<br>*C# 属性 `RelativeWarpSize`* |
| Strength | Single `float` | `0.5`，范围 0f … 1f | Sets the intensity of the warp effect. Higher values produce more pronounced distortion.<br>*C# 属性 `WarpStrength`* |
| Complexity | Int32 `int` | `3`，范围 1 … 14 | Adjusts the complexity of the warp, increasing the number of layers or detail in the distortion.<br>*C# 属性 `WarpComplexity`* |
| Roughness | Single `float` | `0.4f`，范围 0f … 0.5f | Determines the roughness of the fractal. Lower values result in smoother shapes, while higher values create more rugged, detailed surfaces.<br>*C# 属性 `WarpRoughness`* |
| Attenuation | Single `float` | `0.5`，范围 0f … 1f | Reduces the strength of the warp effect over distance, allowing for localized or fading distortion.<br>*C# 属性 `WarpAttenuation`* |
| Iterations | Int32 `int` | `3`，范围 1 … 20 | Specifies how many times the warp effect is applied, with higher values increasing the overall distortion.<br>*C# 属性 `WarpIterations`* |
| Relative Anisotropy | Single `float` | `1f`，范围 0f … 1f | Controls the directional scaling of the warp effect, stretching or compressing the distortion along a specific axis.<br>*C# 属性 `RelativeWarpAnisotropy`* |

### Noise

`QuadSpinner.Gaea.Nodes.Noise` · Family `Basic` · Classification `Generator` · ShortCode `kn` · Keywords `k`

> Noise applies controlled single-pixel noise onto the terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Noise Type | Enum `ConstantNoiseType` | `ConstantNoiseType.Random`，范围 0f … 1f | `Random` — Generates pure random noise, resulting in a highly chaotic and unstructured pattern.<br>`Perlin` — Produces smooth, gradient-based noise with natural transitions, ideal for organic terrain features.<br>`Gaussian` — Applies a Gaussian distribution to the noise, creating patterns with a bell-curve intensity and softer transitions.<br>`Fixed` — Generates a noise pattern based on large, finite shapes.<br>`Micro` — Creates very fine, high-frequency noise suitable for adding subtle surface detail or micro-variation. |
| Height | Single `float` | `1f`，范围 0f … 1f | Controls the maximum amplitude or elevation of the noise, affecting how pronounced the noise appears in the output. |
| Density | Single `float` | `0.5f`，范围 0f … 1f | Adjusts the frequency or scale of the noise pattern. Higher density results in more frequent variations across the terrain. |
| Relative Density | Boolean `bool` | `false`，范围 0f … 1f | When enabled, density is scaled relative to the current resolution or context, maintaining consistent detail at different scales. |
| Blend Mode | Enum `PrimitiveBlendMode` | `PrimitiveBlendMode.Add`，范围 0f … 1f | `Add` — Adds the noise values to the input, increasing elevation or intensity where noise is present.<br>`Multiply` — Multiplies the input by the noise values, modulating the base layer and enhancing contrast.<br>`Subtract` — Subtracts the noise values from the input, reducing elevation or intensity in noisy areas. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Sets the randomization seed for the noise generation. Changing the seed produces a different noise pattern while keeping other settings the same. |

### Object

`QuadSpinner.Gaea.Nodes.Object` · Family `Assets` · Classification `Generator` · ShortCode `o` · Keywords `Object`

> Loads external object or mesh data for use inside the graph.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Mesh | String `string` | — | Specifies the 3D mesh file to import. The mesh will be converted and rendered as a heightfield for use in terrain generation.<br>*C# 属性 `FileName`* |
| Relative Path | Boolean `bool` | `false`，范围 0f … 1f | Defines the file path to the mesh relative to the project or asset directory. Ensures portability and correct asset referencing. |
| **Position** *(分组标题)* | — | — | `[Group]` 由 `DropToFloor`, `OffsetX`, `OffsetY`, `OffsetZ` 声明 |
| Drop to Floor | Boolean `bool` | `false`，范围 0f … 1f | Automatically positions the object so its lowest point rests on the terrain base, preventing it from floating or being embedded below the surface.<br>*C# 属性 `DropToFloor`* |
| Offset X | Single `float` | `0f`，范围 -1f … 1f | Shifts the object horizontally along the X axis, allowing precise placement within the terrain. |
| Offset Y | Single `float` | `0f`，范围 -1f … 1f | Shifts the object horizontally along the Y axis, allowing precise placement within the terrain. |
| Offset Z | Single `float` | `0f`，范围 -1f … 1f | Moves the object vertically along the Z axis, raising or lowering it relative to the terrain surface. |
| **Scale** *(分组标题)* | — | — | `[Group]` 由 `Scale` 声明 |
| Scale | Single `float` | `1f`，范围 0.001f … 2f | Group containing parameters for scaling the imported object. |
| **Rotation** *(分组标题)* | — | — | `[Group]` 由 `Pitch`, `Yaw`, `Roll` 声明 |
| Pitch | Single `float` | `0f`，范围 -180f … 180f | Rotates the object around the X axis, tilting it forward or backward. |
| Yaw | Single `float` | `0f`，范围 -180f … 180f | Rotates the object around the Y axis, turning it left or right. |
| Roll | Single `float` | `0f`，范围 -180f … 180f | Rotates the object around the Z axis, spinning it clockwise or counterclockwise. |
| **Quality** *(分组标题)* | — | — | `[Group]` 由 `Antialiasing` 声明 |
| Antialiasing | Boolean `bool` | `false`，范围 0f … 1f | Enables or adjusts antialiasing for the heightfield rendering, reducing jagged edges and improving visual smoothness. |

### Pattern

`QuadSpinner.Gaea.Nodes.Nodes.Processor.Pattern` · Family `Basic` · Classification `Generator`

> Generates repeatable geometric or decorative patterns for masking and stylized terrain work.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `0.2f`，范围 0f … 1f | Controls the overall scale of the pattern, affecting the size of the repeated elements across the terrain. |
| Dot Size | Single `float` | `1f`，范围 0f … 1f | Sets the size of individual dots or elements within the pattern. Larger values produce bigger dots or features. |
| Spacing | Single `float` | `0.1f`，范围 0f … 1f | Determines the distance between pattern elements, such as lines, dots, or grid cells. Higher values increase the gap between elements. |
| Steps | Int32 `int` | `256`，范围 10 … 4096 | Specifies the number of discrete steps or repetitions in the pattern, influencing the frequency and repetition of elements. |
| Direction | Int32 `int` | `0`，范围 0 … 90 | Sets the orientation or angle of the pattern, allowing you to rotate lines, engravings, or grids as needed. |
| Type | Enum `PatternType` | `PatternType.Lines`，范围 0f … 1f | `Lines` — Generates a pattern of parallel lines, useful for striations or directional effects.<br>`Engraving` — Creates a pattern resembling engraved or incised lines, adding fine detail and texture.<br>`Grid` — Produces a grid pattern with intersecting horizontal and vertical lines, forming a tiled appearance.<br>`Dots` — Generates a regular array of dots, ideal for stippling or point-based patterns. |
| Pixel Size | Int32 `int` | `1`，范围 1 … 20 | Adjusts the resolution or granularity of the pattern, controlling how fine or coarse the pattern details appear. |

### Perlin

`QuadSpinner.Gaea.Nodes.Perlin` · Family `Basic` · Classification `Generator` · ShortCode `p` · Keywords `perlin`

> Perlin is the most basic and essential noise. In Gaea, we've made a "geo-variant" by modifying the base Perlin shape to fit the needs of terrain design from the beginning.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Noise** *(分组标题)* | — | — | `[Group]` 由 `Type`, `Scale`, `Octaves`, `Gain` 声明 |
| Type | Enum `PerlinNoiseType` | `PerlinNoiseType.FBM`，范围 0f … 1f | `FBM` — Fractal Brownian Motion. Produces classic Perlin noise with layered octaves for natural, smooth terrain.<br>`Ridged` — Generates ridged noise, emphasizing sharp crests and valleys for more dramatic, mountainous features.<br>`Billowy` — Creates billowy, cloud-like noise with soft, rounded shapes and less pronounced valleys. |
| Scale | Single `float` | `0.5f`，范围 0f … 1f | The scale of the noise. Higher values create larger, less detailed shapes. Lower values create noisier, highly detailed shapes. |
| Octaves | Int32 `int` | `10`，范围 1 … 14 | The number of noise octaves. Higher values create more complexity by layering additional detail at smaller scales. |
| Gain | Single `float` | `0.5f`，范围 0f … 1f | Controls the amplitude reduction between octaves, affecting the persistence and contrast of the noise. |
| Height | Single `float` | `1f`，范围 0f … 1f | Sets the maximum elevation or intensity of the noise, scaling the output vertically.<br>*C# 属性 `Clamp`* |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. Changing the seed produces different noise patterns. |
| **Warp** *(分组标题)* | — | — | `[Group]` 由 `WarpType`, `Frequency`, `Amplitude`, `WarpOctaves` 声明 |
| Type | Enum `NoiseWarpType` | `NoiseWarpType.Complex`，范围 0f … 1f | `None` — <desc><br>`Simple` — <desc><br>`Complex` — <desc><br>*C# 属性 `WarpType`* |
| Frequency | Single `float` | `0.05f`，范围 0f … 1f | Controls the frequency of the warp, determining how often the pattern is distorted across the terrain. |
| Amplitude | Single `float` | `0.5f`，范围 0f … 1f | Sets the strength of the warp effect, controlling how far the noise is displaced. |
| Octaves | Int32 `int` | `10`，范围 1 … 14 | The number of noise octaves. Higher values create more complexity by layering additional detail at smaller scales.<br>*C# 属性 `WarpOctaves`* |
| **Transform** *(分组标题)* | — | — | `[Group]` 由 `ScaleX`, `ScaleY`, `X`, `Y` 声明 |
| Scale X | Single `float` | `1f`，范围 0.0001f … 100f | The non-uniform scale of the X axis, stretching or compressing the noise horizontally. |
| Scale Y | Single `float` | `1f`，范围 0.0001f … 100f | The non-uniform scale of the Y axis, stretching or compressing the noise vertically. |
| X | Single `float` | `0.5f`，范围 0f … 1f | Offsets the Perlin noise along the X axis, shifting its position horizontally. |
| Y | Single `float` | `0.5f`，范围 0f … 1f | Offsets the Perlin noise along the Y axis, shifting its position vertically. |

### RadialGradient

`QuadSpinner.Gaea.Nodes.RadialGradient` · Family `Gradient` · Classification `Generator` · ShortCode `rg` · Keywords `radialgradient`

> Generates a circular gradient radiating outward from a center point.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `1f`，范围 0f … 4f | Controls the overall size of the radial gradient. Increasing the scale expands the gradient outward, affecting a larger area of the terrain. |
| Height | Single `float` | `1f`，范围 0f … 1f | Sets the maximum height or intensity at the center of the radial gradient. Higher values create a more pronounced peak in the center. |
| X | Single `float` | `0.5f`，范围 0f … 1f | Specifies the horizontal position of the gradient's center. Adjust this value to move the gradient left or right across the terrain. |
| Y | Single `float` | `0.5f`，范围 0f … 1f | Specifies the vertical position of the gradient's center. Adjust this value to move the gradient up or down across the terrain. |

### Shape

`QuadSpinner.Gaea.Nodes.Shape` · Family `Basic` · Classification `Generator` · ShortCode `s` · Keywords `shape geometry circle rectangle oval`

> Generates basic geometric terrain shapes for use as primitives or masks.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Geometry | Enum `Shapes` | `Shapes.Circle`，范围 0f … 1f | `Circle` — Generates a circular shape as the base geometry, resulting in round or elliptical forms.<br>`Rectangle` — Generates a rectangular shape as the base geometry, resulting in box-like or elongated forms. |
| Sides | Int32 `int` | `3`，范围 3 … 256 | Defines the number of sides for polygonal shapes. Higher values create shapes closer to a circle, while lower values produce more angular forms. |
| Uniform | Boolean `bool` | `true`，范围 0f … 1f | When enabled, ensures that scaling and transformations are applied equally in all directions, maintaining the original proportions of the shape. |
| Scale | Single `float` | `0.5f`，范围 0.0001f … 2f | Controls the overall size of the shape, scaling it uniformly along both the X and Y axes. |
| Scale X | Single `float` | `0.5f`，范围 0.0001f … 2f | Adjusts the width of the shape by scaling it along the X axis independently. |
| Scale Y | Single `float` | `0.5f`，范围 0.0001f … 2f | Adjusts the height of the shape by scaling it along the Y axis independently. |
| Thickness | Single `float` | `0.1f`，范围 0.0001f … 1f | Specifies the thickness of the shape's outline or border, or the width of a ring for hollow shapes. |
| Height | Single `float` | `1f`，范围 0.0001f … 1f | Sets the vertical extent or elevation of the shape, often used to define extrusion or relief in terrain generation. |
| X | Single `float` | `0.5f`，范围 0f … 1f | Sets the horizontal position or offset of the shape along the X axis. |
| Y | Single `float` | `0.5f`，范围 0f … 1f | Sets the vertical position or offset of the shape along the Y axis. |

### TileInput

`QuadSpinner.Gaea.Nodes.TileInput` · Family `Assets` · Classification `Generator` · ShortCode `til` · Keywords `tile`

> Reads a set of tiles for 1:1 input into a tiled build, or combines it into a single input.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| File | String `string` | — | Lorem ipsum<br>*C# 属性 `FileName`* |
| Relative Path | Boolean `bool` | `false`，范围 0f … 1f |  |
| Enforce Linear Gamma | Boolean `bool` | `false`，范围 0f … 1f | Lorem ipsum |
| Flip Y | Boolean `bool` | `false`，范围 0f … 1f | Lorem ipsum |
| Purge Cache | Command `bool` | `"file-shredder"` |  |
| Tile Info | String `string` | (ComputedString，默认值在混淆常量表中) |  |

### Voronoi

`QuadSpinner.Gaea.Nodes.Voronoi` · Family `Basic` · Classification `Generator` · ShortCode `v`

> Voronoi is a staple of procedural design and creates sharp, geometric patterns. In Gaea, we've made a "geo-variant" by modifying the base Voronoi shape to fit the needs of terrain design from the beginning.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Noise** *(分组标题)* | — | — | `[Group]` 由 `Scale`, `Jitter`, `Function`, `Form` 声明 |
| Scale | Single `float` | `0.5f`，范围 0.0001f … 1f | The perceptual scale of the Voronoi shapes. Higher values create more, smaller shapes; lower values produce fewer, larger cells. |
| Jitter | Single `float` | `0.5f`，范围 0f … 1f | Controls the offset of the Voronoi points, ranging from perfectly symmetrical (low jitter) to highly chaotic (high jitter) cell placement. |
| Function | Enum `VoronoiFunction` | `VoronoiFunction.Euclidean`，范围 0f … 1f | `Euclidean` — Uses the standard Euclidean distance, resulting in natural, rounded cell shapes.<br>`Manhattan` — Uses the Manhattan (grid-based) distance, producing square or diamond-shaped cells. |
| Form | Enum `VoronoiForm` | `VoronoiForm.P`，范围 0f … 1f | `C` — Voronoi cells with height determined by the cell itself, creating classic cell-based patterns.<br>`N` — Voronoi cells with height determined by the nearest neighbor, resulting in smoother transitions between cells.<br>`R` — Voronoi cells with height influenced by the distance to the cell's edge, creating ring-like or ridge effects.<br>`P` — The default look for this geo-variant, suitable for creating mountainous terrain with prominent peaks.<br>`A` — A mix between the P and M forms, blending characteristics of both for varied terrain features.<br>`S` — Generates individual mountains with fully separated boundaries, emphasizing isolated peaks.<br>`M` — Favors the strongest cell, ideal for creating a large mountain slope or dominant landform.<br>`D` — Emphasizes ridges over cell centers, producing terrain with pronounced ridge lines. |
| Gain | Single `float` | `0.5f`，范围 0f … 1f | Adjusts the contrast or intensity of the Voronoi pattern, amplifying or reducing the difference between cell heights. |
| Clamp | Single `float` | `1f`，范围 0.0001f … 1f | Limits the output values to a specified range, preventing extreme heights or depths in the generated pattern. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. Changing the seed produces different Voronoi arrangements. |
| **Warp** *(分组标题)* | — | — | `[Group]` 由 `WarpType`, `Frequency`, `Amplitude`, `WarpOctaves` 声明 |
| Type | Enum `NoiseWarpType` | `NoiseWarpType.Complex`，范围 0f … 1f | `None` — No warping is applied; the Voronoi pattern remains unaltered.<br>`Simple` — Applies basic warping to the pattern, introducing gentle distortions.<br>`Complex` — Applies advanced, multi-layered warping for highly intricate and organic distortions.<br>*C# 属性 `WarpType`* |
| Frequency | Single `float` | `0.05f`，范围 0f … 1f | Controls the frequency of the warp, determining how often the pattern is distorted across the terrain. |
| Amplitude | Single `float` | `0.5f`，范围 0f … 1f | Sets the strength of the warp effect, controlling how far the Voronoi cells are displaced. |
| Octaves | Int32 `int` | `14`，范围 1 … 14 | Specifies the number of detail layers used in the warp, increasing the complexity and richness of the distortion.<br>*C# 属性 `WarpOctaves`* |
| **Transform** *(分组标题)* | — | — | `[Group]` 由 `ScaleX`, `ScaleY`, `X`, `Y` 声明 |
| Scale X | Single `float` | `1f`，范围 0.0001f … 100f | The non-uniform scale of the X axis, stretching or compressing the pattern horizontally. |
| Scale Y | Single `float` | `1f`，范围 0.0001f … 100f | The non-uniform scale of the Y axis, stretching or compressing the pattern vertically. |
| X | Single `float` | `0.5f`，范围 0f … 1f | Offsets the Voronoi pattern along the X axis, shifting its position horizontally. |
| Y | Single `float` | `0.5f`，范围 0f … 1f | Offsets the Voronoi pattern along the Y axis, shifting its position vertically. |

### WaveShine

`QuadSpinner.Gaea.Nodes.WaveShine` · Family `Extended` · Classification `Generator` · ShortCode `ws`

> Generates wave-like reflective or rippling patterns useful for stylized surfaces and water-like forms.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Global** *(分组标题)* | — | — | `[Group]` 由 `Frame`, `Octaves`, `Seed` 声明 |
| Frame | Int32 `int` | `0`，范围 0 … 49 | Specifies the current animation frame or time step for the wave simulation, allowing for frame-by-frame control or preview. |
| Octaves | Int32 `int` | `4`，范围 1 … 5 | Sets the number of detail layers (octaves) used in the wave pattern, increasing complexity and realism with higher values. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for generating unique wave patterns. Changing the seed produces different wave arrangements. |
| **Ripples** *(分组标题)* | — | — | `[Group]` 由 `AnimationSpeed`, `Size`, `Amplitude`, `Direction` 声明 |
| Animation Speed | Single `float` | `1f`，范围 0f … 2f | Controls the speed at which ripples animate across the surface, affecting how quickly the pattern evolves over time.<br>*C# 属性 `AnimationSpeed`* |
| Size | Single `float` | `0.1f`，范围 0f … 1f | Sets the scale of individual ripples, with larger values producing broader, more widely spaced ripples. |
| Amplitude | Single `float` | `0.5f`，范围 0f … 1f | Adjusts the height or intensity of the ripples, making them more or less pronounced. |
| Direction | Single `float` | `0f`，范围 0f … 360f | Specifies the primary direction in which ripples travel, simulating wind or current-driven movement. |
| Speed | Single `float` | `0.1f`，范围 0f … 1f | Controls the movement speed of the ripples, determining how fast they propagate across the surface. |
| **Wind Patch** *(分组标题)* | — | — | `[Group]` 由 `WindPatchIntensity`, `WindPatchAnimationSpeed`, `WindPatchSize`, `Contrast` 声明 |
| Intensity | Single `float` | `0f`，范围 0f … 1f | Sets the strength of the wind patch effect, increasing the impact of wind on the wave or ripple pattern.<br>*C# 属性 `WindPatchIntensity`* |
| Animation Speed | Single `float` | `1f`，范围 0f … 2f | Controls the speed at which ripples animate across the surface, affecting how quickly the pattern evolves over time.<br>*C# 属性 `WindPatchAnimationSpeed`* |
| Size | Single `float` | `30f`，范围 10f … 50f | Sets the scale of individual ripples, with larger values producing broader, more widely spaced ripples.<br>*C# 属性 `WindPatchSize`* |
| Contrast | Single `float` | `2f`，范围 0f … 6f | Adjusts the contrast of the wind patch effect, making the difference between calm and windy areas more or less pronounced. |
| **Lighting** *(分组标题)* | — | — | `[Group]` 由 `Brightness`, `SunAzimuth`, `SunElevation` 声明 |
| Brightness | Single `float` | `1f`，范围 0f … 5f | Controls the overall brightness of the rendered wave surface, affecting how light or dark the result appears. |
| Sun Azimuth | Single `float` | `315f`，范围 0f … 360f | Sets the horizontal angle of the sun, determining the direction of sunlight and resulting highlights or reflections. |
| Sun Elevation | Single `float` | `30f`，范围 0f … 90f | Sets the vertical angle of the sun above the horizon, affecting the length and intensity of highlights and shadows on the waves. |

## Terrain

*地形构造：山脉、峡谷、火山、台地等大尺度形状* — `NodeCategory.Terrain`，共 14 个节点。

### Canyon

`QuadSpinner.Gaea.Nodes.Canyon` · Family `Landscape` · Classification `Generator` · ShortCode `ny`

> Canyon is a simple, fast, and detailed canyon primitive. It creates a drainage based river canyon.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Structure** *(分组标题)* | — | — | `[Group]` 由 `Style`, `Scale`, `Slot`, `Valley` 声明 |
| Style | Enum `CanyonStyle` | `CanyonStyle.Eroded`，范围 0f … 1f | `Classic` — Clean, procedural canyon cuts with a simple, carved profile.<br>`Eroded` — Adds erosion-like breakup and natural irregularities to the canyon walls and floor.<br>`Eroded2` — A more advanced eroded style with richer wall detail and more natural variation.<br>`Strata` — Introduces stratified, layered wall features resembling sedimentary rock bands.<br>`Both` — Combines erosion breakup with stratified layering for a layered-and-worn look. |
| Scale | Single `float` | `0.35f`，范围 0f … 1f | The scale of the canyon. |
| Slot | Single `float` | `0.2f`，范围 0f … 1f | Controls the narrow, slot-canyon component - tightness and emphasis of the deepest cut. |
| Valley | Single `float` | `0.4f`，范围 0f … 1f | Controls the broader valley form - overall widening and openness of the canyon. |
| Surrounding | Single `float` | `0.6f`，范围 0f … 1f | Blends the canyon into the surrounding terrain, controlling how much the outer landform influences the final shape. |
| Depth | Single `float` | `0.5f`，范围 0.0001f … 1f | The depth of the canyon. |
| Structual Warp | Single `float` | `0.5f`，范围 0f … 1f | Applies large-scale warping to the canyon structure to introduce bends, meanders, and macro variation. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |
| **Formation** *(分组标题)* | — | — | `[Group]` 由 `DetailWarp`, `AlternateStyle` 声明 |
| Detail Warp | Single `float` | `0.5f`，范围 0f … 1f | Applies finer warping to add small-scale distortion and surface complexity without changing the overall canyon layout. |
| Alternate Style | Boolean `bool` | `false`，范围 0f … 1f | Introduces a secondary variation of the selected style to break uniformity and add visual diversity. |

### Crater

`QuadSpinner.Gaea.Nodes.Crater` · Family `Primitive` · Classification `Generator` · ShortCode `cra`

> Crater primitive creates different types of crater shapes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Style | Enum `CraterStyle` | `CraterStyle.New`，范围 0f … 1f | `New` — Uses the modern crater generation algorithm, producing more realistic and detailed crater shapes.<br>`Classic` — Applies the legacy crater style, creating traditional, stylized crater forms. |
| Scale | Single `float` | `0.3f`，范围 0.0001f … 1f | Controls the overall size of the crater. Higher values produce larger craters. |
| Formation | Single `float` | `0.65f`，范围 0.0001f … 1f | Determines the formation characteristics of the crater, such as depth, width, and rim prominence. |
| Height | Single `float` | `0.65f`，范围 0.0001f … 1f | Sets the maximum elevation or prominence of the crater above the base terrain. |
| Rim | Enum `ShortSharp` | `ShortSharp.Soft`，范围 0f … 1f | `Soft` — Creates a gently sloping, eroded rim for a more weathered appearance.<br>`Sharp` — Produces a steep, well-defined rim for a freshly formed or less eroded crater. |
| Shape | Single `float` | `-0.5f`，范围 -1f … 1f | Defines the overall outline and contour of the crater, such as roundness or irregularity. |
| X | Single `float` | `0.5f`，范围 0f … 1f | Horizontal placement of the crater or crater field within the terrain. |
| Y | Single `float` | `0.5f`，范围 0f … 1f | Vertical placement of the crater or crater field within the terrain. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. Changing the seed produces different crater variations. |

### CraterField

`QuadSpinner.Gaea.Nodes.CraterField` · Family `Landscape` · Classification `Generator` · ShortCode `cf` · Keywords `craterfield`

> Creates a landscape full of craters.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Craterfield** *(分组标题)* | — | — | `[Group]` 由 `Scale`, `Depth`, `Density`, `Seed` 声明 |
| Scale | Single `float` | `1f`，范围 0.0001f … 6f | Controls the overall size (radius) of craters in the field. |
| Depth | Single `float` | `1f`，范围 0.0001f … 2f | Controls how deep the craters carve into the terrain. |
| Density | Single `float` | `1f`，范围 0.0001f … 2f | Controls how many craters are generated across the terrain (higher values create more impacts). |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |
| **Position** *(分组标题)* | — | — | `[Group]` 由 `X`, `Y` 声明 |
| X | Single `float` | `0f`，范围 -10f … 10f | Offsets the craterfield along the X axis. |
| Y | Single `float` | `0f`，范围 -10f … 10f | Offsets the craterfield along the Y axis. |

### DuneSea

`QuadSpinner.Gaea.Nodes.DuneSea` · Family `Landscape` · Classification `Generator` · ShortCode `du`

> Creates broad fields of dune-like terrain suitable for deserts and wind-shaped landscapes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `0.25f`，范围 0.1f … 0.5f |  |
| Dune Type | Enum `ABCD` | (HorizontalList，默认值在混淆常量表中) | `A` — <desc><br>`B` — <desc><br>`C` — <desc><br>`D` — <desc> |
| Chaos | Enum `DuneChaosLevel` | (HorizontalList，默认值在混淆常量表中) | `None` — <desc><br>`Low` — <desc><br>`Medium` — <desc><br>`High` — <desc> |
| Undulation | Enum `DuneUndulationLevel` | (HorizontalList，默认值在混淆常量表中) | `None` — <desc><br>`Low` — <desc><br>`Medium` — <desc><br>`High` — <desc> |
| Direction | Int32 `int` | `0`，范围 0 … 360 |  |
| Height | Single `float` | `0.25f`，范围 0.01f … 1f |  |
| Softness | Int32 `int` | `10`，范围 5 … 50 |  |
| Sharpness | Single `float` | `0.25f`，范围 0f … 1f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |

### Island

`QuadSpinner.Gaea.Nodes.Island` · Family `Primitive` · Classification `Generator` · ShortCode `is`

> Island draws basic shapes from which entire landmasses can be generated.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `0.25f`，范围 0.0001f … 1f |  |
| Chaos | Single `float` | `0.25f`，范围 0f … 1f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### Mountain

`QuadSpinner.Gaea.Nodes.Mountain` · Family `Primitive` · Classification `Generator` · ShortCode `m` · Keywords `mountain`

> Mountain is one of Gaea's most versatile primitives, using a modulated Voronoi pattern and distortions to create realistic mountain shapes, ready for further modification and erosion.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `0.5f`，范围 0.0001f … 1f | Controls the overall size and extent of the mountain. Higher values create broader, more expansive mountain shapes. |
| Height | Single `float` | `1.25f`，范围 0.0001f … 3f | Sets the maximum elevation of the mountain, determining how tall the peak rises above the terrain. |
| Style | Enum `MountainStyle` | `MountainStyle.Eroded`，范围 0f … 1f | `Basic` — Generates a simple, unmodified mountain with minimal erosion or geological detail.<br>`Eroded` — Applies erosion effects to the mountain, creating realistic weathering, gullies, and worn surfaces.<br>`Old` — Simulates an ancient mountain with softened features, rounded slopes, and significant erosion.<br>`Alpine` — Creates sharp, rugged alpine features with steep faces and dramatic relief, typical of young mountain ranges.<br>`Strata` — Adds visible geological strata or layers to the mountain, emphasizing sedimentary or volcanic banding. |
| Bulk | Enum `MountainBulk` | `MountainBulk.Medium`，范围 0f … 1f | `Low` — Produces slender, less massive mountains with more delicate features.<br>`Medium` — Creates mountains with a balanced amount of mass, offering a natural appearance.<br>`High` — Generates thick, heavy mountains with substantial volume and broad bases. |
| Reduce Details | Boolean `bool` | `false`，范围 0f … 1f | Reduces the amount of fine surface detail on the mountain, resulting in a smoother, more simplified shape. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for generating unique variations of the mountain. Changing the seed produces different shapes and arrangements. |
| X | Single `float` | `0.5f`，范围 0f … 1f | Offsets the mountain horizontally along the X axis, shifting its position within the terrain. |
| Y | Single `float` | `0.5f`，范围 0f … 1f | Offsets the mountain horizontally along the Y axis, shifting its position within the terrain. |

### MountainRange

`QuadSpinner.Gaea.Nodes.MountainRange` · Family `Landscape` · Classification `Generator` · ShortCode `mr` · Keywords `mountain range`

> Range primitive quickly sets up an entire mountain terrain with shapes highly optimized for eroding large-scale landscapes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `0.5f`，范围 0f … 1f | Controls the overall size and extent of the mountain ranges. Higher values create broader, more expansive ranges. |
| Height | Single `float` | `0.5f`，范围 0.25f … 3f | Sets the maximum elevation of the mountain range, determining how tall the peaks and ridges will be. |
| Style | Enum `MountainRangeStyle` | `MountainRangeStyle.Eroded`，范围 0f … 1f | `Basic` — Generates a simple, unmodified mountain range with minimal erosion or geological detail.<br>`Eroded` — Applies erosion effects to the mountain range, creating realistic weathering, gullies, and worn surfaces.<br>`Stratified` — Adds visible geological strata or layers to the mountains, simulating sedimentary or volcanic banding.<br>`Alpine` — Creates sharp, rugged alpine features with steep faces and dramatic relief, typical of young mountain ranges. |
| Bulk | Enum `MountainBulk` | `MountainBulk.Low`，范围 0f … 1f | `Low` — Produces slender, less massive mountains with more delicate features.<br>`Medium` — Creates mountains with a balanced amount of mass, offering a natural appearance.<br>`High` — Generates thick, heavy mountains with substantial volume and broad bases. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for generating unique variations of the mountain range. Changing the seed produces different shapes and arrangements. |

### MountainSide

`QuadSpinner.Gaea.Nodes.MountainSide` · Family `Primitive` · Classification `Generator` · ShortCode `ms` · Keywords `slopenoise`

> Generates a single mountain slope or mountainside formation.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `0.5f`，范围 0.0001f … 0.9999f | Controls the overall size and extent of the mountain slope. Larger values create broader, more expansive slopes. |
| Detail | Single `float` | `0.25f`，范围 0f … 1f | Adjusts the amount of fine surface detail on the mountain. Higher values add more texture and small-scale features to the slope. |
| Type | Enum `MountainSideType` | `MountainSideType.Slope`，范围 0f … 1f | `Slope` — Creates a continuous, sloping mountainside, ideal for simulating the flanks of large mountain ranges.<br>`Peak` — Generates a prominent mountain peak, focusing elevation and detail toward a summit. |
| Style | Enum `MountainStyle` | `MountainStyle.Eroded`，范围 0f … 1f | `Basic` — Produces a simple, unmodified slope or peak with minimal erosion or geological features.<br>`Eroded` — Applies erosion effects to the mountain, creating realistic weathering, gullies, and worn surfaces.<br>`Old` — Simulates an ancient mountain with softened features, rounded slopes, and significant erosion.<br>`Alpine` — Creates sharp, rugged alpine features with steep faces and dramatic relief, typical of young mountain ranges.<br>`Strata` — Adds visible geological strata or layers to the mountain, emphasizing sedimentary or volcanic banding. |
| Direction | Int32 `int` | `0`，范围 0 … 360 | Sets the orientation of the slope or peak, determining which direction the mountain face or ridge is aligned. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Defines the randomization seed for the node, ensuring reproducible or varied mountain shapes with each value. |

### Plates

`QuadSpinner.Gaea.Nodes.Plates` · Family `Landscape` · Classification `Generator` · ShortCode `pl` · Keywords `mountain range`

> Plates primitive is based on a Perlin core with flat plate-like formations created in between larger Perlin-esque shapes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `0.5f`，范围 0.0001f … 0.9999f | The scale of the overall field of shapes. Controls the size of the tectonic plates or regions generated by the node. |
| Range | Single `float` | `0.5f`，范围 0f … 1f | Adjusts the variation in elevation or intensity between different plates, affecting the contrast and diversity of the generated regions. |
| Falloff | Single `float` | `0.5f`，范围 0f … 1f | Controls the smoothness of the transitions between plates. Higher values create softer, more gradual boundaries; lower values produce sharper edges. |
| Warp | Single `float` | `0.5f`，范围 0f … 1f | Applies distortion to the plate boundaries, introducing irregularity and natural variation to the shapes. |
| Angle | Single `float` | `0f`，范围 0f … 360f | Sets the orientation or rotation of the plate pattern, allowing you to control the directional flow of the generated regions. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. Changing the seed produces different plate arrangements while keeping other settings the same. |

### Ridge

`QuadSpinner.Gaea.Nodes.Ridge` · Family `Landscape` · Classification `Generator` · ShortCode `ri` · Keywords `ridge`

> Ridge creates a rugged ridgeline with multiple fractures and rock shearing.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `0.75f`，范围 0.0001f … 1f | Scale of the ridgeline. |
| Height | Single `float` | `0.6f`，范围 0.0001f … 2f | Sets the height of the ridge. |
| Definition | Single `float` | `0.4f`，范围 0.25f … 1f | Adds details on the ridgelines. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |
| **Advanced** *(分组标题)* | — | — | `[Group]` 由 `ScaleX`, `ScaleY` 声明 |
| Scale X | Single `float` | `1f`，范围 0.0001f … 2.5f | The non-uniform scale of the X axis. |
| Scale Y | Single `float` | `1f`，范围 0.0001f … 2.5f | The non-uniform scale of the Y axis. |

### Rugged

`QuadSpinner.Gaea.Nodes.Rugged` · Family `Landscape` · Classification `Generator` · ShortCode `gg`

> Rugged is a very powerful primitive node that creates a strong, rocky surface for any terrain while preserving overall shape.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Style | Enum `ABCDE` | `ABCD.A`，范围 0f … 1f | `A` — <desc><br>`B` — <desc><br>`C` — <desc><br>`D` — <desc><br>`E` — <desc> |
| Scale | Single `float` | `0.5f`，范围 0f … 1f | The size of the geological features. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### Slump

`QuadSpinner.Gaea.Nodes.Slump` · Family `Landscape` · Classification `Generator` · ShortCode `um`

> Slump is a simple primitive that creates relative smooth hills with slumped (collapsed) areas. It is very useful for creating large landscapes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `0.5f`，范围 0f … 1f | The scale of the slump. |
| Style | Enum `ABCD` | (HorizontalList，默认值在混淆常量表中) | `A` — <desc><br>`B` — <desc><br>`C` — <desc><br>`D` — <desc> |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### Uplift

`QuadSpinner.Gaea.Nodes.Uplift` · Family `Landscape` · Classification `Generator`

> Creates tectonic-style uplift by raising and shaping large terrain masses.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Passes | Int32 `int` | `1`，范围 1 … 10 |  |
| Scale | Single `float` | `0.5f`，范围 0f … 1f |  |
| Height | Single `float` | `0.6f`，范围 0f … 2f |  |
| Octaves | Int32 `int` | `10`，范围 2 … 12 |  |
| Direction | Int32 `int` | `0`，范围 0 … 360 |  |
| Jitter | Single `float` | `0.5`，范围 0f … 1f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |

### Volcano

`QuadSpinner.Gaea.Nodes.Volcano` · Family `Primitive` · Classification `Generator` · ShortCode `vo`

> Generates a volcanic landform with a central cone and crater structure.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `1f`，范围 0.0001f … 4f | Controls the overall size of the volcano feature in the terrain. Increasing the scale makes the volcano larger relative to the surrounding landscape. |
| Height | Single `float` | `1f`，范围 0.0001f … 1f | Sets the maximum elevation of the volcano. Higher values produce taller volcanic structures. |
| Mouth | Single `float` | `0.15f`，范围 0f … 1f | Defines the diameter of the volcano's crater opening. Adjusting this parameter changes how wide or narrow the mouth appears. |
| Bulk | Single `float` | `-0.2`，范围 -1f … 1f | Determines the mass and thickness of the volcano's body. Higher bulk values result in a more massive and robust volcano shape. |
| Surface | Enum `HillSurface` | `HillSurface.Eroded`，范围 0f … 1f | `Smooth` — Applies a smooth surface to the volcano, minimizing roughness and erosion effects for a clean, uniform appearance.<br>`Eroded` — Applies erosion effects to the volcano's surface, simulating weathered and worn terrain with more natural detail. |
| X | Single `float` | `0.5f`，范围 0f … 1f | Sets the horizontal position of the volcano on the terrain grid. Adjust to move the volcano left or right. |
| Y | Single `float` | `0.5f`，范围 0f … 1f | Sets the vertical position of the volcano on the terrain grid. Adjust to move the volcano up or down. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Defines the randomization seed for procedural generation. Changing the seed produces different volcano shapes and features. |

## Modify

*修改器：模糊、锐化、曲率、重映射等对已有高度的处理* — `NodeCategory.Modify`，共 40 个节点。

### Adjust

`QuadSpinner.Gaea.Nodes.Adjust` · Family `Adjust` · Classification `Processor` · ShortCode `fx` · Keywords `adjust invert autolevel drop`

> The Fx node makes that process easier by combining all the common adjustments inside a single node and allowing you to toggle them on and off.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Multiply | Single `float` | `1f`，范围 0.001f … 10f | Multiplies each value by a specified factor. |
| Shaper | Single `float` | `0f`，范围 -1f … 1f | Applies a shaping function to modify the curve of values. |
| Clamp | Float2 `Float2` | `0f`，范围 0f … 1f | Restricts values to a specified minimum and maximum range. |
| Clip | Float2 `Float2` | `0f`，范围 0f … 1f | Limits values by cutting off those outside a given range. |
| Drop | Boolean `bool` | — | Removes values below or above a certain threshold. |
| Autolevel | Boolean `bool` | — | Automatically adjusts values to span the full output range. |
| Equalize | Boolean `bool` | — | Redistributes values to achieve a more uniform distribution. |
| Strong | Boolean `bool` | — | Enhances the contrast or intensity of values. |
| Invert | Boolean `bool` | — | Flips values to their opposite within the range. |

### Aperture

`QuadSpinner.Gaea.Nodes.Aperture` · Family `Transform` · Classification `Processor` · ShortCode `ap`

> Aperture expands or compacts every feature on the terrain, similar to a camera's bokeh.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Information | Byte `byte` | — | Displays additional information or metadata about the aperture operation and its current settings. |
| Mode | Enum `ApertureMode` | (HorizontalList，默认值在混淆常量表中) | `Dilation` — Expands or grows features in the input by the specified shape and size, filling small holes and connecting nearby elements.<br>`Erosion` — Contracts or shrinks features in the input by the specified shape and size, removing small details and separating connected elements. |
| Size | Single `float` | `0.01`，范围 0f … 1f | Sets the size of the structuring element (aperture) used for the operation. Larger values increase the effect's reach. |
| Shape | Enum `ApertureKernel` | (HorizontalListNoLabel，默认值在混淆常量表中) | `Disk` — Uses a circular (disk-shaped) structuring element for smooth, rounded transformations.<br>`Polygon` — Uses a regular polygon as the structuring element, allowing for custom-sided shapes.<br>`Asterisk` — Uses a star or asterisk-shaped structuring element, emphasizing cross-like or radiating effects.<br>`Line` — Uses a straight line as the structuring element, applying the effect directionally.<br>`Corner` — Uses a corner-shaped structuring element, targeting angular or edge features. |
| Vertices Count | Int32 `int` | `4`，范围 4 … 32 | For polygon shapes, sets the number of vertices (sides) used, controlling the regularity and appearance of the structuring element. |
| Corner Angle | Int32 `int` | `90`，范围 0 … 180 | Specifies the angle of the corner for the 'Corner' shape, adjusting the sharpness or openness of the structuring element. |
| Direction | Int32 `int` | `0`，范围 0 … 360 | Sets the orientation or direction for directional shapes (such as Line or Asterisk), controlling the angle of the effect. |
| Antialiased | Boolean `bool` | `false`，范围 0f … 1f | If enabled, applies antialiasing to the aperture operation, smoothing the edges of the transformed features for a cleaner result. |

### Autolevel

`QuadSpinner.Gaea.Nodes.Autolevel` · Family `Adjust` · Classification `Processor` · ShortCode `lv`

> Automatically remaps the input to use the full available height or mask range.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| *(无参数)* | — | — | `Nodes.json` 中该节点的 `Flubs` 为空数组；程序集侧也没有带 `[Parameter]` 的属性。实际行为由实现类内部固定。 |

### BlobRemover

`QuadSpinner.Gaea.Nodes.BlobRemover` · Family `Utilities` · Classification `Processor` · ShortCode `blo`

> BlobRemover can remove smaller fragments or blobs near larger shapes. This is very useful for cleanup.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Range | Single `float` | `0.05f`，范围 0f … 1f | Controls the sensitivity of the blob detection. Higher values detect a wider range of blob sizes or intensities. |
| Connectivity | Int32 `int` | `4`，范围 4 … 8 | Specifies how connected blobs must be to be considered a single shape. Higher connectivity allows blobs to be more loosely attached to larger shapes. |
| Enforce Quantization | Boolean `bool` | `false`，范围 0f … 1f | If enabled, forces the use of quantization during blob detection, improving efficiency and consistency in identifying blobs. |
| Quantization | Int32 `int` | `64`，范围 16 … 128 | Sets the quantization level for blob detection, with values between 1 and 128. Lower values provide finer detail, while higher values group similar values together for faster and more efficient blob identification. |

### Blur

`QuadSpinner.Gaea.Nodes.Blur` · Family `Blur` · Classification `Processor` · ShortCode `b` · Keywords `blur`

> Blur diffuses sharp shapes and softens the terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Blur** *(分组标题)* | — | — | `[Group]` 由 `Radius` 声明 |
| Radius | Single `float` | `0.1f`，范围 0f … 2f |  |

### Clamp

`QuadSpinner.Gaea.Nodes.Clamp` · Family `Adjust` · Classification `Processor` · ShortCode `cl` · Keywords `clamp`

> Clamp controls the height of the terrain. You can squash the terrain, clip it at certain heights, or make it taller using the Extend operation.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Mode | Enum `ClampMode` | `ClampMode.Standard`，范围 0f … 1f | `Standard` — Applies a fixed minimum and maximum clamp to the input values, preserving their original scale.<br>`Normalized` — Clamps and remaps the input values to a normalized 0–1 range, ensuring consistent output regardless of the original scale. |
| Value | Float2 `Float2` | `0f`，范围 0f … 1f | Sets the clamp threshold or range. Values outside this range are limited to the specified minimum or maximum. |
| Drop | Boolean `bool` | — | Lowers the overall shape to lowest value, ie 'dropping' the entire shape to the 'floor'. |

### Clip

`QuadSpinner.Gaea.Nodes.Clip` · Family `Adjust` · Classification `Processor` · ShortCode `ci` · Keywords `clip`

> Cuts the terrain against a threshold, removing values above or below a specified level.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Clip** *(分组标题)* | — | — | `[Group]` 由 `Min`, `Max`, `AutoClip` 声明 |
| Min | Single `float` | `0f`，范围 0f … 1f |  |
| Max | Single `float` | `1f`，范围 0f … 1f |  |
| Auto Clip | Boolean `bool` | `false`，范围 0f … 1f |  |

### Curve

`QuadSpinner.Gaea.Nodes.Curve` · Family `Profile` · Classification `Processor` · ShortCode `cu` · Keywords `curve`

> Curve adjusts the height curve of a terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Curve Spline | List`1 `List<Float2>` | (Custom，默认值在混淆常量表中) | Defines the shape of the curve or spline used to remap or adjust values. The curve controls how input values are transformed, allowing for custom response profiles or non-linear adjustments. |
| Mode | Enum `AbsoluteRelative` | `AbsoluteRelative.Absolute`，范围 0f … 1f | `Absolute` — Applies the curve using absolute input values, mapping the entire range directly according to the curve shape.<br>`Relative` — Applies the curve relative to the input's current range or context, allowing for adaptive or proportional remapping. |
| Fit Curve | Command `bool` | (Command，默认值在混淆常量表中) | Automatically fits or scales the curve to match the input range, ensuring the curve covers the full extent of the data.<br>*C# 属性 `FitCurve`* |

### Deflate

`QuadSpinner.Gaea.Nodes.Deflate` · Family `Profile` · Classification `Processor` · ShortCode `df`

> Compresses and pulls terrain features inward, reducing bulk and prominence.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Amount | Single `float` | `0.5f`，范围 0f … 1f | Controls the degree to which the terrain is compressed or lowered. Higher values result in a more pronounced flattening or reduction of elevation, effectively 'deflating' the terrain features. |

### Denoise

`QuadSpinner.Gaea.Nodes.Denoise` · Family `Adjust` · Classification `Processor` · ShortCode `dn`

> Denoise is a general purpose noise removal filter that systematically cleans up random noise, spikes, and extremely sharp edges.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Type | Enum `DenoiseType` | (HorizontalList，默认值在混淆常量表中) | `OnePass` — Runs a single denoise pass for fast, moderate smoothing.<br>`TwoPass` — Runs a stronger two-stage denoise for cleaner results with better feature retention.<br>`Pixels` — Targets pixel-level speckle and stair-stepping artifacts, focusing on discrete noisy pixels. |
| Amount | Single `float` | `0.5f`，范围 0f … 1f | Strength of the denoising effect (higher values smooth more, but can soften detail). |
| Passes | Int32 `int` | `1`，范围 1 … 10 | Number of denoise iterations to apply for the selected method. |

### Dilate

`QuadSpinner.Gaea.Nodes.Dilate` · Family `Transform` · Classification `Processor` · ShortCode `di`

> Dilate the pixels of the heightfield or mask.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `0.01`，范围 0f … 1f | Sets the size of the dilation effect. Larger values expand features more, increasing the reach of the dilation. |
| Shape | Single `float` | `0f`，范围 -1f … 1f | Specifies the geometric shape used for the dilation operation, affecting how features are expanded. |
| Iterations | Int32 `int` | `1`，范围 1 … 25 | Controls how many times the dilation process is repeated. More iterations result in greater expansion of features. |
| Kernel | Enum `KernalType` | `KernalType.Cross`，范围 0f … 1f | `Cross` — Uses a cross-shaped kernel, expanding features in horizontal and vertical directions.<br>`Rectangle` — Uses a rectangular kernel, expanding features uniformly in all directions.<br>`Line` — Uses a line-shaped kernel, expanding features along a specified direction.<br>`LineVertical` — Uses a vertical line kernel, expanding features only in the vertical direction. |
| Invert | Boolean `bool` | `false`，范围 0f … 1f | Inverts the input before applying dilation, causing the operation to expand background areas instead of foreground features. |

### DirectionalWarp

`QuadSpinner.Gaea.Nodes.DirectionalWarp` · Family `Warp` · Classification `Processor` · ShortCode `dw` · Keywords `directional warp`

> DWarp or Directional Warp uses a secondary input to warp the first input in a uniform direction.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Strength | Single `float` | `0.25f`，范围 0f … 5f |  |
| Direction | Single `float` | `45f`，范围 0f … 360f |  |
| Edge Behaviour | Enum `EdgeBehaviour` | `EdgeBehaviour.Mirror`，范围 0f … 1f | `Edge` — <desc><br>`Mirror` — <desc><br>*C# 属性 `EdgeBehaviour`* |

### Distance

`QuadSpinner.Gaea.Nodes.Distance` · Family `Transform` · Classification `Processor` · ShortCode `rt`

> Generates a distance field from the input, measuring how far each point is from the nearest boundary or feature.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Method | Enum `DistanceMode` | `DistanceMode.RT`，范围 0f … 1f | `Classic` — Uses the standard distance calculation method, suitable for most general purposes.<br>`RT` — Uses a real-time optimized distance calculation, providing faster results for interactive workflows. |
| Mode | Enum `DistanceRTStyle` | `DistanceRTStyle.Asterisk`，范围 0f … 1f | `Asterisk` — Calculates distance in a star-shaped (asterisk) pattern, radiating out in multiple directions.<br>`Pyramid` — Calculates distance in a pyramid or diamond pattern, emphasizing diagonal and orthogonal propagation. |
| Directions | Int32 `int` | `3`，范围 1 … 24 | Sets the number of directions in which distance is calculated, influencing the angular resolution and smoothness of the result. |
| Skew | Single `float` | `0f`，范围 -1f … 1f | Applies a skew or bias to the distance field, distorting the propagation direction for creative or technical effects. |
| Angle | Single `float` | `0f`，范围 0f … 360f | Specifies the primary angle or orientation for directional distance calculations, allowing for anisotropic effects. |
| Angular Jitter | Single `float` | `0f`，范围 0f … 2f | Introduces randomness to the angle of distance propagation, creating more organic and less uniform distance fields. |
| Falloff | Single `float` | `0.5f`，范围 0f … 1f | Controls how quickly the distance value decreases with increasing distance from the source, shaping the gradient of the field. |
| Threshold | Single `float` | `0.5f`，范围 0f … 1f | Sets a cutoff value for the distance field. Values beyond this threshold are clamped or ignored. |
| Falloff Jitter | Single `float` | `0f`，范围 0f … 1f | Adds randomness to the falloff rate, producing irregular or natural-looking distance gradients. |
| **Options** *(分组标题)* | — | — | `[Group]` 由 `InvertInput`, `InvertOutput`, `MultiplyByInput`, `Seed` 声明 |
| Invert Input | Boolean `bool` | — | Inverts the input mask or field before calculating distance, reversing the source and background. |
| Invert Output | Boolean `bool` | — | Inverts the resulting distance field, swapping near and far values. |
| Multiply by Input | Boolean `bool` | — | Multiplies the final distance field by the original input, masking or modulating the result. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for any stochastic elements in the distance calculation, ensuring reproducible or varied results. |

### Equalize

`QuadSpinner.Gaea.Nodes.Equalize` · Family `Adjust` · Classification `Processor` · ShortCode `eq`

> Redistributes the input values to balance the histogram and reveal more detail across the range.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Factor | Single `float` | `1f`，范围 0f … 1f |  |

### Extend

`QuadSpinner.Gaea.Nodes.Extend` · Family `Adjust` · Classification `Processor` · ShortCode `xt` · Keywords `extend`

> Expands the terrain range beyond its current limits, effectively stretching elevation values.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Extend** *(分组标题)* | — | — | `[Group]` 由 `Value` 声明 |
| Value | Float2 `Float2` | `0f`，范围 0f … 1f |  |

### Filter

`QuadSpinner.Gaea.Nodes.Filter` · Family `Profile` · Classification `Processor` · ShortCode `fi`

> Applies profile-based filtering to reshape terrain values and refine feature response.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Mode | Enum `FilterMode` | `FilterMode.LowPass`，范围 0f … 1f | `LowPass` — Keeps large-scale forms and smooths out high-frequency detail.<br>`HighPass` — Keeps fine detail and removes broad, low-frequency forms.<br>`LowShelf` — Boosts or cuts low frequencies while leaving higher frequencies mostly unchanged.<br>`HighShelf` — Boosts or cuts high frequencies while leaving lower frequencies mostly unchanged.<br>`BandPass` — Keeps a band of mid frequencies and attenuates both low and high frequencies outside the band.<br>`Notch` — Removes a narrow band of frequencies while leaving the rest mostly unchanged.<br>`Bell` — Boosts or cuts a centered frequency band with a controllable bandwidth. |
| Frequency | Single `float` | `0.5f`，范围 0f … 1f | The center/cutoff frequency of the filter (controls which detail scale is affected). |
| Gain | Single `float` | `1f`，范围 0f … 5f | Amount of boost or cut applied (used by shelf and bell modes). |
| Q | Single `float` | `0.5f`，范围 0f … 1f | Filter sharpness/bandwidth (higher Q = narrower, more selective band; lower Q = broader influence). |
| Keep DC | Boolean `bool` | `false`，范围 0f … 1f | Preserves the overall baseline/average height (DC offset) so the filter affects detail without shifting the mean elevation. |

### Flip

`QuadSpinner.Gaea.Nodes.Flip` · Family `Adjust` · Classification `Processor` · ShortCode `fp`

> Flip flips the terrain horizontally, vertically, or both.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Type | Enum `FlipType` | (HorizontalList，默认值在混淆常量表中) | `X` — Flips the input horizontally (mirrors along the X axis).<br>`Y` — Flips the input vertically (mirrors along the Y axis).<br>`XY` — Flips both axes (180° mirror of the input). |

### Fold

`QuadSpinner.Gaea.Nodes.Fold` · Family `Profile` · Classification `Processor` · ShortCode `fo` · Keywords `sine mirror`

> Fold simulates terrain folding by introducing slants, breaks, and folds to the terrain. It significantly changes the terrain shape and should be used early in the graph.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Waveform | Enum `FoldWaveform` | `FoldWaveform.Sine`，范围 0f … 1f | `Sine` — Applies a smooth, sinusoidal wave pattern, creating gentle, rolling folds.<br>`Triangle` — Applies a triangular wave pattern, resulting in sharp, angular folds with linear transitions.<br>`Sawtooth` — Applies a sawtooth wave pattern, producing repeating, ramp-like folds with abrupt drops. |
| Folds | Single `float` | `2.0`，范围 0f … 10f | Controls the number of folds or wave repetitions applied across the terrain. Higher values create more frequent, closely spaced folds. |
| Symmetric | Boolean `bool` | `true`，范围 0f … 1f | Determines whether the folds are mirrored symmetrically across the center, producing balanced, repeating patterns. |

### GraphicEQ

`QuadSpinner.Gaea.Nodes.GraphicEQ` · Family `Profile` · Classification `Processor` · ShortCode `gq` · Keywords `geq gq graphiceq`

> Reshapes terrain using multiple adjustable bands, similar to an equalizer for height profiles.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Band 1 | Single `float` | `1f`，范围 0f … 2f |  |
| Band 2 | Single `float` | `1f`，范围 0f … 2f |  |
| Band 3 | Single `float` | `1f`，范围 0f … 2f |  |
| Band 4 | Single `float` | `1f`，范围 0f … 2f |  |
| Band 5 | Single `float` | `1f`，范围 0f … 2f |  |
| Band 6 | Single `float` | `1f`，范围 0f … 2f |  |
| Band 7 | Single `float` | `1f`，范围 0f … 2f |  |

### Heal

`QuadSpinner.Gaea.Nodes.Heal` · Family `Utilities` · Classification `Processor` · ShortCode `hl` · Keywords `reconstruct`

> Heal reconstructs damaged, low res, or 8-bit data with 16-bit, high resolution fidelity. It cleans up quantized images with extreme banding of any shape, and yields naturalistic terrain output.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Reconstruction | Single `float` | `0.3f`，范围 0f … 1f | Controls how aggressively missing or damaged areas are rebuilt from surrounding data (higher values preserve continuity but can soften detail). |
| Passes | Int32 `int` | `1`，范围 1 … 10 | Number of healing iterations to run; more passes produce a cleaner, more continuous surface but may blur fine detail. |

### Match

`QuadSpinner.Gaea.Nodes.Match` · Family `Adjust` · Classification `Processor`

> Matches the height range or histogram of one terrain to another.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Mode | Enum `MatchType` | `MatchType.Height`，范围 0f … 1f | `Height` — Directly matches the height values of the current terrain to the reference terrain, aligning elevation point-for-point.<br>`Histogram` — Matches the height distribution (histogram) of the current terrain to that of the reference terrain, preserving relative features while adjusting overall elevation statistics. |

### Median

`QuadSpinner.Gaea.Nodes.Median` · Family `Blur` · Classification `Processor` · ShortCode `md`

> Applies a median filter to remove spikes, speckles, and small noise while preserving edges better than blur.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Mode | Enum `MedianType` | `MedianType.Advanced2`，范围 0f … 1f | `Classic` — <desc><br>`Advanced` — <desc><br>`Advanced2` — <desc> |
| Strength | Enum `MedianStrength` | `MedianStrength.X1`，范围 0f … 1f | `X1` — <desc><br>`X2` — <desc><br>`X4` — <desc><br>`X8` — <desc> |
| Horizontal | Int32 `int` | `2`，范围 2 … 50 |  |
| Vertical | Int32 `int` | `2`，范围 2 … 50 |  |
| Iterations | Int32 `int` | `1`，范围 1 … 50 |  |
| Quality | Enum `MedianFilter.MedianQuality` | `MedianFilter.MedianQuality.Low`，范围 0f … 1f | `Low` — <desc><br>`Medium` — <desc><br>`High` — <desc> |

### Meshify

`QuadSpinner.Gaea.Nodes.Meshify` · Family `Shape` · Classification `Processor` · ShortCode `msf` · Keywords `meshify`

> Converts terrain into a faceted, mesh-like surface with controllable vertex density and detail sensitivity.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Meshify** *(分组标题)* | — | — | `[Group]` 由 `Vertices`, `Seed`, `DetailSensitivity` 声明 |
| Vertices | Single `float` | `10000f`，范围 4f … 1000000f | Sets the number of vertices used to construct the mesh facets. Higher values produce finer, more detailed meshes; lower values create larger, more pronounced facets. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for mesh facet arrangement. Changing the seed produces different polygonal patterns and facet layouts. |
| Detail Sensitivity | Single `float` | `0.5f`，范围 0f … 1f | Controls how closely the mesh facets follow the underlying terrain detail. Higher sensitivity preserves more terrain features; lower sensitivity results in smoother, more abstract faceting. |

### Origami

`QuadSpinner.Gaea.Nodes.Origami` · Family `Effect` · Classification `Processor` · ShortCode `or`

> Origami creates a diagonal multifold pattern, and can produce a highly stylized terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Amount | Single `float` | `0.25f`，范围 0.0001f … 1f | The amount of re-folding to be applied to the terrain. Low values create large folds; high values create tiny folds. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. Changing the seed produces different noise patterns. |

### Pixelate

`QuadSpinner.Gaea.Nodes.Pixelate` · Family `Effect` · Classification `Processor` · ShortCode `px`

> Converts the input into a blocky, pixelated version.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `0.15f`，范围 0f … 1f |  |
| Autosize | Boolean `bool` | `false`，范围 0f … 1f |  |
| Antialias | Boolean `bool` | `true`，范围 0f … 1f |  |

### Recurve

`QuadSpinner.Gaea.Nodes.Recurve` · Family `Profile` · Classification `Processor` · ShortCode `rc`

> Recurve is a curvature-based expander that inflates and/or deflates the terrain to create stronger slopes and larger, softer formations from a given noise or terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Power | Single `float` | `1f`，范围 0.01f … 2f | The strength of the inflate/deflate operation. Higher values cause drastic shifts in shape formation. |
| Scale | Single `float` | `0.1f`，范围 0.0001f … 1f | The amount of details to preserve. Higher values cause more prominent shapes to form. |
| Iterations | Int32 `int` | `3`，范围 1 … 50 |  |
| Style | Enum `RecurveStyle` | `RecurveStyle.Inward`，范围 0f … 1f | `Inward` — <desc><br>`Outward` — <desc> |

### Shaper

`QuadSpinner.Gaea.Nodes.Shaper` · Family `Profile` · Classification `Processor` · ShortCode `sp` · Keywords `shaper`

> Shaper bulks up or bulks down a terrain, while optionally retaining the finer details.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Shape | Single `float` | `0f`，范围 -1f … 1f | Negative values will bulk down the shape, while positive values will bulk up the shape. |
| Local Effect | Boolean `bool` | — | Limits the shaping effect to localized regions instead of applying it globally, allowing for targeted adjustments. |
| Local Area | Single `float` | `0.5f`，范围 0f … 1f | Specifies the size or extent of the local region affected when 'Local Effect' is enabled. Larger values increase the area of influence. |
| Maintain Fine Details | Boolean `bool` | — | When enabled, finer detail is preserved regardless of shape changes. |
| Detail Size | Single `float` | `0.75f`，范围 0f … 1f | Controls the scale of details to be preserved or affected during shaping. Smaller values focus on finer details, while larger values affect broader features. |

### Sharpen

`QuadSpinner.Gaea.Nodes.Sharpen` · Family `Adjust` · Classification `Processor` · ShortCode `sx`

> Sharpen enhances terrain edges and small structures by making them more prominent.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Method | Enum `SharpenMethod` | `SharpenMethod.Frequency`，范围 0f … 1f | `Edge` — Sharpens the terrain or texture by enhancing edges, making transitions between features more pronounced.<br>`Frequency` — Sharpens by boosting high-frequency details, increasing the clarity of fine structures and textures. |
| Amount | Single `float` | `0.5f`，范围 0f … 1f | The amount of sharpening to be applied to the structures. Higher values produce a stronger sharpening effect. |

### SlopeBlur

`QuadSpinner.Gaea.Nodes.SlopeBlur` · Family `Blur` · Classification `Processor` · ShortCode `sb` · Keywords `sblur`

> SlopeBlur is a versatile, low-level node that adds directional blurring based on the slopes of a Guide terrain or mask. It is one of our deceptively simple nodes that can create a wide array of shapes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Intensity | Single `float` | `0.25f`，范围 0f … 1f | Controls the strength of the slope blur effect. Higher values result in more pronounced blurring along the slope direction. |
| Iterations | Int32 `int` | `1`，范围 1 … 10 | Specifies how many times the slope blur operation is applied. More iterations increase the smoothness and diffusion of the blur. |
| Direction | Single `float` | `0f`，范围 -180f … 180f | Sets the primary direction in which the blur is applied. Adjusting this value changes the orientation of the blur effect across the terrain. |
| Asymmetry | Single `float` | `1f`，范围 -1f … 1f | Controls the asymmetry of the blur, allowing the effect to be stronger in one direction than the other for more natural or stylized results. |
| Normalized | Boolean `bool` | `false`，范围 0f … 1f | Lorem ipsum |
| Window | Enum `SlopeWindow` | (Enum，默认值在混淆常量表中) | `Bell` — <desc><br>`Box` — Uses a box-shaped window for uniform blurring, resulting in sharper transitions at the edges. |
| **Quality** *(分组标题)* | — | — | `[Group]` 由 `Quality`, `Antialiasing` 声明 |
| Quality | Enum `SlopeQuality` | (Enum，默认值在混淆常量表中) | `Low` — <desc><br>`Medium` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Antialiasing | Enum `SlopeAntialiasing` | (Enum，默认值在混淆常量表中) | `Off` — No antialiasing is applied. May result in sharper but potentially jagged edges.<br>`x4` — Applies 4x antialiasing for moderate smoothing of edges.<br>`x16` — Applies 16x antialiasing for maximum edge smoothing and highest visual quality. |

### SlopeWarp

`QuadSpinner.Gaea.Nodes.SlopeWarp` · Family `Warp` · Classification `Processor` · ShortCode `sw` · Keywords `swarp`

> SlopeBlur is a versatile, low-level node that adds directional warping based on the slopes of a Guide terrain or mask. It behaves similarly to SlopeBlur.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Intensity | Single `float` | `0.25f`，范围 0f … 1f | Controls the strength of the slope warp effect. Higher values produce more pronounced warping and distortion of the terrain along the slope. |
| Iterations | Int32 `int` | `1`，范围 1 … 10 | Specifies how many times the slope warp operation is applied. Increasing iterations can create more complex or exaggerated warping effects. |
| Direction | Single `float` | `0f`，范围 -180f … 180f | Sets the primary direction in which the slope warp is applied. Adjust this to control the orientation of the warping across the terrain. |
| Normalized | Boolean `bool` | — | When enabled, normalizes the effect so that the intensity is consistent regardless of terrain scale or resolution. |
| **Quality** *(分组标题)* | — | — | `[Group]` 由 `Quality`, `Antialiasing` 声明 |
| Quality | Enum `SlopeQuality` | (Enum，默认值在混淆常量表中) | `Low` — <desc><br>`Medium` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Antialiasing | Enum `SlopeAntialiasing` | (Enum，默认值在混淆常量表中) | `Off` — No antialiasing is applied. May result in sharper but potentially jagged edges.<br>`x4` — Applies 4x antialiasing for moderate smoothing of edges.<br>`x16` — Applies 16x antialiasing for maximum edge smoothing and highest visual quality. |

### SoftClip

`QuadSpinner.Gaea.Nodes.SoftClip` · Family `Profile` · Classification `Processor` · ShortCode `sc` · Keywords `softclip`

> SoftClip a low-level utility that lets you softly reduce the intensity of shapes above a specified threshold. It can be comparable to masking a shape with a Height node and then clamping that portion.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Clip Mode | Enum `ClipMode` | `ClipMode.AboveThreshold`，范围 0f … 1f | `AboveThreshold` — Applies soft clipping to values above the threshold, gently compressing high values toward the threshold.<br>`BelowThreshold` — Applies soft clipping to values below the threshold, gently compressing low values toward the threshold. |
| Threshold | Single `float` | `0.5f`，范围 0f … 1f | Sets the value at which soft clipping begins. Values above or below this threshold (depending on mode) will be affected. |
| Softness | Single `float` | `0.1f`，范围 0f … 1f | Controls the smoothness of the transition at the threshold. Higher values create a more gradual, less abrupt clipping effect. |
| Clipping | Single `float` | `1f`，范围 0f … 1f | Adjusts the overall strength of the clipping effect, determining how much values are compressed toward the threshold. |

### Swirl

`QuadSpinner.Gaea.Nodes.Swirl` · Family `Effect` · Classification `Processor` · ShortCode `swi`

> Swirl creates a vortex warp on the terrain. Very useful for adding a fluid look.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `0.15f`，范围 0f … 1f |  |
| X | Single `float` | `0.5`，范围 0f … 1f | Horizontal placement of swirl. |
| Y | Single `float` | `0.5`，范围 0f … 1f | Vertical placement of swirl. |

### ThermalShaper

`QuadSpinner.Gaea.Nodes.ThermalShaper` · Family `Profile` · Classification `Processor` · ShortCode `ts`

> ThermalShaper is a fast, basic simulation of the concavity and convexity that can be achieved from thermal erosion. The effect can be exaggerated for artistic effect.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Influence | Single `float` | `0.5f`，范围 0f … 1f | Controls the overall strength of the thermal shaping effect applied to the input terrain. Higher values increase the impact, blending more of the thermal shaping with the original terrain. Mid-range values provide a balance between the effect and the source terrain. |
| Shape | Single `float` | `-0.25f`，范围 -1f … 1f | Adjusts the shaping style of the terrain. Negative values condense the terrain into sharp, concise ridges, while positive values bulk up the terrain, creating softer, more rounded features. |
| Scale | Single `float` | `20f`，范围 1f … 250f | Sets the scale at which the thermal shaping is applied. Lower values focus the effect on smaller details and individual ridges, while higher values apply the shaping to larger terrain features, affecting broader mountain ranges. |
| Microdetail Preservation | Single `float` | `0.5f`，范围 0f … 1f | Preserves fine details from the original terrain during thermal shaping. Higher values maintain more microdetail, such as rocky textures and small features, while lower values result in smoother, more uniform terrain. |

### Threshold

`QuadSpinner.Gaea.Nodes.Threshold` · Family `Adjust` · Classification `Processor` · ShortCode `th` · Keywords `threshold`

> Abs can modify the terrain or mask it by eliminating values higher or lower than the exact value specified.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Level | Single `float` | `0.5`，范围 0f … 1f | Specifies the threshold value used to separate terrain features. Values above this level are retained, while values below are discarded or set to a minimum. Adjusting the level controls the cutoff point for terrain masking or feature isolation. |

### Transform

`QuadSpinner.Gaea.Nodes.Transform` · Family `Transform` · Classification `Processor` · ShortCode `t`

> Transform moves, rotates, and scales any terrain. A post-process effect, it can be implemented at any point in the graph.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Position** *(分组标题)* | — | — | `[Group]` 由 `OffsetX`, `OffsetY`, `OffsetZ` 声明 |
| Offset X | Single `float` | `0f`，范围 -1f … 1f | Shifts the terrain or object horizontally along the X axis, allowing precise placement within the scene. |
| Offset Y | Single `float` | `0f`，范围 -1f … 1f | Shifts the terrain or object horizontally along the Y axis, moving it forward or backward in the workspace. |
| Offset Z | Single `float` | `1f`，范围 0f … 2f | Moves the terrain or object vertically along the Z axis, raising or lowering its elevation. |
| **Scale** *(分组标题)* | — | — | `[Group]` 由 `Uniform`, `Scale`, `ScaleX`, `ScaleY` 声明 |
| Uniform | Boolean `bool` | `true`，范围 0f … 1f | Applies uniform scaling to all axes, maintaining the original proportions of the terrain or object. |
| Scale | Single `float` | `1f`，范围 0.0001f … 10f | Applies uniform scaling to all axes, maintaining the original proportions of the terrain or object. |
| Scale X | Single `float` | `1f`，范围 0.0001f … 10f | The non-uniform scale on the X axis, allowing independent horizontal stretching or compression. |
| Scale Y | Single `float` | `1f`，范围 0.0001f … 10f | The non-uniform scale on the Y axis, allowing independent vertical stretching or compression. |
| **Rotation** *(分组标题)* | — | — | `[Group]` 由 `Rotate` 声明 |
| Angle | Single `float` | `0f`，范围 0f … 360f | The angle of rotation applied to the terrain or object, measured in degrees.<br>*C# 属性 `Rotate`* |
| **Settings** *(分组标题)* | — | — | `[Group]` 由 `BlendMode`, `Edges`, `Quality` 声明 |
| Blend Mode | Enum `Transformer.BlendMode` | `Transformer.BlendMode.Blend`，范围 0f … 1f | `None` — No blending is applied; the transformed data overwrites the input.<br>`Blend` — Blends the transformed data with the input using standard alpha or linear blending.<br>`Add` — Adds the transformed values to the input, increasing elevation or intensity.<br>`Subtract` — Subtracts the transformed values from the input, creating depressions or reductions.<br>`Difference` — Emphasizes the difference between the transformed data and the input.<br>`Multiply` — Multiplies the transformed data with the input, modulating the result.<br>`Screen` — Uses a screen blend, lightening the result where both inputs are present.<br>`Max` — Takes the maximum value between the transformed data and the input at each point.<br>`Min` — Takes the minimum value between the transformed data and the input at each point. |
| Edges | Enum `EdgeFade` | `EdgeFade.None`，范围 0f … 1f | `None` — No special edge handling; edges may be abrupt or unblended.<br>`Thin` — Applies a thin edge blend, softening the transition at the boundaries.<br>`Wide` — Applies a wide edge blend, creating a broader transition zone at the boundaries.<br>`Soft` — Applies a soft, gradual edge blend for smooth transitions. |
| Quality | Enum `ResizeQuality` | `ResizeQuality.Medium`，范围 0f … 1f | `Draft` — Fastest processing with lower quality, suitable for previews.<br>`Medium` — Balanced quality and performance for general use.<br>`High` — Highest quality with the most detail, recommended for final output. |

### Transform3D

`QuadSpinner.Gaea.Nodes.Transform3D` · Family `Transform` · Classification `Processor` · ShortCode `t3`

> Applies full 3D transformation to the terrain, including rotation and spatial adjustment.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Position** *(分组标题)* | — | — | `[Group]` 由 `DropToFloor`, `OffsetX`, `OffsetY`, `OffsetZ` 声明 |
| Drop to Floor | Boolean `bool` | `false`，范围 0f … 1f | Automatically positions the object so its lowest point rests on the ground plane, preventing it from floating or being embedded below the surface.<br>*C# 属性 `DropToFloor`* |
| Offset X | Single `float` | `0f`，范围 -1f … 1f | Shifts the object horizontally along the X axis, allowing precise placement within the 3D space. |
| Offset Y | Single `float` | `0f`，范围 -1f … 1f | Shifts the object horizontally along the Y axis, moving it forward or backward in the 3D scene. |
| Offset Z | Single `float` | `0f`，范围 -1f … 1f | Moves the object vertically along the Z axis, raising or lowering its elevation relative to the ground. |
| **Scale** *(分组标题)* | — | — | `[Group]` 由 `Scale` 声明 |
| Scale | Single `float` | `1f`，范围 0.001f … 2f | Group containing parameters for scaling the object or mesh, affecting its size and proportions in 3D space. |
| **Rotation** *(分组标题)* | — | — | `[Group]` 由 `Pitch`, `Yaw`, `Roll` 声明 |
| Pitch | Single `float` | `0f`，范围 -180f … 180f | Rotates the object around the X axis, tilting it forward or backward. |
| Yaw | Single `float` | `0f`，范围 -180f … 180f | Rotates the object around the Y axis, turning it left or right. |
| Roll | Single `float` | `0f`，范围 -180f … 180f | Rotates the object around the Z axis, spinning it clockwise or counterclockwise. |
| **Quality** *(分组标题)* | — | — | `[Group]` 由 `Antialiasing` 声明 |
| Antialiasing | Boolean `bool` | `false`，范围 0f … 1f | Enables or adjusts antialiasing for the 3D transformation, reducing jagged edges and improving visual smoothness. |

### Transpose

`QuadSpinner.Gaea.Nodes.Transpose` · Family `Adjust` · Classification `Processor` · ShortCode `tx`

> Adapts the terrain to the substructures of a given reference terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Mode | Enum `TransposeMode` | (HorizontalList，默认值在混淆常量表中) | `Transpose` — Swaps the X and Y axes of the input, effectively rotating the terrain or image by 90 degrees.<br>`Embed` — Inserts the transposed data into a larger canvas or area, preserving the original orientation within a new context.<br>`Insert` — Places the transposed data into a specific position within the output, allowing for targeted rearrangement. |
| Amount | Single `float` | `1f`，范围 0f … 1f | Controls the degree or strength of the transposition effect, allowing for partial or full transformation. |
| Extend | Single `float` | `0f`，范围 0f … 1f | Determines whether the output is extended to accommodate the transposed data, preventing cropping or loss of information. |
| Flatten | Single `float` | `0f`，范围 0f … 1f | Flattens the result after transposition, removing any elevation or depth variations if enabled. |
| Threshold | Single `float` | `0.01`，范围 0f … 1f | Sets a cutoff value for the transposition effect, limiting the transformation to areas above or below the specified threshold. |
| Boundary | Single `float` | `0.3f`，范围 0f … 1f | Defines how the edges or boundaries are handled during transposition, such as wrapping, clamping, or mirroring. |

### VariableBlur

`QuadSpinner.Gaea.Nodes.VariableBlur` · Family `Blur` · Classification `Processor` · ShortCode `vb`

> Blurs the input by varying the blur amount across the surface using local data or a guide.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Blur** *(分组标题)* | — | — | `[Group]` 由 `Radius` 声明 |
| Radius | Single `float` | `0.01f`，范围 0f … 1f | Controls the blur radius for each pixel. The radius can vary across the image, enabling localized or mask-driven blur effects. |

### Warp

`QuadSpinner.Gaea.Nodes.Warp` · Family `Warp` · Classification `Processor` · ShortCode `w` · Keywords `warp`

> Warp can take the terrain and "warp" the shape creating more believable shapes or alter simple shapes into a more complex formation. It can help breakup masks too.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Warp** *(分组标题)* | — | — | `[Group]` 由 `Size`, `Strength`, `ZScale`, `NoiseType` 声明 |
| Size | Single `float` | `0.5f`，范围 0f … 1f | The size of the warp noise. Controls the scale of the distortion pattern applied to the input. |
| Strength | Single `float` | `0.5f`，范围 0f … 1f | The strength of the warp noise. Higher values produce more pronounced distortions. |
| Z Scale | Single `float` | `0f`，范围 0f … 1f | Vertical axis scale for the noise, affecting the intensity of the warp along the Z (height) axis.<br>*C# 属性 `ZScale`* |
| Warp Source | Enum `WarpNoiseType` | `WarpNoiseType.PerlinFBM`，范围 0f … 1f | `PerlinFBM` — Uses Perlin fractal Brownian motion noise as the warp source, producing smooth, natural distortions.<br>`VoronoiR` — Uses Voronoi (R) noise as the warp source, creating cell-like, ridged distortions.<br>`VoronoiP` — Uses Voronoi (P) noise as the warp source, suitable for generating mountainous or peak-like distortions.<br>`VoronoiA` — Uses Voronoi (A) noise as the warp source, blending characteristics of other Voronoi types for varied effects.<br>`VoronoiS` — Uses Voronoi (S) noise as the warp source, emphasizing separated, individual cell boundaries.<br>`VoronoiM` — Uses Voronoi (M) noise as the warp source, favoring dominant cells for strong, directional warping.<br>`VoronoiD` — Uses Voronoi (D) noise as the warp source, emphasizing ridges and linear features in the distortion.<br>*C# 属性 `NoiseType`* |
| Perturbation | Single `float` | `0.5f`，范围 0f … 1f | Applies additional random displacement to the warp, increasing the irregularity and complexity of the effect. |
| Complexity | Int32 `int` | `12`，范围 1 … 12 | The complexity of the warp noise source. Higher values add more detail and layers to the distortion. |
| Roughness | Single `float` | `0.4f`，范围 0f … 1f | The roughness of the warp noise. Higher values (especially above 0.5) create harsher, more jagged distortions. |
| Normalized | Boolean `bool` | — | Specifies whether the noise is normalized. Normalization ensures the output remains within a standard range. |
| Edge Behaviour | Enum `EdgeBehaviour` | `EdgeBehaviour.Mirror`，范围 0f … 1f | `Edge` — Applies standard edge handling, which may result in wrapping or stretching at the borders.<br>`Mirror` — Edge pixels are mirrored, creating seamless, reflected borders for the warp effect.<br>*C# 属性 `EdgeBehaviour`* |
| Modulation | Single `float` | `0f`，范围 0f … 1f | The amount of modulation to use from the Modulation input (if connected), allowing external control over the warp intensity. |
| Modulation Direction | Single `float` | `45.0`，范围 0f … 360f | Sets the direction of the modulation, controlling how the modulation input influences the warp.<br>*C# 属性 `ModulationDirection`* |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. Changing the seed produces different warp results. |
| **Iterative** *(分组标题)* | — | — | `[Group]` 由 `Iterations`, `Mode` 声明 |
| Iterations | Int32 `int` | `1`，范围 1 … 50 | Number of warp iterations to apply. More iterations increase the complexity and layering of the distortion. |
| Mode | Enum `WarpMode` | `WarpMode.VectorField`，范围 0f … 1f | `Bitmap` — Applies the warp using standard bitmap-based processing for each iteration.<br>`VectorField` — Uses a vector field to guide the warp, allowing for more directional and flow-based distortions.<br>`VectorFieldIntegral` — Integrates the vector field over multiple passes, producing complex, cumulative warp effects. |

### Whorl

`QuadSpinner.Gaea.Nodes.Whorl` · Family `Effect` · Classification `Processor` · ShortCode `wh`

> Whorl applies multiple vortex-like distortions across the terrain to create large-scale warping. Very useful for creating massive landscapes without a patterning in the noise and for creating slightly surreal or alien landscapes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Type | Enum `WhorlType` | `WhorlType.Stretch`，范围 0f … 1f | `Stretch` — Whorls appear as stretched, interconnected formations.<br>`Spin` — Whorls appear as round, independent formations. |
| Whorls | Int32 `int` | `10`，范围 3 … 150 | The number of whorls to add to the terrain. |
| Power | Single `float` | `0.3f`，范围 0f … 3f | The strength of the distortion applied with each whorl. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

## Surface

*地表材质与纹理派生：岩石、沙、雪、土壤、风化* — `NodeCategory.Surface`，共 21 个节点。

### Bomber

`QuadSpinner.Gaea.Nodes.Bomber` · Family `Scatter` · Classification `Processor` · ShortCode `bo`

> Bomber takes an input heightfield and "stamps" or bombs it across the entire terrain surface using the randomization properties you set.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口；可变输入，最多 10。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Iterations | Int32 `int` | `50`，范围 2 … 500 | Number of instances the bombing operation will create. Higher values increase the number of scattered elements. |
| Multiplier | Single `float` | `1f`，范围 0f … 100f | Quickly multiply the number of bombed instances by increasing or decreasing this value, scaling the overall density. |
| Size | Float2 `Float2` | `0.2f`，范围 0f … 1f | The minimum and maximum relative size of bombed instances, allowing for variation in the scale of each element. |
| Size Distribution | Single `float` | `1f`，范围 0f … 1f | Controls the uniformity of the size of bombed instances. Higher values produce more consistent sizes, while lower values allow greater variation. |
| Rotation | Float2 `Float2` | `0f`，范围 0f … 1f | The minimum and maximum range of rotations for the bombed instances, introducing random orientation for each element. |
| Proportional | Boolean `bool` | `true`，范围 0f … 1f | Determines whether instances should maintain height-to-size proportion. When enabled, scaling an instance will also scale its height proportionally.<br>*C# 属性 `MaintainProportions`* |
| Variable Height | Boolean `bool` | `false`，范围 0f … 1f | Allows variations in the height of bombed instances, introducing additional randomness to their elevation. |
| Height | Float2 `Float2` | `0.8f`，范围 0f … 1f | The minimum and maximum range of height variations for the bombed instances, controlling how tall or flat each element can be. |
| Distribution | Enum `BombDistribution` | `BombDistribution.Random`，范围 0f … 1f | `Random` — A randomized distribution that results in pure chaotic patterns, scattering instances unpredictably.<br>`Grid` — A normalized grid distribution function that results in a systematic, evenly spaced pattern. |
| Jitter | Single `float` | `0f`，范围 0f … 1f | The random offset applied to each instance while distributing, adding natural variation to their placement. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. Changing the seed produces different distribution patterns. |
| Fade Edges | Boolean `bool` | `false`，范围 0f … 1f | Softens the edges of bombed instances, blending them more smoothly into the base terrain. |
| Blend Mode | Enum `BombBlendMode` | `BombBlendMode.Max`，范围 0f … 1f | `None` — Each instance overwrites the underlying terrain at its location.<br>`Blend` — Blends instances with the base terrain using standard blending.<br>`Add` — Adds the height values of instances on top of the base terrain.<br>`Subtract` — Subtracts each instance from the base and previous instances, creating depressions.<br>`Difference` — Creates a difference between the base and each bombed instance, emphasizing changes.<br>`Multiply` — Multiplies the base terrain with each bombed instance, modulating the result.<br>`Screen` — Adds the two inputs without overexposing the output, resulting in a lighter blend.<br>`Max` — Retains the maximum height values of each bombed instance and the base terrain.<br>`Min` — Retains the minimum height values of each bombed instance and the base terrain. |
| Quality | Enum `ResizeQuality` | `ResizeQuality.Medium`，范围 0f … 1f | `Draft` — Fastest processing with lower quality, suitable for previews.<br>`Medium` — Balanced quality and performance for general use.<br>`High` — Highest quality with the most detail, recommended for final output. |
| Add Input | Command `bool` | `"port-connect"` | Allows an additional input to be included in the bombing operation, enabling more complex or layered effects.<br>*C# 属性 `AddInput`* |

### Bulbous

`QuadSpinner.Gaea.Nodes.Bulbous` · Family `Structure` · Classification `Processor` · ShortCode `bu`

> Bulbous inflates existing shapes to make them more voluminous while respecting standard geological boundaries.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `0.5f`，范围 0f … 1f |  |
| Jitter | Single `float` | `0f`，范围 0f … 1f |  |

### Contours

`QuadSpinner.Gaea.Nodes.Contours` · Family `Cartography` · Classification `Mask` · ShortCode `cn`

> Creates map-like contours for a terrain. Useful for making maps or for other overlays.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Count | Int32 `int` | `36`，范围 8 … 256 | Sets the number of main contour lines to generate. Higher values create more elevation bands across the terrain. |
| Subdivision | Int32 `int` | `6`，范围 1 … 10 | Controls the number of subdivisions between main contour lines, adding finer detail and intermediate lines. |
| Accuracy | Single `float` | `0.7f`，范围 0f … 1f | Adjusts the precision of contour line placement. Higher accuracy produces more exact lines that closely follow the terrain's elevation. |
| **Lines** *(分组标题)* | — | — | `[Group]` 由 `LineIntensity`, `SubIntensity`, `LineThickness` 声明 |
| Line Intensity | Single `float` | `1f`，范围 0f … 1f | Controls the brightness or opacity of the main contour lines, making them more or less prominent in the output. |
| Sub Intensity | Single `float` | `0.25f`，范围 0f … 1f | Adjusts the brightness or opacity of the subdivision lines, which are the finer lines between main contours. |
| Line Thickness | Int32 `int` | `1`，范围 1 … 20 | Specifies the thickness of the contour lines. Higher values produce bolder, wider lines. |

### Craggy

`QuadSpinner.Gaea.Nodes.Craggy` · Family `Rocky` · Classification `Generator` · ShortCode `cg`

> Turns a terrain's surface into a craggy, rocky, broken landscape.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `1.5f`，范围 0.2f … 2f | Controls the overall scale of the craggy features. Higher values produce larger cracked rock formations on the surface. |
| Depth | Single `float` | `0.5f`，范围 0f … 1f | Sets the depth or prominence of the cracks and rock features, determining how pronounced the craggy shapes appear. |
| Shape | Single `float` | `0.5f`，范围 0f … 1f | Defines the overall form and pattern of the cracked rock shapes, affecting their outline and distribution. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for generating unique variations of the craggy rock patterns. Changing the seed produces different results. |

### Distress

`QuadSpinner.Gaea.Nodes.Distress` · Family `Superficial` · Classification `Processor` · ShortCode `dst`

> Adds superficial wear, breakup, and irregular damage to a surface.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Octaves | Int32 `int` | `10`，范围 10 … 50 |  |
| Scale | Single `float` | `0.8f`，范围 0f … 1f |  |
| Depth | Single `float` | `0.33f`，范围 0f … 1f |  |
| Influence | Single `float` | `0.8f`，范围 0f … 1f |  |
| Formation | Single `float` | `0.8f`，范围 0f … 1f |  |
| Scale X | Single `float` | `1f`，范围 0.0001f … 100f |  |
| Scale Y | Single `float` | `1f`，范围 0.0001f … 100f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |

### FractalTerraces

`QuadSpinner.Gaea.Nodes.FractalTerraces` · Family `Terrace` · Classification `Processor` · ShortCode `ft` · Keywords `fractalterraces`

> FractalTerraces creates fractal terracing on the terrain. It is a powerful alternative to the Terrace node.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Spacing | Single `float` | `0.1`，范围 0f … 1f | Sets the space between two terraces. Controls the horizontal distance or interval between each terrace step. |
| Octaves | Int32 `int` | `12`，范围 1 … 12 | Specifies the number of terraces to generate, including subtle sub-terraces. Higher values create more layers and finer detail. |
| Intensity | Single `float` | `0.5`，范围 0f … 1f | Controls the strength of the terracing process. Higher intensities flatten the terraces, making the steps more pronounced. |
| Shape | Single `float` | `0f`，范围 -1f … 1f | Defines the general shape of the terraces. Lower values create steeper terraces that follow the terrain's bulk, while higher values produce smoother terraces that protrude outward. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for the node's process. Changing the seed produces different terrace arrangements. |
| **Advanced** *(分组标题)* | — | — | `[Group]` 由 `ShapesSeparation`, `MacroOctaves`, `MicroShape`, `Character` 声明 |
| Shapes separation | Boolean `bool` | — | Controls how distinctly individual terrace shapes are separated from each other, affecting the clarity of terrace boundaries.<br>*C# 属性 `ShapesSeparation`* |
| Macro octaves | Int32 `int` | `5`，范围 1 … 12 | Sets the number of large-scale terrace layers, influencing the overall structure and major steps in the terrain.<br>*C# 属性 `MacroOctaves`* |
| Micro shape | Single `float` | `-0f`，范围 -1f … 1f | Adjusts the fine detail and small-scale shaping of terraces, adding subtle variations to each step.<br>*C# 属性 `MicroShape`* |
| Character | Single `float` | `0f`，范围 0f … 1f | Modifies the overall character or style of the terraces, such as their ruggedness or smoothness. |
| Thickness uniformity | Single `float` | `0f`，范围 0f … 1f | Controls how consistent the thickness of each terrace step is across the terrain. Higher values produce more uniform terraces.<br>*C# 属性 `ThicknessUniformity`* |
| Hardness uniformity | Single `float` | `0f`，范围 0f … 1f | Adjusts the consistency of terrace edge hardness, affecting whether terrace boundaries are sharp or soft throughout.<br>*C# 属性 `HardnessUniformity`* |
| Strata details | Single `float` | `0.6`，范围 0f … 1f | Adds additional detail to the strata or layers within the terraces, enhancing geological realism.<br>*C# 属性 `StrataDetails`* |
| Protect Range | Boolean `bool` | — | Defines a range within which the original terrain is protected from terracing, preserving natural features in specified areas.<br>*C# 属性 `ProtectRange`* |
| **Tilt** *(分组标题)* | — | — | `[Group]` 由 `ApplyTilt`, `TiltAmount`, `Direction`, `TiltSeed` 声明 |
| Apply Tilt | Boolean `bool` | — | Enables or disables the tilt effect, allowing terraces to be slanted in a specified direction.<br>*C# 属性 `ApplyTilt`* |
| Tilt Amount | Single `float` | `0.5`，范围 0f … 1f | Sets the degree of tilt applied to the terraces, controlling how steeply they are angled.<br>*C# 属性 `TiltAmount`* |
| Direction | Int32 `int` | `0`，范围 0 … 360 | Specifies the direction in which the tilt is applied, determining the orientation of the slant. |
| Tilt Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for the tilt effect, producing varied tilt patterns when changed.<br>*C# 属性 `TiltSeed`* |
| Warp Amount | Single `float` | `0.33`，范围 0f … 1f | Controls the strength of the warp effect applied to the terraces, introducing distortion and organic variation.<br>*C# 属性 `WarpAmount`* |
| Warp Size | Single `float` | `0.33`，范围 0f … 1f | Sets the scale of the warp effect, determining how broad or fine the distortion is.<br>*C# 属性 `WarpSize`* |
| Warp Style | Enum `ABCD` | `ABCD.A`，范围 0f … 1f | `A` — <desc><br>`B` — <desc><br>`C` — <desc><br>`D` — <desc><br>*C# 属性 `WarpStyle`* |

### Grid

`QuadSpinner.Gaea.Nodes.Grid` · Family `Cartography` · Classification `Generator` · ShortCode `gr`

> Generates a regular grid pattern useful for cartography, masking, or stylized surfaces.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Subdivision | Int32 `int` | `2`，范围 1 … 10 | Sets the number of grid divisions along each axis. Higher values create a denser grid with more cells. |
| Line Intensity | Single `float` | `1f`，范围 0f … 1f | Controls the brightness or opacity of the main grid lines, making them more or less prominent in the texture. |
| Sub Intensity | Single `float` | `0.25f`，范围 0f … 1f | Adjusts the brightness or opacity of the subdivision lines, which are the finer lines between main grid lines. |
| Line Thickness | Int32 `int` | `1`，范围 1 … 20 | Specifies the thickness of the grid lines. Higher values produce bolder, wider lines. |

### GroundTexture

`QuadSpinner.Gaea.Nodes.GroundTexture` · Family `Superficial` · Classification `Processor` · ShortCode `gt` · Keywords `surfacer`

> GroundTexture adds superficial detail to the terrain to increase realism.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Method | Enum `GroundStyle` | `SharpenMethod.Frequency`，范围 0f … 1f | `Harsh` — Creates a ground texture with strong, pronounced features and high contrast, simulating rugged or eroded terrain.<br>`Rocky` — Generates a texture with rocky details, emphasizing stone-like patterns and roughness typical of stony ground.<br>`Rough` — Produces a generally uneven and coarse texture, adding subtle irregularities for a natural, weathered look. |
| Strength | Single `float` | `0.25f`，范围 0f … 1f | Controls the intensity of the ground texture effect. Higher values make the texture more prominent and detailed. |
| Coverage | Single `float` | `0.33f`，范围 0f … 1f | Adjusts how much of the terrain surface is affected by the ground texture, determining the extent of the effect. |
| Density | Single `float` | `0f`，范围 -1f … 1f | Sets the concentration of texture features across the surface. Higher density results in more frequent and closely packed details. |

### Outcrops

`QuadSpinner.Gaea.Nodes.Outcrops` · Family `Rocky` · Classification `Processor` · ShortCode `oc`

> The Outcrops LookDev node creates rocky outcrops on any surface. You can control coverage, breakage, and surface details. Several Outcrops nodes can be layered for complex results.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Outcrops** *(分组标题)* | — | — | `[Group]` 由 `Variations`, `Strata`, `Density`, `Shape` 声明 |
| Variations | Int32 `int` | `3`，范围 2 … 10 | Controls the number of unique outcrop shapes generated before repetition. Higher values create more visual diversity among outcrops. |
| Strata | Single `float` | `0.1f`，范围 0f … 1f | Adds visible geological layering or banding to the outcrops, simulating sedimentary or stratified rock formations. High values increase the distance between Strata layers. |
| Density | Single `float` | `0.2f`，范围 0f … 1f | Adjusts how many outcrops are placed across the terrain. Higher values increase the number of outcrops per area. |
| Shape | Single `float` | `0f`，范围 -1f … 1f | Determines the overall form and silhouette of each outcrop, affecting their appearance and how they blend with the terrain. |
| Chipped | Boolean `bool` | `true`，范围 0f … 1f | Controls the amount of chipping or breakage on the outcrops, simulating natural weathering and erosion effects. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Sets the randomization seed for outcrop generation, ensuring reproducible or varied results with each value. |
| **Variation Range** *(分组标题)* | — | — | `[Group]` 由 `Size`, `Height`, `Rotation` 声明 |
| Size | Float2 `Float2` | `0.4f`，范围 0f … 1f | Specifies the base size of each outcrop, affecting their footprint and prominence on the terrain. |
| Height | Float2 `Float2` | `0.45f`，范围 0f … 1f | Controls the vertical scale of the outcrops, determining how tall or flat they appear. |
| Rotation | Float2 `Float2` | `0f`，范围 0f … 1f | Applies random or specified rotation to each outcrop, increasing natural variation and preventing repetitive patterns. |

### Pockmarks

`QuadSpinner.Gaea.Nodes.Pockmarks` · Family `Scatter` · Classification `Processor` · ShortCode `pck`

> Creates scattered pits, dents, and small impact-like depressions on the surface.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Pockmarks** *(分组标题)* | — | — | `[Group]` 由 `Size`, `Scale`, `Height`, `Density` 声明 |
| Size | Float2 `Float2` | `0.4f`，范围 0f … 1f | Controls the average diameter of each pockmark. Larger values produce bigger pits, while smaller values create finer surface detail. |
| Scale | Single `float` | `0.6f`，范围 0f … 1f | Sets the overall scale of the pockmark pattern, affecting how widely pockmarks are distributed across the terrain. |
| Depth | Single `float` | `1f`，范围 0.0001f … 3f | Specifies how deep each pockmark is carved into the surface. Higher values create more pronounced depressions.<br>*C# 属性 `Height`* |
| Density | Single `float` | `0.5f`，范围 0.0001f … 1f | Adjusts how many pockmarks are scattered across the terrain. Higher values increase the number of pits per area. |
| Multiplier | Single `float` | `0.5f`，范围 0.0001f … 10f | Scales the intensity or strength of the pockmark effect, amplifying the impact of each depression. |
| Invert | Boolean `bool` | `false`，范围 0f … 1f | Inverts the effect, turning pockmarks into raised bumps instead of depressions. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for pockmark placement and variation. Changing the seed produces different pockmark patterns. |

### RockNoise

`QuadSpinner.Gaea.Nodes.RockNoise` · Family `Rocky` · Classification `Generator` · ShortCode `rn`

> RockNoise is a useful tool for generating fields of rocks with size variations and controllable density.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Float2 `Float2` | `0.2f`，范围 0f … 1f | The relative size of the rocks generated by the noise. |
| Variety | Int32 `int` | `1`，范围 1 … 10 |  |
| Octaves | Int32 `int` | `50`，范围 2 … 500 | Each octave adds smaller/subdivided rocks in between the larger ones from the previous octave. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |
| Style | Enum `ABC` | (HorizontalList，默认值在混淆常量表中) | `A` — <desc><br>`B` — <desc><br>`C` — <desc> |

### Rockscape

`QuadSpinner.Gaea.Nodes.Rockscape` · Family `Rocky` · Classification `Generator` · ShortCode `rs`

> Creates broad rocky surface formations and broken stone-like terrain detail.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `0.5f`，范围 0f … 1f | Controls the overall scale of the rock formations. Higher values produce larger, more expansive rock features. |
| Erosion | Single `float` | `0.5f`，范围 0f … 1f | Adjusts the amount of erosion applied to the rockscape, simulating natural weathering and smoothing of rock surfaces. |
| Breakage | Single `float` | `0.25f`，范围 0.01f … 1f | Determines the degree of fracturing and splitting in the rocks, creating more jagged and broken surfaces as the value increases. |
| Roughness | Single `float` | `0.7f`，范围 0f … 1f | Sets the surface roughness of the rocks, adding fine detail and texture to the formations. |
| Jitter | Single `float` | `0.5f`，范围 0f … 1f | Introduces randomness to the placement and shape of rock features, making the rockscape appear more natural and less uniform. |
| Clusters | Enum `RockClusters` | (HorizontalList，默认值在混淆常量表中) | `Off` — Disables clustering, resulting in evenly distributed rock features.<br>`Large` — Creates large clusters of rocks, forming prominent groupings and massifs.<br>`Small` — Generates small, tight clusters of rocks, producing scattered groupings across the surface.<br>`Shattered` — Simulates shattered rock formations, with highly fragmented and irregular clusters. |
| Relief | Enum `RockRelief` | (HorizontalList，默认值在混淆常量表中) | `Off` — No additional relief is applied; the surface remains as generated by the base parameters.<br>`Sharp` — Applies sharp, pronounced relief, emphasizing angular features and steep transitions.<br>`Soft` — Applies soft, gentle relief, smoothing out transitions and creating a more weathered appearance.<br>`Stratified` — Adds visible stratification or layering to the rockscape, simulating sedimentary or banded rock formations. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for generating unique variations of the rockscape. Changing the seed produces different rock patterns. |

### Roughen

`QuadSpinner.Gaea.Nodes.Roughen` · Family `Superficial` · Classification `Processor` · ShortCode `rog`

> Adds fine roughness and small-scale breakup to the terrain surface.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Width | Single `float` | `0.1f`，范围 0f … 1f |  |
| Depth | Single `float` | `0.2f`，范围 0f … 1f |  |
| Oriented | Boolean `bool` | `false`，范围 0f … 1f |  |
| Quality | Enum `RelativeQuality` | `RelativeQuality.Quarter`，范围 0f … 1f | `Quarter` — <desc><br>`Third` — <desc><br>`Half` — <desc><br>`Full` — <desc> |

### Sand

`QuadSpinner.Gaea.Nodes.Sand` · Family `Superficial` · Classification `Generator` · ShortCode `sd`

> Sand creates medium and small level sand patterns. It can also be used to simulate dunes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Scale | Single `float` | `0.5f`，范围 0f … 1f | The scale of the sand pattern. |
| Direction | Int32 `int` | `0`，范围 0 … 360 |  |
| Chaos | Single `float` | `0.5f`，范围 0.1f … 1f |  |
| Softness | Single `float` | `0.5f`，范围 0.1f … 1f | Softness of the sand pattern. |
| Height | Single `float` | `0.25f`，范围 0.1f … 1f | The height of the sand pattern. |
| Warp by Terrain | Boolean `bool` | `false`，范围 0f … 1f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### Sandstone

`QuadSpinner.Gaea.Nodes.Sandstone` · Family `Terrace` · Classification `Processor` · ShortCode `ss`

> Creates layered sandstone-like terracing and sedimentary rock structure.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Passes | Int32 `int` | `1`，范围 1 … 10 | Sets the number of erosion passes applied to simulate layered sandstone formation. More passes increase the detail and realism of the stratified effect. |
| Iterations | Int32 `int` | `10`，范围 5 … 30 | Controls how many times the erosion process is repeated within each pass, refining the sandstone layering and surface features. |
| Spacing | Single `float` | `0.1`，范围 0f … 1f | Determines the distance between individual sandstone layers, affecting the frequency and thickness of visible strata. |
| Intensity | Single `float` | `0.5`，范围 0f … 1f | Adjusts the overall strength of the sandstone effect, influencing how pronounced the layers and erosion features appear. |
| Convexity | Single `float` | `0f`，范围 -1f … 1f | Controls the curvature of the sandstone layers, making them appear more rounded (convex) or flat. |
| Tilt | Single `float` | `0.5`，范围 0f … 1f | Applies an angular tilt to the sandstone layers, simulating geological tilting or shifting of strata. |
| Direction | Int32 `int` | `0`，范围 0 … 360 | Sets the orientation of the sandstone layers, determining the primary direction in which the strata are aligned. |
| Chaos | Single `float` | `0.15f`，范围 0.01f … 0.4f | Introduces randomness and irregularity to the sandstone layers, creating a more natural and less uniform appearance. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Defines the randomization seed for procedural generation, ensuring unique but repeatable sandstone patterns. |
| Chipped | Boolean `bool` | `true`，范围 0f … 1f | Enables or controls the presence of chipped or broken edges in the sandstone, simulating natural weathering and breakage. |
| Chipping | Single `float` | `0.45f`，范围 0.1f … 0.5f | Adjusts the amount and detail of chipping applied to the sandstone layers, affecting the roughness and realism of eroded edges. |

### Shatter

`QuadSpinner.Gaea.Nodes.Shatter` · Family `Structure` · Classification `Processor` · ShortCode `tt`

> Shatter transforms simple shapes into complex, highly eroded, and fractured terrains.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Shatters | Int32 `int` | `6`，范围 4 … 50 |  |
| Size | Single `float` | `0.8f`，范围 0f … 2f |  |
| Coverage | Single `float` | `0.5f`，范围 0f … 1f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### Shear

`QuadSpinner.Gaea.Nodes.Shear` · Family `Structure` · Classification `Processor` · ShortCode `sh`

> Shear creates rock shearing and exposes strata.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Strength | Single `float` | `0.5f`，范围 0f … 1f | The amount of terrain warp/shear that will be applied. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### Steps

`QuadSpinner.Gaea.Nodes.Steps` · Family `Terrace` · Classification `Processor` · ShortCode `ste`

> Creates stepped formations and hard terrace-like breaks in the terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Steps** *(分组标题)* | — | — | `[Group]` 由 `Scale`, `Density`, `Seed` 声明 |
| Scale | Single `float` | `0.6f`，范围 0f … 1f | Controls the overall size and spacing of the steps. Higher values produce larger, more widely spaced terraces, while lower values create finer, closely packed steps. |
| Density | Single `float` | `0.5f`，范围 0.0001f … 2f | Determines the number of steps or terraces within the terrain. Increasing density results in more steps, creating a more detailed and intricate terraced effect. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Sets the random seed for the step pattern. Changing the seed generates a different arrangement of steps while keeping other settings the same. |

### Stones

`QuadSpinner.Gaea.Nodes.Stones` · Family `Scatter` · Classification `Processor` · ShortCode `on`

> Scatters stones or small rock forms across the surface.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Stones** *(分组标题)* | — | — | `[Group]` 由 `Scale`, `Height`, `Density`, `Seed` 声明 |
| Scale | Single `float` | `0.6f`，范围 0f … 1f | Controls the overall size of the stones. Higher values produce larger stones, while lower values create finer gravel. |
| Height | Single `float` | `1f`，范围 0.0001f … 3f | Sets the maximum elevation or prominence of the stones above the terrain surface. |
| Density | Single `float` | `0.5f`，范围 0.0001f … 1f | Adjusts how many stones are scattered across the surface. Higher values increase the number of stones per area. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for stone placement and variation. Changing the seed produces different stone patterns. |

### Stratify

`QuadSpinner.Gaea.Nodes.Stratify` · Family `Terrace` · Classification `Processor` · ShortCode `ct` · Keywords `complex terraces stratify strata`

> Stratify creates broken strata or rock layers on the terrain in a non-linear fashion, producing a robust, realistic formation.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Spacing | Single `float` | `0.1`，范围 0f … 1f | Controls the distance between individual stratified layers, affecting the frequency and thickness of visible strata in the terrain. |
| Octaves | Int32 `int` | `12`，范围 1 … 12 | Sets the number of noise octaves used to add variation to the stratified layers. Higher values introduce more complexity and detail. |
| Intensity | Single `float` | `0.5`，范围 0f … 1f | Adjusts the overall strength of the stratification effect, making the layers more or less pronounced. |
| Shape | Single `float` | `0f`，范围 -1f … 1f | Modifies the profile or contour of the stratified layers, influencing how sharply or smoothly the layers transition. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Defines the randomization seed for procedural generation, ensuring unique but repeatable stratification patterns. |
| Tilt Amount | Single `float` | `0.5`，范围 0f … 1f | Applies an angular tilt to the stratified layers, simulating geological tilting or shifting of strata. |
| Direction | Int32 `int` | `0`，范围 0 … 360 | Sets the orientation of the stratified layers, determining the primary direction in which the strata are aligned. |

### Terraces

`QuadSpinner.Gaea.Nodes.Terraces` · Family `Terrace` · Classification `Processor` · ShortCode `st` · Keywords `terrace`

> Creates stepped terrace formations from the terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Terraces | Int32 `int` | `10`，范围 3 … 256 | Controls the number and spacing of terrace steps applied to the terrain. Increasing this value creates more distinct, layered steps.<br>*C# 属性 `NumTerraces`* |
| Uniformity | Single `float` | `0.6`，范围 0f … 1f | Adjusts the consistency of terrace step heights. Higher uniformity produces evenly spaced terraces, while lower values introduce variation. |
| Steepness | Single `float` | `0.2`，范围 0f … 1f | Sets the vertical sharpness of each terrace step. Higher steepness results in more abrupt transitions between steps. |
| Intensity | Single `float` | `1f`，范围 0f … 1f | Determines the overall strength of the terrace effect. Higher intensity makes the terraces more pronounced in the terrain. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Defines the randomization seed for procedural terrace generation. Changing the seed produces different terrace patterns. |

## Simulate

*物理模拟与水文：侵蚀、水力、冰川、湖泊、河流* — `NodeCategory.Simulate`，共 25 个节点。

### Anastomosis

`QuadSpinner.Gaea.Nodes.Anastomosis` · Family `Erosion` · Classification `Processor` · ShortCode `an`

> Anastomosis creates interconnected water flow based extractions, ranging from small pits to large river channels. It is useful for both terrains and textures.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Impact | Single `float` | `0.1f`，范围 0f … 1f | The intensity of the process. Higher values create stronger physical impacts within the erosion process. |
| Width | Single `float` | `0.1f`，范围 0f … 1f | Controls the horizontal spread of the anastomosis effect. Larger values produce wider channels and features. |
| Depth | Single `float` | `0.2f`，范围 0f … 1f | Determines the vertical extent of the erosion. Higher values result in deeper cuts and more pronounced terrain features. |
| Downcutting | Enum `AnastomosisDowncutting` | `AnastomosisDowncutting.Flows`，范围 0f … 1f | `Destructive` — Applies aggressive downcutting, rapidly eroding and deepening channels.<br>`Pits` — Focuses erosion into localized depressions, creating pit-like features.<br>`Flows` — Simulates water flow erosion, carving smooth, continuous channels.<br>`Rivers` — Emphasizes river-like downcutting, forming distinct riverbeds.<br>`Riversx2` — Doubles the intensity of river downcutting for deeper, more defined riverbeds.<br>`Riversx4` — Quadruples the river downcutting effect, producing extremely deep and prominent river channels.<br>`Flooding` — Simulates broad, shallow erosion typical of flooding events.<br>`Floodingx2` — Doubles the flooding effect, increasing the area and depth of flood erosion.<br>`Flooding_x4` — Quadruples the flooding effect, creating extensive and deep flood-eroded regions. |
| Quality | Enum `RelativeQuality` | `RelativeQuality.Quarter`，范围 0f … 1f | `Quarter` — Processes at 1/4 resolution for fastest performance and lowest detail.<br>`Third` — Processes at 1/3 resolution, balancing speed and detail.<br>`Half` — Processes at 1/2 resolution for moderate detail and performance.<br>`Full` — Processes at full resolution for maximum detail and slower performance. |
| Smooth Edges | Boolean `bool` | `true`，范围 0f … 1f | Softens the edges of eroded features, reducing sharp transitions and creating a more natural appearance. |

### Crumble

`QuadSpinner.Gaea.Nodes.Crumble` · Family `Erosion` · Classification `Processor` · ShortCode `cr`

> Crumble runs a different kind of simulation that feeds off of existing crevices, erosive information, and other subtle details to collapse the terrain. Just as the name implies, the terrain starts crumbling from the edges.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Duration | Single `float` | `0.25f`，范围 0f … 1f | Controls how long the simulation runs. Longer durations produce stronger and more extensive crumbling effects. |
| Strength | Single `float` | `0.5f`，范围 0f … 1f | Defines how intensely the rock or terrain breaks apart from the main body. Higher values result in more aggressive fragmentation. |
| Coverage | Single `float` | `0.75f`，范围 0f … 1f | Sets how far the crumbling effect spreads inward from exposed edges, determining the affected area. |
| Horizontal | Single `float` | `0.45f`，范围 0f … 1f | Biases the crumble effect towards flow origins or towards deposits, influencing the lateral direction of collapse. |
| Vertical | Single `float` | `0f`，范围 -1f … 1f | Biases the crumble effect towards higher or lower altitudes, controlling whether upper or lower terrain is more affected. |
| Rock Hardness | Single `float` | `0.45f`，范围 0f … 1f | Controls material resistance, reducing how much terrain collapses. Higher values simulate harder, more resilient rock. |
| Edge | Single `float` | `0.45f`，范围 0f … 1f | Expands or reduces the impact of crumbling specifically on sharp terrain edges, allowing for more pronounced or subdued edge effects. |
| Downcutting | Single `float` | `0f`，范围 0f … 1f | Controls how deeply the simulation carves downward into the terrain during crumbling, affecting the vertical extent of collapse. |
| Depth | Single `float` | `0.2f`，范围 0f … 1f | Adjusts the overall depth of the collapsed areas, determining how far the terrain sinks or breaks away. |
| Direction | Enum `GradientDirection` | `GradientDirection.X`，范围 0f … 1f | `X` — Directs the crumbling effect along the X (horizontal) axis.<br>`N` — Directs the crumbling effect towards the north (upward in world space).<br>`E` — Directs the crumbling effect towards the east (right in world space).<br>`S` — Directs the crumbling effect towards the south (downward in world space).<br>`W` — Directs the crumbling effect towards the west (left in world space). |

### Debris

`QuadSpinner.Gaea.Nodes.Debris` · Family `Scatter` · Classification `Processor` · ShortCode `db` · Keywords `debris`

> Simulates loose debris across the terrain surface to create broken rocky accumulation.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 5 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Debris Amount | Int32 `int` | `1000`，范围 1 … 1000000 | Controls how many individual rocks or debris pieces are emitted across the terrain. |
| Amount Multiplier | Single `float` | `1f`，范围 0f … 10f | Scales the emitted debris amount globally without changing other parameters, allowing quick adjustment of overall density. |
| Scale | Single `float` | `1f`，范围 0.1f … 100f | Controls the overall scale of debris elements, affecting their size relative to the terrain. |
| Friction | Single `float` | `0.62f`，范围 0f … 1f | Determines how easily debris slides; higher values make debris stop sooner and form steeper piles. |
| Restitution | Single `float` | `0.4f`，范围 0f … 1f | Controls energy loss on impact, affecting how far debris bounces or continues sliding after being emitted. |
| Size | Float2 `Float2` | `1f`，范围 0.1f … 20f | Sets the overall size of the emitted rocks or debris pieces. |
| Height | Single `float` | `1f`，范围 0.0001f … 10f | Defines the vertical offset or emission height for debris release. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for generating varied debris distributions. |
| Shape | Enum `DebrisShape` | (HorizontalList，默认值在混淆常量表中) | `Rounded` — Produces smoother, rounded rock fragments.<br>`Sharp` — Produces jagged, angular rock fragments. |
| Render Still Rocks | Boolean `bool` | `false`，范围 0f … 1f | Enables rendering of non-moving debris that has settled on the terrain. |
| Distribution | Enum `QuadSpinner.Gaea.Engine.SyclFunctions.Debris.SizeDistribution` | (HorizontalList，默认值在混淆常量表中) | `Uniform` — Evenly spreads debris across the emission area.<br>`Natural` — Creates more organic, irregular clustering of debris. |
| Export Point Cloud | Boolean `bool` | `false`，范围 0f … 1f | Enables the export of debris positions as a point cloud for further processing or use in external applications. |
| Information | Byte `byte` | — |  |

### Dusting

`QuadSpinner.Gaea.Nodes.Dusting` · Family `Snow` · Classification `Processor` · ShortCode `ds` · Keywords `snow`

> Applies a thin dusting of snow or sediment over the terrain surface.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Snowfall** *(分组标题)* | — | — | `[Group]` 由 `Strength`, `Snowline`, `Falloff` 声明 |
| Strength | Single `float` | `1f`，范围 0f … 1f | Controls the intensity of the snow dusting effect, determining how visible and thick the light snow layer appears. |
| Snowline | Single `float` | `0.5f`，范围 0f … 1f | Sets the elevation at which snow begins to appear, defining the lower boundary for snow coverage. |
| Falloff | Single `float` | `0.5f`，范围 0f … 1f | Controls the softness of the transition near the snowline, blending the snow edge smoothly into the terrain. |
| **Distribution** *(分组标题)* | — | — | `[Group]` 由 `Directional`, `Direction`, `Peaks`, `Coverage` 声明 |
| Directional | Boolean `bool` | `true`，范围 0f … 1f | Enables or adjusts wind-driven accumulation, causing snow to gather more on one side of terrain features. |
| Direction | Single `float` | `0f`，范围 0f … 1f | Sets the primary direction for wind-driven snow accumulation, simulating the effect of prevailing winds. |
| Peaks | Single `float` | `0f`，范围 0f … 1f | Controls additional snow accumulation on terrain peaks, enhancing coverage on high points. |
| Coverage | Single `float` | `0.15f`，范围 0f … 1f | Adjusts the overall amount of snow applied to the terrain, increasing or decreasing the extent of dusting. |
| Slope Coverage | Float2 `Float2` | `0f`，范围 0f … 1f | Modifies how much snow accumulates on slopes, allowing for more or less coverage on inclined surfaces. |
| Flow | Single `float` | `0.15f`，范围 0f … 1f | Simulates subtle downhill drift and redistribution of snow, mimicking natural snow movement due to gravity. |
| **Effects** *(分组标题)* | — | — | `[Group]` 由 `Melt`, `Gritty`, `IncludeExistingSnow`, `Seed` 声明 |
| Melt | Single `float` | `0.4f`，范围 0f … 1f | Reduces snow coverage in sun-exposed or warmer areas, simulating natural melting patterns. |
| Gritty | Boolean `bool` | `true`，范围 0f … 1f | Adds noise and texture variation to the snow, creating a more natural, patchy, and irregular appearance. |
| Include Existing Snow | Boolean `bool` | `false`，范围 0f … 1f | Allows the dusting effect to respect and blend with existing snow layers, ensuring seamless integration. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomizes the snow pattern, enabling varied results or reproducibility by changing the seed value. |
| Artistic Control | Single `float` | `0f`，范围 0f … 1f | Provides fine-tuning options for the overall look and style of the snow dusting, supporting creative or stylized results. |

### EasyErosion

`QuadSpinner.Gaea.Nodes.EasyErosion` · Family `Erosion` · Classification `Processor` · ShortCode `ee` · Keywords `wizard erosion`

> Provides a simplified erosion workflow for quickly adding natural erosion effects.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Erosion** *(分组标题)* | — | — | `[Group]` 由 `Style` 声明 |
| Style | Enum `QuickErosion` | (OptionGrid，默认值在混淆常量表中) | `Simple` — <desc><br>`Ancient` — <desc><br>`Ancient2` — <desc><br>`Alpine` — <desc><br>`Rocky` — <desc><br>`Exposed` — <desc><br>`Flows` — <desc><br>`Flows2` — <desc><br>`Flows3` — <desc><br>`Strata` — <desc><br>`Withered` — <desc><br>`SoftSoil` — <desc><br>`SoftSoil2` — <desc><br>`Dessicated` — <desc><br>`Thin` — <desc> |
| **Style Editor** *(分组标题)* | — | — | `[Group]` 由 `Influence`, `Direction`, `BiasAngle`, `Seed` 声明 |
| Influence | Single `float` | `0.5f`，范围 0f … 1f |  |
| Direction | Int32 `int` | `0`，范围 0 … 360 |  |
| Bias Angle | Enum `GradientDirection` | `GradientDirection.X`，范围 0f … 1f | `X` — <desc><br>`N` — <desc><br>`E` — <desc><br>`S` — <desc><br>`W` — <desc> |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |

### Erosion

`QuadSpinner.Gaea.Nodes.Erosion` · Family `Erosion` · Classification `Processor` · ShortCode `ce` · Keywords `erosion`

> Erosion is the cornerstone of all terrains. It simulates hydraulic erosion and turns any shape into a realistic-looking terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 5 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Erosion** *(分组标题)* | — | — | `[Group]` 由 `Duration`, `RockSoftness`, `Strength` 声明 |
| Duration | Single `float` | `0.04f`，范围 0.0001f … 1f | Determines the duration of the erosion simulation. Higher values increase the overall erosion effect, while lower values add subtle erosion details and preserve more of the original landscape. |
| Rock Softness | Single `float` | `0.65f`，范围 0.05f … 1f | Controls the softness of the rock material. Softer rocks erode more quickly, resulting in faster and more pronounced erosion. |
| Strength | Single `float` | `0.5f`，范围 0.0001f … 1f | Sets the strength of fluvial erosion, controlling the sediment transport capacity. Higher values allow water to carry more dissolved minerals, increasing the rate and impact of erosion. |
| **Downcutting** *(分组标题)* | — | — | `[Group]` 由 `Downcutting`, `Inhibition`, `BaseLevel` 声明 |
| Downcutting | Single `float` | `0.1`，范围 0f … 1f | Group containing parameters related to the vertical erosion process, where water cuts down into the terrain to form channels and valleys. |
| Inhibition | Single `float` | `0.5f`，范围 0f … 5f | Adds restraints to the downcutting process by slowing it down when undissolved sediments accumulate. This results in a mix of deep channels and alluvial fans, depending on local conditions. |
| Base Level | Single `float` | `0f`，范围 0f … 5f | Sets the lowest elevation that downcutting can reach before sediment is deposited. This helps fill large valleys and form valley floors, influenced by terrain slope, altitude, and stream velocity. |
| **Scale** *(分组标题)* | — | — | `[Group]` 由 `FeatureScale`, `RealScale`, `TerrainScale`, `Verticality` 声明 |
| Feature Scale | Int32 `int` | `2000`，范围 5 … 20000 | Determines the lateral size of the largest erosion features, such as the width of major valleys and ridges, measured in meters. |
| Real Scale | Boolean `bool` | `true`，范围 0f … 1f | Automatically determines the scale from the Terrain Definition, ensuring erosion features are sized appropriately for the terrain. |
| Terrain Scale | Int32 `int` | `10000`，范围 500 … 20000 | Sets the simulated scale of the entire terrain width. Available when Rivers is enabled, this parameter helps match erosion to real-world dimensions. |
| Verticality | Int32 `int` | `2000`，范围 5 … 20000 | Sets the simulated height of the entire terrain. Available when Rivers is enabled, this parameter controls the vertical exaggeration of erosion features. |
| **Flow** *(分组标题)* | — | — | `[Group]` 由 `Debris`, `Volume`, `SedimentRemoval` 声明 |
| Debris | Single `float` | `0f`，范围 0f … 5f | Controls the amount and behavior of debris generated and transported during the erosion process. |
| Volume | Single `float` | `0f`，范围 0f … 5f | Alters erosion physics to treat water flows as volumetric, resulting in higher water levels, wider channels, and more extensive sediment deposits. Useful for forming valley floors without downcutting. |
| Sediment Removal | Single `float` | `0f`，范围 0f … 1f | Removes sediment produced during erosion. This can be modulated using the Sediment Removal mask input to control where sediment is retained or cleared. |
| **Selective Processing** *(分组标题)* | — | — | `[Group]` 由 `AreaEffect`, `BiasType`, `Bias`, `Reverse` 声明 |
| Area Effect | Enum `AreaEffect` | `AreaEffect.None`，范围 0f … 1f | `ErosionStrength` — Applies selective processing to the erosion strength, allowing targeted control over erosion intensity.<br>`RockSoftness` — Applies selective processing to rock softness, enabling localized variation in erosion rates.<br>`PrecipitationAmount` — Applies selective processing to precipitation amount, affecting how much water is available for erosion in specific areas.<br>`None` — No selective processing is applied; erosion is uniform across the terrain. |
| Bias Type | Enum `BiasType` | `BiasType.Altitude`，范围 0f … 1f | `Altitude` — Applies bias based on elevation, allowing erosion to be stronger or weaker at different heights.<br>`Slope` — Applies bias based on terrain slope, enabling more erosion on steeper or flatter areas. |
| Bias | Single `float` | `0.7`，范围 0f … 1f | Sets the strength of the bias. For Slope, this controls the steepness threshold; for Altitude, it sets the position from the bottom of the terrain. |
| Reverse | Boolean `bool` | `false`，范围 0f … 1f | Reverses the direction of the bias, inverting which areas receive more or less erosion. |
| **Other Settings** *(分组标题)* | — | — | `[Group]` 由 `Seed`, `AggressiveMode`, `Deterministic` 声明 |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for the erosion process. Changing the seed produces different erosion patterns and channel arrangements. |
| Aggressive Mode | Boolean `bool` | `true`，范围 0f … 1f | Enables faster erosion processing at the risk of introducing soft artifacts in minor areas. Useful for quick previews or when speed is prioritized over detail. |
| Deterministic | Boolean `bool` | — | Ensures the erosion simulation produces the same result every time with the same input and seed, improving reproducibility. |
| **Information** *(分组标题)* | — | — | `[Group]` 由 `Information` 声明 |
| Information | Byte `byte` | — |  |

### Erosion2

`QuadSpinner.Gaea.Nodes.Erosion2` · Family `Erosion` · Classification `Processor` · ShortCode `e2`

> An advanced hydraulic erosion node that creates more detailed and realistic erosion results.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 5 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **General** *(分组标题)* | — | — | `[Group]` 由 `Duration`, `Downcutting`, `ErosionScale`, `Seed` 声明 |
| Duration | Single `float` | `10f`，范围 1f … 200f | Controls how long erosion runs. Longer durations produce more elaborate terrain reshaping, while shorter durations help preserve original forms. |
| Downcutting | Single `float` | `0.25f`，范围 0f … 1f | Governs how deeply water cuts into the terrain, carving valleys and channels. |
| Erosion Scale | Single `float` | `1000f`，范围 1f … 20000f | Sets the overall size of erosion features, from fine gullies to massive ravines. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomizes the erosion pattern while keeping other settings the same. |
| NoErosion | Boolean `bool` | `false`，范围 0f … 1f |  |
| **Sediment Discharge** *(分组标题)* | — | — | `[Group]` 由 `SuspendedLoadDischargeAmount`, `SuspendedLoadDischargeAngle`, `BedLoadDischargeAmount`, `BedLoadDischargeAngle` 声明 |
| Suspended Load | Single `float` | `1f`，范围 0f … 1f | Fine, light sediments that travel far and fill gullies with subtle detail.<br>*C# 属性 `SuspendedLoadDischargeAmount`* |
| Discharge Angle | Single `float` | `24f`，范围 0f … 45f | Sets the slope at which suspended load settles.<br>*C# 属性 `SuspendedLoadDischargeAngle`* |
| Bed Load | Single `float` | `0f`，范围 0f … 1f | Heavier sediments like gravel that fill and shape gullies and slopes.<br>*C# 属性 `BedLoadDischargeAmount`* |
| Discharge Angle | Single `float` | `15f`，范围 0f … 45f | Sets the slope at which suspended load settles.<br>*C# 属性 `BedLoadDischargeAngle`* |
| Coarse Sediments | Single `float` | `0f`，范围 0f … 1f | The heaviest materials (boulders, scree) that deposit on steep slopes.<br>*C# 属性 `CoarseSedimentsDischargeAmount`* |
| Discharge Angle | Single `float` | `10f`，范围 0f … 45f | Sets the slope at which suspended load settles.<br>*C# 属性 `CoarseSedimentsDischargeAngle`* |
| DepositionBoost | Single `float` | `0f`，范围 0f … 1f | *C# 属性 `DepositionBoost`* |
| ExtraDepositionBoost | Single | — |  |
| **Shape** *(分组标题)* | — | — | `[Group]` 由 `Shape`, `ShapeSharpness`, `ShapeDetailScale` 声明 |
| Shape | Single `float` | `0.2f`，范围 0f … 1f | Enables artistic control over how erosion reshapes terrain. |
| Shape Sharpness | Single `float` | `0.6f`，范围 0f … 1f | Defines how sharp or concave ridges become after erosion. |
| Shape Detail Scale | Single `float` | `0.25f`，范围 0f … 1f | Sets the scale of simulated details, from broad ravines to fine gullies. |
| **Orographic Influence** *(分组标题)* | — | — | `[Group]` 由 `Enable`, `DirectionalPrecipitation`, `Direction`, `RainShadow` 声明 |
| Enable | Boolean `bool` | `false`，范围 0f … 1f | Toggles orographic influence on or off. |
| Directional Precipitation | Boolean `bool` | `false`，范围 0f … 1f | Simulates rain falling more intensely from one direction to create rain shadows. |
| Direction | Int32 `int` | `0`，范围 0 … 360 | Sets the direction from which rainfall comes most strongly. |
| Rain Shadow | Single `float` | `0.8f`，范围 0f … 1f | Controls how strongly terrain blocks rainfall from certain directions. |
| Slope | Float2 `Float2` | `0f`，范围 0f … 90f | Limits rainfall effects to specific elevation ranges. |
| Altitude | Float2 `Float2` | `0f`，范围 0f … 1f | Limits rainfall effects to specific slope ranges. |
| Reverse | Boolean `bool` | `false`，范围 0f … 1f | Inverts the influence mask for creative control. |

### Glacier

`QuadSpinner.Gaea.Nodes.Glacier` · Family `Snow` · Classification `Processor` · ShortCode `gl` · Keywords `ice`

> Glacier creates flowing glaciers on mountain tops.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Glacier** *(分组标题)* | — | — | `[Group]` 由 `Scale`, `Scale2`, `Thickness`, `Height` 声明 |
| Scale | Single `float` | `0.5f`，范围 0f … 1f |  |
| Scale 2 | Single `float` | `0.5f`，范围 0f … 1f |  |
| Thickness | Single `float` | `0.8f`，范围 0f … 4f |  |
| Height | Single `float` | `0.2f`，范围 0f … 1f |  |
| Direction | Int32 `int` | `0`，范围 0 … 360 |  |
| Breakage | Single `float` | `0.5`，范围 0f … 1f |  |
| Rough Edges | Boolean `bool` | `false`，范围 0f … 1f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |
| **Surface** *(分组标题)* | — | — | `[Group]` 由 `Chipped`, `SecondaryBreakage`, `DiagonalBreakage`, `DiagonalBreakageDirection` 声明 |
| Smooth | Boolean `bool` | `false`，范围 0f … 1f | *C# 属性 `Chipped`* |
| Secondary Breakage | Boolean `bool` | `false`，范围 0f … 1f |  |
| Diagonal Breakage | Boolean `bool` | `false`，范围 0f … 1f |  |
| Diagonal Breakage Direction | Int32 `int` | `0`，范围 0 … 360 |  |
| Breakage Count | Int32 `int` | `2`，范围 2 … 10 |  |
| Flow Breakage | Boolean `bool` | `false`，范围 0f … 1f |  |
| Extreme | Boolean `bool` | `false`，范围 0f … 1f |  |
| Flow Breakage Depth | Single `float` | `0.25f`，范围 0f … 1f |  |
| Substructure | Boolean `bool` | `false`，范围 0f … 1f |  |
| Substructure Density | Single `float` | `0.25f`，范围 0f … 1f |  |
| Substructure Depth | Single `float` | `0.25f`，范围 0f … 1f |  |

### Hillify

`QuadSpinner.Gaea.Nodes.Hillify` · Family `Erosion` · Classification `Processor` · ShortCode `hi`

> Softens and reshapes terrain into smoother, hill-like forms.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Coverage | Single `float` | `0.5f`，范围 0f … 1f |  |
| Creep | Enum `HillCoverage` | `HillCoverage.Moderate`，范围 0f … 1f | `Moderate` — <desc><br>`Aggressive` — <desc> |
| Surface | Enum `HillSurface` | `HillSurface.Eroded`，范围 0f … 1f | `Smooth` — <desc><br>`Eroded` — <desc> |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |

### HydroFix

`QuadSpinner.Gaea.Nodes.HydroFix` · Family `Erosion` · Classification `Processor` · ShortCode `hf` · Keywords `HydroFix`

> HydroFix alters the terrain to create continuous drainage network friendly slopes. It can be used before Erosion or other flow related nodes to get better results.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **HydroFix** *(分组标题)* | — | — | `[Group]` 由 `Downcutting` 声明 |
| Downcutting | Single `float` | `0.1f`，范围 0f … 1f | The amount of downcutting to apply while modifying the terrain for hydrological flow. |

### IceFloe

`QuadSpinner.Gaea.Nodes.IceFloe` · Family `Snow` · Classification `Processor` · ShortCode `if`

> Icefloe creates flat plates of ice inside a water body.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 4 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Size | Single `float` | `0.3f`，范围 0f … 1f | Controls the overall scale of the ice floes. Higher values produce larger ice sheets or floes across the terrain. |
| Density | Single `float` | `0.5f`，范围 0f … 1f | Adjusts how many ice floes are distributed across the surface. Higher values increase the number of floes per area. |
| Layers | Single `float` | `0.5f`，范围 0f … 1f | Sets the number of distinct ice layers, allowing for multi-layered ice formations and increased visual complexity. |
| Thickness | Single `float` | `0.5f`，范围 0f … 1f | Specifies the vertical thickness of the ice floes, determining how prominent or deep the ice appears. |
| Shaper 1 | Single `float` | `0f`，范围 -1f … 1f | Applies the first shaping function or modifier to the ice floes, affecting their outline and internal structure. |
| Shaper 2 | Single `float` | `0f`，范围 -1f … 1f | Applies a secondary shaping function or modifier, allowing for additional variation and detail in the ice floes. |
| Reverse | Boolean `bool` | `false`，范围 0f … 1f | Inverts the effect of the primary shaping function, altering the distribution or orientation of the ice floes. |
| Reverse 2 | Boolean `bool` | `false`，范围 0f … 1f | Inverts the effect of the secondary shaping function, providing further control over the appearance of the ice floes. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. Changing the seed produces different ice floe arrangements. |

### Lake

`QuadSpinner.Gaea.Nodes.Lake` · Family `Water` · Classification `Processor`

> Lake simulates rainfall on the terrain and creates physically accurate lakes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 5 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Lake Formation** *(分组标题)* | — | — | `[Group]` 由 `Type`, `X`, `Y`, `WaterLevel` 声明 |
| Type | Enum `LakeType` | `LakeType.Simple`，范围 0f … 1f | `Simple` — <desc><br>`Advanced` — <desc> |
| **Simple Mode** *(分组标题)* | — | — | ⚠ 程序集中无属性声明此分组 |
| X | Single `float` | `0f`，范围 -1f … 1f | X position of the lake source. |
| Y | Single `float` | `0f`，范围 -1f … 1f | Y position of the lake source. |
| Water Level | Single `float` | `0.01f`，范围 0f … 1f | Level of the water. |
| Render Surface | Boolean `bool` | `true`，范围 0f … 1f | Whether to render the surface of the water or just create masks. |
| Accuracy | Enum | — | `Low`<br>`Med`<br>`High`<br>`Ultra` |
| **Advanced Mode** *(分组标题)* | — | — | ⚠ 程序集中无属性声明此分组 |
| Precipitation | Single `float` | `10f`，范围 0f … 300f | Controls the amount of water available for lake formation, influencing the size and number of lakes generated. |
| Small Lakes | Single `float` | `0f`，范围 0f … 1f | Enables or adjusts the creation of smaller lakes, increasing the frequency of minor water bodies across the terrain. |
| Flood Control | Boolean `bool` | `false`，范围 0f … 1f | Limits excessive flooding by managing water distribution, preventing lakes from overflowing or merging unnaturally. |
| Water Floor | Single `float` | `0f`，范围 0f … 1f | Sets the elevation of the lake bed, determining the minimum depth and base level of the water body. |
| **Shore Formation** *(分组标题)* | — | — | ⚠ 程序集中无属性声明此分组 |
| Shore Size | Single `float` | `0.25f`，范围 0f … 1f | Controls the width and extent of the shoreline around lakes, affecting how far the shore transitions into the surrounding terrain. |
| Altitude Bias | Single `float` | `0.5f`，范围 0f … 1f | Biases lake placement towards certain altitudes, favoring higher or lower terrain for lake formation. |
| Size Bias | Single `float` | `0f`，范围 0f … 1f | Adjusts the likelihood of generating larger or smaller lakes, influencing the overall distribution of lake sizes. |

### Lichtenberg

`QuadSpinner.Gaea.Nodes.Lichtenberg` · Family `Erosion` · Classification `Processor` · ShortCode `lct`

> Creates branching, lightning-like erosion or fracture patterns.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Style | Enum `ABC` | `ABC.A`，范围 0f … 1f | `A` — Style A: Produces a classic branching crack pattern, suitable for general terrain fracturing.<br>`B` — Style B: Generates a denser, more intricate crack network for detailed surface effects.<br>`C` — Style C: Creates a sparse, wide-spread crack pattern, ideal for subtle terrain disruption. |
| Scale | Single `float` | `0.4f`，范围 0f … 1f | Controls the scale of the larger cracks, affecting how prominent and wide the main crack structures appear. |
| Complexity | Int32 `int` | `2`，范围 1 … 6 | Adjusts the level of detail in the crack network. Higher values produce more branches and finer crack structures. |
| Depth | Single `float` | `0.2f`，范围 0f … 1f | Sets the depth of the cracks, determining how deeply the cracks cut into the terrain surface. |
| Expand | Single `float` | `0f`，范围 0f … 1f | Expands the cracks outward, increasing their coverage and making the crack network more pronounced. |
| Bias | Single `float` | `0f`，范围 -1f … 1f | Provides artistic control over the shape and direction of the cracks, allowing for customized crack patterns. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Random seed for generating the crack pattern. Changing the seed produces different crack arrangements while keeping other settings the same. |

### Rivers

`QuadSpinner.Gaea.Nodes.Rivers` · Family `Water` · Classification `Processor` · ShortCode `rv`

> Rivers creates a realistic network of rivers with controllable headwaters.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 5 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Water | Single `float` | `0.5f`，范围 0f … 1f | The amount of water in headwaters. Higher values can create larger rivers. |
| Width | Single `float` | `0.2f`，范围 0f … 1f | The width of the rivers. High values create wide rivers, with somewhat wide tributaries. Low values create thin rivers with thin tributaries. |
| Depth | Single `float` | `0.2f`，范围 0f … 1f | The depth of the rivers. This value is independent of Downcutting. |
| Downcutting | Single `float` | `0.1f`，范围 0f … 1f | Like with the Erosion node, Downcutting decides how deeply the river should cut into rock and soil while moving forward. |
| River Valley Width | Enum `RiverValleyWidths` | `RiverValleyWidths.zero`，范围 0f … 1f | `minus4` — <desc><br>`minus2` — <desc><br>`zero` — <desc><br>`plus2` — <desc><br>`plus4` — <desc> |
| Headwaters | Int32 `int` | `200`，范围 1 … 4000 | The number of headwaters from which rivers can start. Not all will become rivers, but rather tributaries that feed the main river. |
| Render Surface | Boolean `bool` | `true`，范围 0f … 1f | Whether to render the surface of the water or just create masks. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### Scree

`QuadSpinner.Gaea.Nodes.Scree` · Family `Scatter` · Classification `Processor`

> Creates accumulations of loose rock fragments scattered across slopes and terrain edges.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Stones** *(分组标题)* | — | — | `[Group]` 由 `Scale`, `Height`, `Density`, `Spread` 声明 |
| Scale | Single `float` | `0.6f`，范围 0f … 1f | Controls the overall size of the scree stones. Higher values produce larger rock fragments, while lower values create finer gravel. |
| Height | Single `float` | `1f`，范围 0.0001f … 3f | Sets the maximum elevation or prominence of the scree stones above the terrain surface. |
| Density | Int32 `int` | `1`，范围 1 … 5 | Adjusts how many scree stones are distributed across the surface. Higher values increase the number of stones per area. |
| Spread | Single `float` | `0f`，范围 -1f … 1f | Determines how widely the scree stones are scattered from their source, affecting the coverage area and natural dispersion. |
| Edge | Single `float` | `0.4f`，范围 0f … 1f | Controls the accumulation of scree along terrain edges or boundaries, allowing for more pronounced deposits at the base of slopes or cliffs. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for scree placement and variation. Changing the seed produces different scree patterns. |

### Sea

`QuadSpinner.Gaea.Nodes.Sea` · Family `Water` · Classification `Processor` · ShortCode `sea`

> Sea is a multi-function water surface generator and coastal erosion tool. Its primary purpose is to create a water surface, while Coastal Erosion creates beaches and cliffs.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 5 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Sea | Enum `SeaArrangement` | (HorizontalList，默认值在混淆常量表中) | `Global` — Enables the sea to cover the entire terrain globally, overriding local variations.<br>`Surrounding` — Restricts the sea to only surround the terrain, creating a border or coastal effect rather than filling the entire area.<br>*C# 属性 `SeaArrangement`* |
| Level | Single `float` | `0.1f`，范围 0f … 1f | Controls the water level of the sea. Higher values raise the sea, submerging more terrain, while lower values expose more land. |
| Coastal Erosion | Boolean `bool` | `true`，范围 0f … 1f | Applies erosion to the coastal areas where the sea meets the land, simulating natural shoreline wear and shaping. |
| Shore Size | Single `float` | `0.2f`，范围 0f … 1f | Determines the width of the shore created by coastal erosion. Larger values produce broader beaches or transition zones. |
| Shore Height | Single `float` | `0.2f`，范围 0f … 1f | Sets the elevation difference between the sea level and the top of the shore, affecting the steepness of the coastline. |
| Variation | Single `float` | `0f`，范围 0f … 1f | Controls the amount of natural variation and irregularity along the coastline, making the shore appear more organic and less uniform. |
| Uniform Variations | Boolean `bool` | `true`，范围 0f … 1f | When enabled, applies consistent variation along the entire coast, resulting in a more uniform shoreline appearance. |
| Extra Cliff Details | Boolean `bool` | `true`，范围 0f … 1f | Adds additional detail and features to cliffs along the coast, enhancing realism and visual interest in steep shoreline areas. |
| Render Surface | Boolean `bool` | `true`，范围 0f … 1f | Determines whether the sea surface is rendered in the final terrain output. Enable to visualize the water surface. |

### Sediments

`QuadSpinner.Gaea.Nodes.Sediments` · Family `Erosion` · Classification `Processor` · ShortCode `sed`

> Sediments creates a thick layer of generic sedimentation on top of the terrain, which can be used for sand or snow.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Type | Enum `Sedimentation` | `Sedimentation.Bulky`，范围 0f … 1f | `Fine` — <desc><br>`Bulky` — <desc><br>`Classic` — <desc> |
| Passes | Int32 `int` | `1`，范围 1 … 10 |  |
| Scale | Single `float` | `0.5f`，范围 0f … 1f |  |
| Angle | Single `float` | `32f`，范围 0f … 90f |  |
| Style | Enum `AB` | `AB.A`，范围 0f … 1f | `A` — <desc><br>`B` — <desc> |
| Grainy Deposits | Boolean `bool` | `true`，范围 0f … 1f |  |

### Shrubs

`QuadSpinner.Gaea.Nodes.Shrubs` · Family `Vegetation` · Classification `Processor` · ShortCode `shr` · Keywords `arboreal`

> Adds low vegetation or shrub-like surface growth across the terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 4 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Shrubs** *(分组标题)* | — | — | `[Group]` 由 `ShrubCount`, `IsRelative`, `Shape`, `Seed` 声明 |
| Count in Thousands | Int32 `int` | `200`，范围 10 … 1000 | Specifies the number of shrubs to generate, in thousands. Controls the overall density of shrubs across the terrain.<br>*C# 属性 `ShrubCount`* |
| Is Relative | Boolean `bool` | `true`，范围 0f … 1f | If enabled, the shrub count is relative to the terrain size or other factors, rather than being an absolute number. |
| Shape | Enum `TreeShape` | `TreeShape.Point`，范围 0f … 1f | `Point` — Places individual shrubs as single points, resulting in a scattered, sparse distribution.<br>`Big` — Generates larger shrub clusters, simulating denser or more mature shrub growth.<br>`BigOnly` — Restricts placement to only large shrub clusters, omitting individual or small shrubs. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Sets the randomization seed for shrub placement, ensuring reproducible or varied results. |
| **Growth** *(分组标题)* | — | — | `[Group]` 由 `WaterAffinity`, `AvoidTrees`, `Health`, `Spread` 声明 |
| Seek Water | Enum `WaterAffinity` | `WaterAffinity.Seek`，范围 0f … 1f | `Seek` — Shrubs preferentially grow closer to water sources, increasing density near moist areas.<br>`Avoid` — Shrubs avoid water sources, resulting in sparser growth near moist areas.<br>*C# 属性 `WaterAffinity`* |
| Avoid Trees | Enum `AvoidTrees` | `AvoidTrees.None`，范围 0f … 1f | `None` — Shrubs are placed without regard to tree locations.<br>`Previous` — Shrubs avoid areas where trees were previously placed, reducing overlap.<br>`All` — Shrubs avoid all tree-covered areas, ensuring no overlap between shrubs and trees. |
| Health | Single `float` | `0.8f`，范围 0f … 1f | Represents the overall health or vigor of shrubs, affecting their size, density, and appearance. |
| Spread | Single `float` | `0.8f`，范围 0.0001f … 1f | Controls how far shrubs can spread from their initial placement, influencing patch size and coverage. |
| Random | Single `float` | `0f`，范围 0f … 1f | Introduces randomness to shrub placement and growth, creating more natural and varied patterns. |
| Simulation Bias | Single `float` | `0f`，范围 -1f … 1f | Adjusts the simulation to favor certain environmental conditions or behaviors, influencing shrub distribution. |
| **Aspect Inhibition** *(分组标题)* | — | — | `[Group]` 由 `Slope`, `SlopeFalloff`, `Altitude`, `AltitudeFalloff` 声明 |
| Slope | Float2 `Float2` | `0f`，范围 0f … 90f | Limits shrub growth on steep slopes, simulating natural growth patterns where shrubs prefer gentler terrain. |
| Slope Falloff | Single `float` | `10f`，范围 0f … 90f | Controls how quickly shrub density decreases as slope increases. |
| Altitude | Float2 `Float2` | `0f`，范围 0f … 1f | Restricts shrub growth above or below certain altitudes, simulating elevation-based vegetation zones. |
| Altitude Falloff | Single `float` | `1f`，范围 0f … 1f | Controls the rate at which shrub density decreases with altitude. |
| **Snow Inhibition** *(分组标题)* | — | — | `[Group]` 由 `DeadFlow`, `ConsolidateFlows`, `Bias` 声明 |
| Dead Flow | Single `float` | `0f`，范围 0f … 1f | Prevents shrub growth in areas with stagnant or 'dead' water flow, simulating natural avoidance of such regions. |
| Consolidate Flows | Single `float` | `0.5f`，范围 0f … 1f | Encourages shrubs to grow along consolidated water flow paths, such as stream banks or drainage lines. |
| Bias | Single `float` | `0.5f`，范围 0f … 1f | Applies a directional or environmental bias to shrub placement, favoring certain areas or conditions. |
| **Artistic Control** *(分组标题)* | — | — | `[Group]` 由 `Chaos`, `BlurEdges` 声明 |
| Chaos | Single `float` | `0.5f`，范围 0f … 1f | Increases the irregularity and unpredictability of shrub placement, creating a more natural look. |
| Blur Edges | Single `float` | `0f`，范围 0f … 1f | Softens the boundaries of shrub patches, blending them more smoothly into the surrounding terrain. |
| **Custom Inhibitors** *(分组标题)* | — | — | `[Group]` 由 `CustomInfluence`, `Trim` 声明 |
| Custom Influence | Single `float` | `0f`，范围 0f … 1f | Allows custom input maps or masks to influence shrub placement and density. |
| Trim | Single `float` | `0.1f`，范围 0f … 1f | Removes or reduces shrubs in specified areas, providing manual control over final distribution. |

### Snow

`QuadSpinner.Gaea.Nodes.Snow` · Family `Snow` · Classification `Processor` · ShortCode `sn` · Keywords `snow`

> Snow simulates snow fall, melt, and settling like in nature, and controls how the snow adheres and flows along the terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 5 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Snow** *(分组标题)* | — | — | `[Group]` 由 `Duration`, `Intensity`, `SettleThaw` 声明 |
| Duration | Single `float` | `0.25f`，范围 0f … 1f | Controls the length of time snow accumulates on the terrain, affecting overall snow coverage and depth. |
| Intensity | Single `float` | `0.25f`，范围 0f … 1f | Determines the rate at which snow falls and accumulates, influencing the thickness and density of the snow layer. |
| Settle Duration | Single `float` | `0.25`，范围 0f … 1f | Specifies the time it takes for freshly fallen snow to settle and compact, impacting the smoothness and stability of the snow surface.<br>*C# 属性 `SettleThaw`* |
| **Melt** *(分组标题)* | — | — | `[Group]` 由 `MeltType`, `Melt`, `MeltRemnants`, `Direction` 声明 |
| Melt Type | Enum `MeltType` | `MeltType.Uniform`，范围 0f … 1f | `Uniform` — Snow melts evenly across the entire terrain, resulting in a consistent reduction of snow coverage.<br>`Directional` — Snow melts preferentially in a specific direction, simulating effects such as sun exposure or wind, leading to uneven snow retreat. |
| Melt | Single `float` | `0f`，范围 0f … 1f | Defines the method by which snow melts from the terrain, affecting the pattern and distribution of melting. |
| Melt Remnants | Single `float` | `0f`，范围 0f … 1f | Specifies the amount and appearance of snow left behind after melting, such as patches or traces of residual snow. |
| Direction | Int32 `int` | `0`，范围 0 … 360 | Sets the primary direction for directional melting, influencing which areas of the terrain lose snow first. |
| Snow Line | Single `float` | `0f`，范围 0f … 1f | Defines the altitude or threshold below which snow does not accumulate, simulating natural snow lines on mountains. |
| **Advanced** *(分组标题)* | — | — | `[Group]` 由 `SlipOffAngle`, `AdheredSnowMass`, `ModelScale`, `RealScale` 声明 |
| Slip-off angle | Single `float` | `38f`，范围 0f … 90f | Specifies the minimum slope angle at which snow will slide off, affecting snow accumulation on steep surfaces.<br>*C# 属性 `SlipOffAngle`* |
| Adhered snow mass | Single `float` | `12f`，范围 0f … 30f | Controls the amount of snow that remains attached to surfaces, even on steep or vertical terrain.<br>*C# 属性 `AdheredSnowMass`* |
| Model scale | Single `float` | `5f`，范围 1f … 16f | Sets the scale of the terrain model, influencing how snow parameters are interpreted relative to real-world dimensions.<br>*C# 属性 `ModelScale`* |
| Real Scale | Boolean `bool` | `true`，范围 0f … 1f | Specifies the actual physical scale represented by the terrain, used for accurate snow simulation and parameter scaling.<br>*C# 属性 `RealScale`* |
| Terrain Scale | Int32 `int` | `5000`，范围 500 … 20000 | Adjusts the scaling factor for the terrain, affecting how snow features are distributed and visualized.<br>*C# 属性 `TerrainScale`* |
| Verticality | Int32 `int` | `3200`，范围 50 … 20000 | Controls the influence of vertical surfaces on snow accumulation, determining how much snow can adhere to cliffs and steep slopes. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Sets the randomization seed for snow distribution, ensuring reproducible results or introducing variation in snow patterns. |

### Snowfield

`QuadSpinner.Gaea.Nodes.Snowfield` · Family `Snow` · Classification `Processor` · ShortCode `sf` · Keywords `snow`

> Creates broad settled snow coverage across the terrain surface.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Snow** *(分组标题)* | — | — | `[Group]` 由 `Cascades`, `Duration`, `Intensity`, `TaperSnowfall` 声明 |
| Cascades | Int32 `int` | `6`，范围 1 … 50 |  |
| Duration | Single `float` | `0.25f`，范围 0f … 1f |  |
| Intensity | Single `float` | `0.35f`，范围 0f … 1f |  |
| Taper Snowfall | Boolean `bool` | `false`，范围 0f … 1f |  |
| Taper Amount | Single `float` | `0.25f`，范围 0f … 1f |  |
| Settle Duration | Single `float` | `0.25`，范围 0f … 1f | *C# 属性 `SettleThaw`* |
| Melt | Single `float` | `0f`，范围 0f … 1f |  |
| Snow Line | Single `float` | `0f`，范围 0f … 1f |  |
| **Advanced** *(分组标题)* | — | — | `[Group]` 由 `SlipOffAngle`, `AdheredSnowMass`, `Flows`, `FlowsDepth` 声明 |
| Slip-off angle | Single `float` | `38f`，范围 0f … 90f | *C# 属性 `SlipOffAngle`* |
| Adhered snow mass | Single `float` | `12f`，范围 0f … 30f | *C# 属性 `AdheredSnowMass`* |
| Flows | Boolean `bool` | `false`，范围 0f … 1f |  |
| Flows Depth | Single `float` | `0.25f`，范围 0f … 1f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |
| Sharp Buildup | Boolean `bool` | `false`，范围 0f … 1f |  |
| Alternate Snowfall | Boolean `bool` | `false`，范围 0f … 1f |  |
| Surface Details | Single `float` | `0.4f`，范围 0f … 1f |  |
| Direction | Enum `GradientDirection` | `GradientDirection.X`，范围 0f … 1f | `X` — <desc><br>`N` — <desc><br>`E` — <desc><br>`S` — <desc><br>`W` — <desc> |

### Thermal

`QuadSpinner.Gaea.Nodes.Thermal` · Family `Erosion` · Classification `Processor` · ShortCode `te`

> Thermal simulates Thermal Erosion to create talus and debris.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 4 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Erosion** *(分组标题)* | — | — | `[Group]` 由 `Duration`, `Strength`, `Anisotropy`, `Seed` 声明 |
| Duration | Single `float` | `0.04f`，范围 0.0001f … 1f | Controls how long the thermal erosion process is applied. Higher values result in more extensive terrain changes over time. |
| Strength | Single `float` | `0.5f`，范围 0.0001f … 1f | Sets the intensity of thermal erosion. Increasing this value produces more pronounced smoothing and displacement, especially on steep slopes. |
| Anisotropy | Single `float` | `0.65f`，范围 0.05f … 1f | Adjusts the directional bias of erosion and deposit formation. Low values preserve the original terrain, while high values intensify directional erosion, shaping talus deposits and terrain features. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomizes the erosion pattern while keeping other settings unchanged, allowing for varied results without retuning parameters. |
| **Talus** *(分组标题)* | — | — | `[Group]` 由 `Angle`, `Settling`, `SedimentRemoval` 声明 |
| Angle | Single `float` | `32f`，范围 0f … 90f | Sets the maximum slope angle before material begins to move downward, forming talus. Lower angles create gentler slopes, while higher angles allow steeper terrain before shifting occurs. |
| Settling | Single `float` | `0.15`，范围 0f … 1f | Controls how quickly and thoroughly loose material settles after being eroded. Higher values result in faster, more complete settling, while lower values allow for gradual accumulation. |
| Sediment Removal | Single `float` | `0f`，范围 0f … 1f | Determines the amount of sediment removed during talus formation. Higher values produce cleaner, sharper features, while lower values allow more sediment to accumulate, creating smoother transitions. |
| **Scale** *(分组标题)* | — | — | `[Group]` 由 `FeatureScale`, `RealScale`, `TerrainScale`, `Verticality` 声明 |
| Feature Scale | Int32 `int` | `25`，范围 1 … 300 | Sets the scale of the largest thermal erosion features in the terrain. Larger values create broader, more pronounced features; smaller values result in finer details. |
| Real Scale | Boolean `bool` | `true`，范围 0f … 1f | Uses the scale defined by the terrain's physical dimensions. Disable to access additional options and manually adjust erosion physics. |
| Terrain Scale | Int32 `int` | `10000`，范围 500 … 20000 | Specifies the overall scale of the terrain when Real Scale is turned off, allowing for manual adjustment of terrain size. |
| Verticality | Int32 `int` | `2000`，范围 5 … 20000 | Controls the height of the terrain when Real Scale is turned off, enabling further customization of vertical exaggeration. |

### Thermal2

`QuadSpinner.Gaea.Nodes.Thermal2` · Family `Erosion` · Classification `Processor` · ShortCode `t2`

> Thermal2 is an evolution of the previous node. It creates Thermal Erosion to create realistic talus and debris.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 4 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Erosion** *(分组标题)* | — | — | `[Group]` 由 `Duration`, `Strength`, `Anisotropy` 声明 |
| Duration | Single `float` | `0.04f`，范围 0.0001f … 1f | Controls the duration of the thermal erosion process. Higher values extend the erosion period, resulting in more significant changes to the terrain. |
| Strength | Single `float` | `0.25f`，范围 0.0001f … 1f | Determines the intensity of thermal erosion. Increasing this value produces more pronounced smoothing and displacement of materials, especially on steeper slopes. |
| Anisotropy | Single `float` | `0.25f`，范围 0f … 1f | Governs the directional bias of erosion and rock deposits. Low values preserve the original terrain with minimal smoothing, while high values intensify erosion, especially on sharp peaks, leading to stronger talus formation and more heavily eroded terrain. Useful for simulating environments with directional erosion influences such as wind or gravity. |
| **Talus** *(分组标题)* | — | — | `[Group]` 由 `Angle`, `SedimentRemoval` 声明 |
| Angle | Single `float` | `32f`，范围 0f … 90f | Sets the maximum slope angle before materials begin to move downward, forming talus. Lower angles create more gradual slopes, while higher angles allow steeper terrain before material shifts. |
| Sediment Removal | Single `float` | `0f`，范围 0f … 1f | Controls the amount of sediment removed during talus formation. Higher values produce cleaner, sharper features by removing excess material, while lower values allow more sediment to accumulate, resulting in smoother transitions. |
| **Scale** *(分组标题)* | — | — | `[Group]` 由 `FeatureScale` 声明 |
| Feature Scale | Single `float` | `25f`，范围 1f … 300f | Adjusts the scale of thermal erosion features in meters. Larger values create broader, more pronounced features, while smaller values result in finer details. |

### Trees

`QuadSpinner.Gaea.Nodes.Trees` · Family `Vegetation` · Classification `Processor` · ShortCode `tr` · Keywords `arboreal`

> The Arboreal Node gives you the power of creating superficial forests and vegetation. These forests are part of the heightfield while being "detached" enough for various export scenarios.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 5 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Trees** *(分组标题)* | — | — | `[Group]` 由 `Output`, `TreeCount`, `IsRelative`, `LODInfo` 声明 |
| Output | Enum `TreeOutput` | `TreeOutput.Instances`，范围 0f … 1f | `Instances` — Outputs individual tree instance data for use in rendering, simulation, or export. Recommended for stable and reliable results.<br>`AreaMask` — Outputs a mask indicating areas where trees are placed. Useful for visualization and blending, but currently experimental and may produce less predictable results. |
| Count in Thousands | Int32 `int` | `20`，范围 10 … 1000 | Sets the number of trees to be placed, specified in thousands. Higher values increase density and mask quality but may impact performance and memory usage.<br>*C# 属性 `TreeCount`* |
| Is Relative | Boolean `bool` | `true`，范围 0f … 1f | If enabled, tree count scales with terrain resolution for consistent density. Recommended for predictable results at higher resolutions, but may increase resource usage. |
| LOD Info | String `string` | (ComputedString，默认值在混淆常量表中) | Provides Level of Detail (LOD) information for tree instances, enabling optimized rendering and export at different distances or resolutions. |
| Tree Size | Single `float` | `0.1f`，范围 0f … 1f | Controls the height of each tree instance. Affects the appearance of exported trees but not the mask. Useful for adjusting the final look of tree outputs. |
| Trim Under | Single `float` | `0.1f`，范围 0f … 1f | Removes tree instances below a certain size threshold, clamping down on smaller or weaker trees to refine the mask and output. |
| Shape | Enum `TreeShape` | `TreeShape.Point`，范围 0f … 1f | `Point` — Places trees as single small pixels, resulting in sparse and detailed distribution. Best for internal visualization.<br>`Big` — Places larger tree shapes, creating denser and more legible masks. Preferred for exporting tree masks.<br>`BigOnly` — Restricts placement to only large tree clusters, excluding smaller or individual trees for a bold mask. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Sets the randomization seed for procedural tree placement. Changing the seed produces different tree layouts and simulation results. |
| **Growth** *(分组标题)* | — | — | `[Group]` 由 `WaterAffinity`, `AvoidTrees`, `Health`, `Patches` 声明 |
| Seek Water | Enum `WaterAffinity` | `WaterAffinity.Seek`，范围 0f … 1f | `Seek` — Trees preferentially grow near water sources and flow areas, simulating water-loving species.<br>`Avoid` — Trees avoid water sources and flow areas, simulating species that prefer drier conditions.<br>*C# 属性 `WaterAffinity`* |
| Avoid Trees | Enum `AvoidTrees` | `AvoidTrees.None`，范围 0f … 1f | `None` — No avoidance; trees can be placed close together or overlap with other tree nodes.<br>`Previous` — New trees avoid areas occupied by the previously placed tree node, reducing overlap in stacked nodes.<br>`All` — New trees avoid all other tree nodes in the stack, maximizing spacing and separation. |
| Health | Single `float` | `0.8f`，范围 0f … 1f | Controls the duration and vigor of the tree simulation. Higher health increases density and allows trees to grow into smaller valleys and more challenging terrain. Lower health restricts growth to main flow areas. |
| Patches | Single `float` | `0.4f`，范围 0.0001f … 1f | Clumps trees together into larger groups, creating stylized patches instead of individual trees. Useful for natural-looking forests. |
| Spread | Single `float` | `0f`，范围 0.0001f … 1f | Blurs and expands the area where trees can grow, merging small flows into larger masses and creating more natural, contiguous forest areas. |
| Random | Single `float` | `0f`，范围 0f … 1f | Adds random noise to tree placement, scattering trees across the terrain without regard to inhibition or aspect controls. Rarely used for realistic masks. |
| **Aspect Inhibition** *(分组标题)* | — | — | `[Group]` 由 `Slope`, `SlopeFalloff`, `Altitude`, `AltitudeFalloff` 声明 |
| Slope | Float2 `Float2` | `0f`，范围 0f … 90f | Restricts tree growth on steep terrain. Not recommended when using a custom inhibition mask, as the mask provides more accurate control. |
| Slope Falloff | Single `float` | `10f`，范围 0f … 90f | Controls how quickly tree density decreases as slope increases. Use with slope inhibition for gradual or sharp transitions. |
| Altitude | Float2 `Float2` | `0f`，范围 0f … 1f | Sets altitude limits for tree placement, simulating elevation-based growth restrictions. Works well with both aspect inhibition and custom masks. |
| Altitude Falloff | Single `float` | `1f`，范围 0f … 1f | Controls the rate at which tree density decreases with altitude, enabling smooth or sharp transitions in elevation-based inhibition. |
| Peaks | Single `float` | `0f`，范围 0f … 1f | Removes tree growth from exposed mountain peaks, preventing trees from growing in the most exposed areas. |
| Strict | Boolean `bool` | `false`，范围 0f … 1f | Enforces strict adherence to inhibition rules, resulting in sharper falloff and less natural tree distribution. Use for precise, non-organic masks. |
| **Snow Inhibition** *(分组标题)* | — | — | `[Group]` 由 `DeadFlow`, `ConsolidateFlows`, `Bias`, `Snowline` 声明 |
| Dead Flow | Single `float` | `0f`，范围 0f … 1f | Represents areas where tree growth is suppressed due to snow mass or adverse conditions. Controls the amount of snow mass moving down the terrain. |
| Consolidate Flows | Single `float` | `0.5f`，范围 0f … 1f | Groups snow flows into larger masses, affecting how far snow moves down the terrain and influencing tree inhibition. |
| Bias | Single `float` | `0.5f`，范围 0f … 1f | Directs snow flows to move less or more, affecting the inhibition of tree growth in snowy areas. |
| Snowline | Single `float` | `0.1f`，范围 0f … 1f | Defines the altitude at which snow flows start, restricting tree growth above this line. |
| **Artistic Control** *(分组标题)* | — | — | `[Group]` 由 `Chaos`, `BlurEdges`, `VisualizeData` 声明 |
| Chaos | Single `float` | `0.5f`，范围 0f … 1f | Warps tree positions for a more natural, randomized look, breaking up straight flows and adding organic variation. |
| Blur Edges | Single `float` | `0f`，范围 0f … 1f | Softens and tapers the edges of tree patches, blending them into the terrain for a more natural transition. |
| Visualize Data | Boolean `bool` | `false`，范围 0f … 1f | Enables visualization of tree placement, flows, and snow inhibition, assisting with mask tuning and debugging. |
| **Custom Inhibitors** *(分组标题)* | — | — | `[Group]` 由 `CustomInfluence`, `Trim` 声明 |
| Custom Influence | Single `float` | `0f`，范围 0f … 1f | Applies custom influence maps or masks to control tree placement according to user specifications, enabling highly tailored results. |
| Trim | Single `float` | `0.1f`，范围 0f … 1f | Removes trees from specified areas, allowing for manual or procedural clearing of tree patches for refined mask output. |

### Wizard

`QuadSpinner.Gaea.Nodes.Wizard` · Family `Erosion` · Classification `Processor` · ShortCode `z1`

> The Erosion Wizard is a lightweight wrapper for the Erosion node. It simplifies the settings through curated presets, and provides secondary passes for additional processing.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Erosion** *(分组标题)* | — | — | `[Group]` 由 `Strength`, `Density`, `Material`, `ChannelDepth` 声明 |
| Strength | Enum `Generic4` | `Generic4.Low`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Density | Enum `Generic4` | `Generic4.Med`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Material | Enum `Generic4` | `Generic4.High`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Channel Depth | Enum `Generic4` | `Generic4.Med`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Channel Width | Enum `Generic4` | `Generic4.Low`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Deposits | Enum `Generic4` | `Generic4.Med`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Removal | Enum `Generic4` | `Generic4.High`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Bulk | Enum `Generic4` | `Generic4.High`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### Wizard2

`QuadSpinner.Gaea.Nodes.Wizard2` · Family `Erosion` · Classification `Processor` · ShortCode `z2` · Keywords `w2`

> A simplified erosion wrapper that provides curated controls for shaping erosion depth, scale, and strength.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Erosion** *(分组标题)* | — | — | `[Group]` 由 `Power`, `Depth`, `Scale`, `Deposits` 声明 |
| Power | Enum `Generic4` | `Generic4.Low`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Depth | Enum `Generic4` | `Generic4.Med`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Scale | Enum `Generic4` | `Generic4.High`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Deposits | Enum `Generic4` | `Generic4.Med`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Flow | Enum `Generic4` | `Generic4.Low`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Shape | Enum `Generic4` | `Generic4.Med`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Detail | Enum `Generic4` | `Generic4.High`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |
| **Advanced** *(分组标题)* | — | — | ⚠ 程序集中无属性声明此分组 |
| Convert | Command | — |  |

## Derive

*派生数据图：法线、AO、遮挡、流向、坡度、曲率* — `NodeCategory.Derive`，共 14 个节点。

### Angle

`QuadSpinner.Gaea.Nodes.Angle` · Family `Aspect` · Classification `Mask` · ShortCode `ang`

> Angle creates a selection mask covering all areas of the heightfield facing the specified range.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Azimuth | Single `float` | `0f`，范围 0f … 360f | The direction from which to start the selection. |
| Range | Float2 `Float2` | `0f`，范围 0f … 1f |  |
| Falloff | Single `float` | `0.2f`，范围 0f … 1f | The soft falloff at the maximum angle. |

### ColorThreshold

`QuadSpinner.Gaea.Nodes.ColorThreshold` · Family `Aspect` · Classification `Mask` · ShortCode `cth`

> Creates a greyscale mask from a specified color range.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Start | Color `Color` | — | The color to mask from the given input. |
| Falloff | Single `float` | `0.2f`，范围 0.0001f … 1f | Range of similar colors to be masked as well. |

### Curvature

`QuadSpinner.Gaea.Nodes.Curvature` · Family `Aspect` · Classification `Mask` · ShortCode `cv`

> Curvature creates a mask where convex areas (protrusions, sharp edges, etc.) are selected. Very useful layer in texture creation, often as highlights on top of an existing texture map.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Range | Float2 `Float2` | `0f`，范围 0f … 1f | Sets the minimum and maximum curvature values to include in the mask. Only terrain features within this curvature range are selected. |
| Type | Enum `CurvatureType` | (HorizontalListNoLabel，默认值在混淆常量表中) | `Horizontal` — Selects areas with horizontal (planform) curvature, highlighting ridges and valleys based on their plan shape.<br>`Vertical` — Selects areas with vertical (profile) curvature, emphasizing convex and concave slopes along the direction of steepest descent.<br>`Average` — Uses the average of horizontal and vertical curvature, providing a balanced mask that highlights both plan and profile features. |
| Falloff | Single `float` | `0.2f`，范围 0f … 1f | Controls the softness of the mask transition at the range boundaries. Higher values create a smoother, more gradual blend from selected to unselected areas. |

### FlowMap

`QuadSpinner.Gaea.Nodes.FlowMap` · Family `Generative` · Classification `Mask` · ShortCode `fl` · Keywords `flow fm`

> Generates a modern flow map showing how water or material would travel across the terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Flow Length | Single `float` | `0.1f`，范围 0f … 1f | Controls how far flow paths are traced across the surface (longer values produce longer streams/flow lines). |
| Flow Volume | Single `float` | `0.5f`，范围 0f … 1f | Controls the amount/strength of flow accumulation used to form the flow map (higher values emphasize major channels). |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The randomization pattern or seed for the node's process. |

### FlowMapClassic

`QuadSpinner.Gaea.Nodes.FlowMapClassic` · Family `Generative` · Classification `Mask` · ShortCode `fl1`

> Generates a classic-style flow map based on legacy flow behavior.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Rainfall | Single `float` | `0.2f`，范围 0f … 1f |  |
| Primary | Boolean `bool` | `false`，范围 0f … 1f |  |
| Secondary | Boolean `bool` | `false`，范围 0f … 1f |  |
| Tertiary | Boolean `bool` | `false`，范围 0f … 1f |  |
| Quaternary | Boolean `bool` | `false`，范围 0f … 1f |  |
| Simulate 2 X | Boolean `bool` | `false`，范围 0f … 1f |  |
| Enhance | Single `float` | `1f`，范围 0f … 1f |  |
| Quality | Enum `RelativeQuality` | `RelativeQuality.Quarter`，范围 0f … 1f | `Quarter` — <desc><br>`Third` — <desc><br>`Half` — <desc><br>`Full` — <desc> |

### Height

`QuadSpinner.Gaea.Nodes.Height` · Family `Aspect` · Classification `Mask` · ShortCode `h`

> Height creates a selection mask within the height range specified.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Range | Float2 `Float2` | `0f`，范围 0f … 1f | Sets the minimum and maximum elevation values to include in the mask. Only terrain within this height range is selected. |
| Falloff | Single `float` | `0.2f`，范围 0.0001f … 1f | Controls the softness of the mask transition at the range boundaries. Higher values create a smoother, more gradual blend from selected to unselected areas. |

### Normals

`QuadSpinner.Gaea.Nodes.Normals` · Family `Aspect` · Classification `Colorizer` · ShortCode `nm`

> Generates a normal map from the terrain for shading and downstream workflows.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Type | Enum `NormalMapType` | (HorizontalList，默认值在混淆常量表中) | `Standard` — Generates a standard normal map based on the main heightfield, suitable for general use in rendering and texturing.<br>`Detail` — Generates a high-frequency detail normal map, emphasizing fine surface features for use as a detail overlay or in advanced shading. |
| Width | Single `float` | `0.5f`，范围 0f … 1f | Sets the horizontal resolution of the generated normal map in pixels. Higher values produce more detailed maps but increase memory usage. |
| Height | Single `float` | `0.5f`，范围 0f … 10f | Sets the vertical resolution of the generated normal map in pixels. Higher values produce more detailed maps but increase memory usage. |
| Detail Size | Single `float` | `0.5f`，范围 0f … 1f | Controls the scale of fine details captured in the normal map. Smaller values emphasize finer features, while larger values smooth out detail. |
| Handedness | Enum `Handedness` | (HorizontalListNoLabel，默认值在混淆常量表中) | `Left` — Generates the normal map using a left-handed coordinate system, commonly used in some 3D applications and engines.<br>`Right` — Generates the normal map using a right-handed coordinate system, standard in many 3D applications and engines. |
| Up Axis | Enum `UpAxis` | (HorizontalListNoLabel，默认值在混淆常量表中) | `YUp` — Sets the Y axis as the vertical (up) direction, matching engines and workflows that use Y as up.<br>`ZUp` — Sets the Z axis as the vertical (up) direction, matching engines and workflows that use Z as up. |
| Information 1 | Byte `byte` | — |  |

### Occlusion

`QuadSpinner.Gaea.Nodes.Occlusion` · Family `Generative` · Classification `Processor` · ShortCode `ccl` · Keywords `occlusion`

> Occlusion behaves similarly to Ambient Occlusion, but favors sedimentary processes vs. lighting.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Strength | Single `float` | `2f`，范围 0f … 10f | Controls the intensity of the occlusion effect. Higher values produce deeper and more pronounced shadowing in crevices and low areas. |
| Octaves | Int32 `int` | `1`，范围 1 … 10 | Sets the number of detail layers used in the occlusion calculation. Increasing octaves adds finer detail and complexity to the occlusion shadows. |

### Peaks

`QuadSpinner.Gaea.Nodes.Peaks` · Family `Aspect` · Classification `Mask` · ShortCode `pk`

> Creates a mask that isolates the peaks and highest protruding parts of the terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Falloff | Single `float` | `0f`，范围 -1f … 1f | Controls how quickly the mask transitions from the peaks and ridges to lower altitudes. Higher values create a sharper, more focused mask around the highest points. |
| Precise | Boolean `bool` | `false`，范围 0f … 1f | Enables a more accurate detection of peaks and ridges, resulting in a mask that closely follows the true tips of the terrain. |

### RockMap

`QuadSpinner.Gaea.Nodes.RockMap` · Family `Generative` · Classification `Mask` · ShortCode `km`

> RockMap creates a rock-like coverage mask that can be used to texture terrains on its own or combined with other Data Maps.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Coverage | Single `float` | `0.33f`，范围 0f … 1f | The amount of rock-like formations on the terrain. |
| Density | Single `float` | `0f`，范围 -1f … 1f | The density of the rock-like formations. |

### Slope

`QuadSpinner.Gaea.Nodes.Slope` · Family `Aspect` · Classification `Mask` · ShortCode `sl`

> Slope creates a selection mask within the slope range specified.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Range | Float2 `Float2` | `0f`，范围 0f … 90f | Sets the minimum and maximum slope angles to include. Only terrain within this range is selected in the mask. |
| Falloff | Single `float` | `15f`，范围 0.0001f … 90f | Controls the soft transition at the range boundaries. Higher values create a smoother, more gradual blend from selected to unselected areas. |
| Type | Enum `SlopeMapType` | `SlopeMapType.Accurate`，范围 0f … 1f | `Accurate` — Uses precise slope computation for more realistic, detail-preserving results.<br>`Normalized` — Produces a consistent, even distribution across the slope range, useful for stylized or uniform masks. |
| Micro Accent | Single `float` | `0f`，范围 0f … 1f | Enhances fine details and subtle variations in the slope mask, adding extra texture and definition to small-scale features. |

### Soil

`QuadSpinner.Gaea.Nodes.Soil` · Family `Texture` · Classification `Mask` · ShortCode `so`

> Soil Map creates a soil mask, with increased density in crevices or other areas where the slope allows soil to settle.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Amount | Single `float` | `0.6f`，范围 0f … 1f |  |
| Bias | Single `float` | `0f`，范围 -1f … 1f |  |

### TextureBase

`QuadSpinner.Gaea.Nodes.TextureBase` · Family `Texture` · Classification `Mask` · ShortCode `tb`

> Texture uses multiple factors (such as chaos, slopes, flow zones, and other geological features) to create a texture mask for any color node to create a texture map. Can be used by itself, or combined with other data maps and selectors.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Structure** *(分组标题)* | — | — | `[Group]` 由 `Slope`, `Scale`, `Soil`, `Patches` 声明 |
| Slope | Single `float` | `0.25f`，范围 0f … 1f | Controls the influence of terrain slope on the texture, allowing highlights or patterns to follow steeper areas. |
| Flows | Single `float` | `0.15f`，范围 0f … 1f | Adds flow-based features to the texture, simulating the effect of water or material movement across the surface.<br>*C# 属性 `Scale`* |
| Soil | Single `float` | `0.6f`，范围 0f … 1f | Introduces soil-like patterns or noise, adding organic variation to the texture. |
| Patches | Single `float` | `0.4f`，范围 0f … 1f | Controls the presence and size of patchy areas within the texture, creating irregular or clustered features. |
| Chaos | Single `float` | `0.1f`，范围 0f … 1f | Adjusts the randomness and disorder in the texture, increasing natural variation and reducing uniformity. |
| Peaks | Single `float` | `0f`，范围 0f … 1f | Emphasizes or introduces features that follow terrain peaks, adding detail to high areas in the texture. |
| **Processing** *(分组标题)* | — | — | `[Group]` 由 `Accentuation`, `Enhance`, `Reverse`, `Seed` 声明 |
| Accentuate | Enum `AccentuateType` | `AccentuateType.Off`，范围 0f … 1f | `Off` — No accentuation is applied; the texture remains unmodified.<br>`Old` — Applies the legacy accentuation method, increasing contrast and detail using the previous algorithm.<br>`New` — Uses the latest accentuation method for improved feature enhancement and clarity.<br>*C# 属性 `Accentuation`* |
| Enhance | Enum `ProcessInput` | `ProcessInput.None`，范围 0f … 1f | `None` — No enhancement is applied.<br>`Autolevel` — Automatically adjusts the levels to maximize the full tonal range, improving contrast.<br>`Equalize` — Equalizes the histogram, distributing intensity values more evenly for a balanced look. |
| Reverse | Boolean `bool` | `false`，范围 0f … 1f | Inverts the black and white values of the texture, swapping dark and light areas. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomization seed for generating the texture. Changing the seed produces different pattern variations. |

### Texturizer

`QuadSpinner.Gaea.Nodes.Texturizer` · Family `Texture` · Classification `Mask` · ShortCode `tz`

> Generates terrain texture masks using preset styles and controllable secondary effects.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Style | Enum `QuickTexture` | (OptionGrid，默认值在混淆常量表中) | `A` — <desc><br>`B` — <desc><br>`C` — <desc><br>`D` — <desc><br>`E` — <desc><br>`F` — <desc><br>`G` — <desc><br>`H` — <desc><br>`I` — <desc><br>`J` — <desc><br>`K` — <desc><br>`L` — <desc> |
| Factor | Single `float` | `0.5f`，范围 0f … 1f | Primary driver controlling the overall strength or intensity of the selected style. Higher values increase the prominence of the texture effect. |
| Secondary | Single `float` | `0f`，范围 0f … 1f | Adjusts the strength of secondary effects such as soil accumulation, flow streaks, and breakup patterns. Use to fine-tune the complexity and realism of the texture. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Randomizes the pattern while keeping other settings the same, allowing for variation without the need to re-tune parameters. |
| **Components** *(分组标题)* | — | — | `[Group]` 由 `Flows`, `Slope`, `Soil` 声明 |
| Flows | Single `float` | `0.33f`，范围 0f … 1f | Simulates natural erosion channels and directional streaks, adding realism by mimicking the effects of water or wind movement across the terrain. |
| Slope | Single `float` | `0.33f`，范围 0f … 1f | Adds slope-based weighting to the texture, favoring either steeper or flatter areas to enhance natural variation. |
| Soil | Single `float` | `0.33f`，范围 0f … 1f | Controls soil-like accumulation in flatter regions, adding natural buildup and enhancing the realism of the terrain surface. |

## Colorize

*着色与颜色处理* — `NodeCategory.Colorize`，共 13 个节点。

### CLUTer

`QuadSpinner.Gaea.Nodes.CLUTer` · Family `Color` · Classification `Colorizer` · ShortCode `clt` · Keywords `gradient ramp colorize`

> CLUTer creates color gradients which can be mapped to texture masks to make color maps.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Gradient Data | List`1 `List<Float4>` | (GradientEditor，默认值在混淆常量表中) |  |
| Autolevel Input | Boolean `bool` | — |  |
| Reverse | Boolean `bool` | — | Reverses the mapping of the gradient. |
| Bias | Single `float` | `0f`，范围 -1f … 1f |  |
| Hue | Single `float` | `0f`，范围 -1f … 1f |  |
| Saturation | Single `float` | `0f`，范围 -1f … 1f |  |
| Lightness | Single `float` | `0f`，范围 -1f … 1f |  |

### ColorErosion

`QuadSpinner.Gaea.Nodes.ColorErosion` · Family `Erosion` · Classification `Processor` · ShortCode `cx`

> Applies erosion-style transport and deposition to color data, creating more natural weathered color variation.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Transport Distance | Single `float` | `0.5f`，范围 0f … 2f |  |
| Sediment Density | Single `float` | `0.5f`，范围 0f … 1f |  |
| Blend | Single `float` | `0.5f`，范围 0f … 1f |  |
| Color Hold | Single `float` | `0.5f`，范围 0f … 1f |  |
| Flow Volume | Single `float` | `0f`，范围 0f … 1f |  |
| Laminar Flow | Boolean `bool` | `false`，范围 0f … 1f |  |
| Diffusion | Single `float` | `0f`，范围 0f … 1f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |
| Version | Enum | — | `V0` — <desc><br>`V1` — <desc><br>`V2` — <desc> |
| Q 0 | Boolean | — |  |
| Q 1 | Boolean | — |  |

### Gamma

`QuadSpinner.Gaea.Nodes.Gamma` · Family `Adjust` · Classification `Colorizer` · ShortCode `ga`

> Gamma applies Gamma adjustment to the heightfield, working exactly like Gamma in an image processing program.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Gamma | Single `float` | `0.44f`，范围 0f … 4f | The Gamma range is 0.0 to 2.5, with 1.0 being neutral or the original incoming gamma. &lt; 1.0 lifts mid-values (brighter), expands lighter detail, broadens features. &gt; 1.0 darkens mid-values, compresses lighter detail, tightens features.<br>*C# 属性 `GammaValue`* |
| Automatic | Boolean `bool` | `false`，范围 0f … 1f | Tries to automatically set the correct gamma based on existing value. |

### HSL

`QuadSpinner.Gaea.Nodes.HSL` · Family `Adjust` · Classification `Colorizer` · ShortCode `hu`

> Adjusts the hue, saturation, and lightness of a color input.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Hue | Single `float` | `0f`，范围 -1f … 1f | Adjusts the hue of the input, shifting colors around the color wheel. Changing this value alters the overall color tone. |
| Saturation | Single `float` | `0f`，范围 -1f … 1f | Controls the intensity or vividness of colors. Higher values produce more vibrant colors, while lower values result in muted or grayscale tones. |
| Lightness | Single `float` | `0f`，范围 -1f … 1f | Sets the brightness of the colors. Increasing lightness makes the image lighter, while decreasing it darkens the image. |

### RGBMerge

`QuadSpinner.Gaea.Nodes.RGBMerge` · Family `Utilities` · Classification `Colorizer` · ShortCode `rm` · Keywords `rgb mix join combine`

> Combines three heightfields into a single RGB color output by packing them into separate channels.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Enhance R | Enum `ProcessInput` | `ProcessInput.None`，范围 0f … 1f | `None` — No enhancement is applied to the Red channel. The input values are used as-is.<br>`Autolevel` — Automatically stretches the Red channel's values to use the full available range, increasing contrast.<br>`Equalize` — Redistributes the Red channel's values to achieve a more uniform histogram, enhancing detail and balance. |
| Enhance G | Enum `ProcessInput` | `ProcessInput.None`，范围 0f … 1f | `None` — No enhancement is applied to the Green channel. The input values are used as-is.<br>`Autolevel` — Automatically stretches the Green channel's values to use the full available range, increasing contrast.<br>`Equalize` — Redistributes the Green channel's values to achieve a more uniform histogram, enhancing detail and balance. |
| Enhance B | Enum `ProcessInput` | `ProcessInput.None`，范围 0f … 1f | `None` — No enhancement is applied to the Blue channel. The input values are used as-is.<br>`Autolevel` — Automatically stretches the Blue channel's values to use the full available range, increasing contrast.<br>`Equalize` — Redistributes the Blue channel's values to achieve a more uniform histogram, enhancing detail and balance. |

### RGBSplit

`QuadSpinner.Gaea.Nodes.RGBSplit` · Family `Utilities` · Classification `Colorizer` · ShortCode `rsp` · Keywords `gray grayscale greyscale monochrome`

> RGBSplit takes a color node and splits the Red/Green/Blue channels into heightfields. The counterpart to RGBMix.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Autolevel Channels | Boolean `bool` | `false`，范围 0f … 1f | Automatically adjusts the levels of each RGB channel independently, ensuring optimal contrast and brightness for each channel after splitting. |
| Method | Enum `GrayscaleConversion` | `GrayscaleConversion.Average`，范围 0f … 1f | `Average` — Splits the image by averaging the values of the RGB channels, producing a single grayscale output based on the mean intensity.<br>`BT601` — Uses the BT.601 standard for converting RGB to luminance, applying weighted coefficients for each channel to match broadcast video standards.<br>`BT709` — Uses the BT.709 standard for RGB to luminance conversion, applying weights optimized for HD video and modern displays.<br>`RedChannel` — Extracts only the red channel from the RGB image, outputting its values as a grayscale map. |

### SatMap

`QuadSpinner.Gaea.Nodes.SatMap` · Family `Color` · Classification `Colorizer` · ShortCode `sa`

> Generates terrain color from preset satellite-style palettes with controllable range and processing.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Library | Enum `CLUTLibrary` | (HorizontalListNoLabel，默认值在混淆常量表中) | `New` — <desc><br>`Rock` — <desc><br>`Sand` — <desc><br>`Green` — <desc><br>`Blue` — <desc><br>`Color` — <desc> |
| Randomize | Command `bool` | `"dice-five"` |  |
| Library Item | Int32 `int` | (Custom，默认值在混淆常量表中) |  |
| Range | Float2 `Float2` | `0f`，范围 0f … 1f |  |
| Bias | Single `float` | `0f`，范围 -1f … 1f |  |
| **Processing** *(分组标题)* | — | — | `[Group]` 由 `Enhance`, `Reverse`, `Rough`, `Hue` 声明 |
| Enhance | Enum `ProcessInput` | `ProcessInput.Autolevel`，范围 0f … 1f | `None` — <desc><br>`Autolevel` — <desc><br>`Equalize` — <desc> |
| Reverse | Boolean `bool` | `false`，范围 0f … 1f |  |
| Rough | Enum `Generic5` | (HorizontalList，默认值在混淆常量表中) | `None` — <desc><br>`Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |
| Hue | Single `float` | `0f`，范围 -1f … 1f |  |
| Saturation | Single `float` | `0f`，范围 -1f … 1f |  |
| Lightness | Single `float` | `0f`，范围 -1f … 1f |  |

### Splat

`QuadSpinner.Gaea.Nodes.Splat` · Family `Utilities` · Classification `Processor` · ShortCode `spl`

> Splat is similar to RGBMix, taking heightfield nodes and encoding them to the RGB channels of a color map, and providing properties to control the inputs.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| R | Single `float` | `1f`，范围 0f … 1f | Amount of R input channel. |
| G | Single `float` | `1f`，范围 0f … 1f | Amount of G input channel. |
| B | Single `float` | `1f`，范围 0f … 1f | Amount of B input channel. |
| A | Single `float` | `1f`，范围 0f … 1f | Amount of alpha input channel. |
| Autolevel | Boolean `bool` | `false`，范围 0f … 1f | Automatically adjusts the levels of the combined channels to maximize the output range. |
| Clamp Product | Boolean `bool` | `false`，范围 0f … 1f | Clamps the product of the R, G, and B channels to the 0..1 range, ensuring the output does not exceed valid limits. |

### SuperColor

`QuadSpinner.Gaea.Nodes.SuperColor` · Family `Color` · Classification `Colorizer` · ShortCode `spc`

> Applies procedural terrain colorization using texture, flow, peaks, and palette controls.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Texture** *(分组标题)* | — | — | `[Group]` 由 `Texture`, `Strength`, `Warp`, `Seed` 声明 |
| Texture | Enum `TextureMapType` | `TextureMapType.Peaks`，范围 0f … 1f | `None` — <desc><br>`Texture` — <desc><br>`Peaks` — <desc><br>`Flow` — <desc> |
| Strength | Single `float` | `0.5f`，范围 0f … 1f |  |
| Warp | Single `float` | `0f`，范围 0f … 1f |  |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |
| **Color** *(分组标题)* | — | — | `[Group]` 由 `Library`, `Randomize`, `LibraryItem`, `Data` 声明 |
| Library | Enum `CLUTLibrary` | (HorizontalListNoLabel，默认值在混淆常量表中) | `New` — <desc><br>`Rock` — <desc><br>`Sand` — <desc><br>`Green` — <desc><br>`Blue` — <desc><br>`Color` — <desc> |
| Randomize | Command `bool` | `"dice-five"` |  |
| Library Item | Int32 `int` | (Custom，默认值在混淆常量表中) |  |
| Range | Float2 `Float2` | `0f`，范围 0f … 1f |  |
| Bias | Single `float` | `0f`，范围 -1f … 1f |  |
| Reverse | Boolean `bool` | `false`，范围 0f … 1f |  |
| **Process** *(分组标题)* | — | — | `[Group]` 由 `Process`, `Amount` 声明 |
| Process | Enum `TextureProcessType` | `TextureProcessType.Erosion`，范围 0f … 1f | `Basic` — <desc><br>`Erosion` — <desc><br>`Third` — <desc> |
| Amount | Enum `Generic4` | `Generic4.Low`，范围 0f … 1f | `Low` — <desc><br>`Med` — <desc><br>`High` — <desc><br>`Ultra` — <desc> |

### Synth

`QuadSpinner.Gaea.Nodes.Synth` · Family `Color` · Classification `Colorizer` · ShortCode `sy`

> Synth takes a bitmap image (photo or artwork) and converts it to CLUT map that can be used with a texture mask to colorize your terrain.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Data | List`1 `List<Float4>` | (GradientEditor，默认值在混淆常量表中) | Input data for the node, such as source terrain or mask information. |
| **Sampling** *(分组标题)* | — | — | `[Group]` 由 `Samples`, `Fuzzy`, `Offset`, `Seed` 声明 |
| Samples | Enum `SynthSamples` | (OptionGrid，默认值在混淆常量表中) | `_8` — Generates a gradient with 8 color stops. Suitable for coarse transitions.<br>`_16` — Generates a gradient with 16 color stops. Provides a moderately smooth transition.<br>`_24` — Generates a gradient with 24 color stops. Offers finer color transitions.<br>`_36` — Generates a gradient with 36 color stops. Useful for detailed gradients.<br>`_64` — Generates a gradient with 64 color stops. Produces a very smooth color lookup.<br>`_128` — Generates a gradient with 128 color stops. Ideal for high-fidelity color transitions.<br>`_256` — Generates a gradient with 256 color stops. Recommended for ultra-smooth gradients.<br>`_1024` — Generates a gradient with 1024 color stops. Used for extremely fine color detail.<br>`_2048` — Generates a gradient with 2048 color stops. Maximum smoothness for professional-grade color lookup. |
| Fuzzy | Single `float` | `0f`，范围 0f … 1f | Controls the amount of fuzziness or blur applied to the gradient, affecting the softness of color transitions in the bitmap image. |
| Offset | Single `float` | `0f`，范围 0f … 1f | Shifts the position of the gradient along its axis, allowing adjustment of where color stops are mapped. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | Defines the randomization pattern or seed for the node's process, ensuring reproducible results when generating gradients. |
| Synthesize Colors | Command `bool` | (CommandButton，默认值在混淆常量表中) | Generates a color lookup gradient based on the specified number of samples and other parameters. The resulting gradient can be used for terrain coloring or other visual effects.<br>*C# 属性 `SynthColors`* |
| Export JSON | Command `bool` | `"device-floppy"` | Exports the synthesized gradient and node configuration as a JSON file for use in other applications or for documentation purposes.<br>*C# 属性 `ExportJSON`* |

### Tint

`QuadSpinner.Gaea.Nodes.Tint` · Family `Color` · Classification `Colorizer` · ShortCode `ti`

> QuickColor quickly maps a 2-color gradient to any mask. Useful for simple scenarios where CLUTer would be overkill.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Start | Color `Color` | — | Specifies the starting color of the gradient, mapped to the darkest (black) areas of the input map. |
| End | Color `Color` | — | Specifies the ending color of the gradient, mapped to the brightest (white) areas of the input map. |
| Hue | Single `float` | `0f`，范围 -1f … 1f | Adjusts the hue of the gradient colors, allowing for global color shifts across the entire gradient. |
| Saturation | Single `float` | `0f`，范围 -1f … 1f | Controls the intensity or vividness of the gradient colors. Higher values produce more vibrant colors, while lower values result in muted tones. |
| Lightness | Single `float` | `0f`，范围 -1f … 1f | Sets the overall brightness of the gradient colors, making the output lighter or darker. |
| **Processing** *(分组标题)* | — | — | `[Group]` 由 `Enhance`, `Reverse` 声明 |
| Enhance | Enum `ProcessInput` | `ProcessInput.Autolevel`，范围 0f … 1f | `None` — No enhancement is applied; the gradient is mapped directly from the input.<br>`Autolevel` — Automatically adjusts the levels to maximize the full tonal range, improving contrast in the gradient mapping.<br>`Equalize` — Equalizes the histogram, distributing intensity values more evenly for a balanced gradient effect. |
| Reverse | Boolean `bool` | `false`，范围 0f … 1f | Inverts the gradient mapping, swapping the start and end colors so that black maps to the end color and white maps to the start color. |

### WaterColor

`QuadSpinner.Gaea.Nodes.WaterColor` · Family `Color` · Classification `Colorizer` · ShortCode `wc`

> Colorizes water bodies using palette-based shallow and deep water tones.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 5 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Source | Enum `WaterSource` | `WaterSource.Accumulation`，范围 0f … 1f | `Port` — <desc><br>`Accumulation` — <desc> |
| Restrict to Group | Boolean `bool` | `false`，范围 0f … 1f |  |
| Palette | Enum `WaterColors` | `WaterColors.Generic`，范围 0f … 1f | `Generic` — <desc><br>`Jungle` — <desc><br>`Oasis` — <desc><br>`Dirty` — <desc><br>`OceanGreen` — <desc><br>`OceanBlue` — <desc><br>`Murky` — <desc><br>`Muddy` — <desc><br>`Custom` — <desc> |
| Shallow | Color `Color` | — |  |
| Deep | Color `Color` | — |  |
| Reverse | Boolean `bool` | `false`，范围 0f … 1f |  |
| Waves | Boolean `bool` | `false`，范围 0f … 1f |  |
| Refraction | Boolean `bool` | `false`，范围 0f … 1f |  |
| Color Bias | Single `float` | `0f`，范围 -1f … 1f |  |
| Mask Bias | Single `float` | `0f`，范围 -1f … 1f |  |
| **Contributions** *(分组标题)* | — | — | `[Group]` 由 `Stillwater`, `Rivers` 声明 |
| Stillwater | Single `float` | `0f`，范围 -1f … 1f |  |
| Rivers | Single `float` | `0f`，范围 -1f … 1f |  |
| **Post Processing** *(分组标题)* | — | — | `[Group]` 由 `Hue`, `Saturation`, `Lightness` 声明 |
| Hue | Single `float` | `0f`，范围 -1f … 1f |  |
| Saturation | Single `float` | `0f`，范围 -1f … 1f |  |
| Lightness | Single `float` | `0f`，范围 -1f … 1f |  |

### Weathering

`QuadSpinner.Gaea.Nodes.Weathering` · Family `Surface` · Classification `Mask` · ShortCode `we`

> Creates weathered color or mask variation that simulates dirt, fading, and environmental wear.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Primary** *(分组标题)* | — | — | `[Group]` 由 `Scale`, `Creep`, `Amount`, `WashedOut` 声明 |
| Scale | Single `float` | `0.1f`，范围 0f … 1f | Sets the scale at which weathering effects are applied. Lower values target fine details, while higher values affect larger terrain features. |
| Creep | Single `float` | `0.1f`，范围 0f … 1f | Simulates gradual movement and spreading of weathering effects across the terrain, softening transitions and blending weathered areas. |
| Amount | Single `float` | `0.8f`，范围 0f … 1f | Adjusts the overall intensity of the weathering effect. Higher values produce more pronounced weathering. |
| Washed Out | Boolean `bool` | `false`，范围 0f … 1f | Toggles if colors are faded or desaturated, mimicking the effect of prolonged exposure to the elements. |
| Inverse | Boolean `bool` | `false`，范围 0f … 1f | Inverts the weathering effect, applying it to areas that would normally be less affected, such as recesses instead of protrusions. |
| Dirt | Single `float` | `0.01f`，范围 0f … 1f | Adds darker coloration to crevices, nooks, and sheltered areas of the terrain, simulating the accumulation of soil, organic matter, or moisture. |
| Darker | Boolean `bool` | `false`，范围 0f … 1f | Intensifies the darkness of the dirt effect, making crevices and nooks appear deeper and more shadowed. |
| **Post Processing** *(分组标题)* | — | — | `[Group]` 由 `Hue`, `Saturation`, `Lightness` 声明 |
| Hue | Single `float` | `0f`，范围 -1f … 1f | Adjusts the overall hue of the weathered terrain, allowing for color shifts to match desired environmental conditions. |
| Saturation | Single `float` | `0f`，范围 -1f … 1f | Controls the intensity of colors in the weathered terrain, from muted to vibrant. |
| Lightness | Single `float` | `0f`，范围 -1f … 1f | Sets the overall brightness of the weathered terrain, affecting how light or dark the final result appears. |

## Output

*导出与打包输出* — `NodeCategory.Output`，共 12 个节点。

### AO

`QuadSpinner.Gaea.Nodes.AO` · Family `Render` · Classification `Mask` · ShortCode `ao`

> Creates an ambient occlusion map that darkens recessed areas and enhances terrain depth.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Quality | Enum `AOQuality` | (HorizontalList，默认值在混淆常量表中) | `Low` — Fastest processing with minimal detail. Suitable for previews or low-fidelity outputs.<br>`Medium` — Balanced processing speed and detail. Recommended for general use.<br>`High` — High detail with slower processing. Use when fine ambient occlusion is required.<br>`Ultra` — Maximum detail and accuracy. Best for final renders, but slowest to compute. |
| Enhance | Single `float` | `0.5f`，范围 0f … 1f | Boosts the strength and clarity of the ambient occlusion effect, making shadows and depth more pronounced in the terrain. |

### Cartography

`QuadSpinner.Gaea.Nodes.Cartography` · Family `Render` · Classification `Colorizer` · ShortCode `crt`

> Cartography creates a topographical overlay for a map.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Map Style** *(分组标题)* | — | — | `[Group]` 由 `Accuracy`, `GradientStyle`, `EqualizeGradient`, `Reverse` 声明 |
| Accuracy | Single `float` | `0.3f`，范围 0f … 1f | Controls the precision of map features such as contours and gradients. Higher values produce more detailed and accurate representations of terrain. |
| Gradient Style | Enum `MapGradientStyle` | `MapGradientStyle.Smooth`，范围 0f … 1f | `Smooth` — Applies a continuous, smooth gradient for a natural transition between elevation bands.<br>`LargeContours` — Emphasizes major elevation bands with broad, distinct contour regions.<br>`AllContours` — Displays all contour lines, including minor and major bands, for maximum detail. |
| Equalize Gradient | Boolean `bool` | `true`，范围 0f … 1f | Balances the gradient distribution to ensure even representation of elevation changes across the map. |
| Reverse | Boolean `bool` | `false`，范围 0f … 1f | Inverts the color or gradient mapping, swapping high and low elevation colors for a different visual effect. |
| Erode | Boolean `bool` | `false`，范围 0f … 1f | Applies an erosion effect to the map, softening features and simulating natural terrain wear. |
| **Land** *(分组标题)* | — | — | `[Group]` 由 `LandPalette`, `LandContours`, `LandContourIntenstity`, `LandBias` 声明 |
| Land Palette | Enum `CartographyLandPalette` | `CartographyLandPalette.Minimal`，范围 0f … 1f | `Classic` — Uses a traditional cartographic color scheme for land.<br>`Minimal` — Applies a minimalistic color palette for a clean, modern look.<br>`FertileRed` — Highlights fertile areas with red tones.<br>`FertileGreen` — Highlights fertile areas with green tones.<br>`RedBlueSpectrum` — Uses a spectrum from red to blue to represent elevation or land type.<br>`MineralsYellow` — Emphasizes mineral-rich areas with yellow hues.<br>`FertileCool` — Applies cool tones to fertile regions for a subdued effect.<br>`FertileMurky` — Uses murky, earthy tones to represent fertile land. |
| Land Contours | Int32 `int` | `5`，范围 3 … 50 | Controls the visibility and density of contour lines on land areas, highlighting elevation changes. |
| Land Contour Intenstity | Float2 `Float2` | `0.4f`，范围 0f … 1f | Adjusts the brightness or opacity of land contour lines, making them more or less prominent. |
| Land Bias | Single `float` | `0f`，范围 -1f … 1f | Applies a bias to the land color or contour mapping, shifting emphasis to certain elevation ranges or features. |
| Water Palette | Enum `CartographyWaterPalette` | `CartographyWaterPalette.Classic`，范围 0f … 1f | `Classic` — Uses a traditional blue color scheme for water.<br>`BlackSea` — Applies a dark, deep blue palette reminiscent of the Black Sea.<br>`Caribbean` — Uses bright, turquoise tones inspired by Caribbean waters. |
| Water Contours | Int32 `int` | `5`，范围 3 … 50 | Controls the visibility and density of contour lines in water areas, indicating depth or underwater features. |
| Water Contour Intenstity | Float2 `Float2` | `0.4f`，范围 0f … 1f | Adjusts the brightness or opacity of water contour lines, making them more or less prominent. |
| Water Bias | Single `float` | `0f`，范围 -1f … 1f | Applies a bias to the water color or contour mapping, shifting emphasis to certain depth ranges or features. |
| Trim | Single `float` | `0f`，范围 0f … 1f | Removes or crops map features outside a specified boundary, focusing the map on a particular region. |
| **Line Art** *(分组标题)* | — | — | `[Group]` 由 `GridCount`, `GridIntenstity`, `GridStyle`, `BoundaryThickness` 声明 |
| Grid Count | Int32 `int` | `20`，范围 4 … 100 | Sets the number of grid divisions overlaid on the map, controlling the density of the grid. |
| Grid Intenstity | Float2 `Float2` | `0.5f`，范围 0f … 1f | Adjusts the brightness or opacity of the grid lines, making them more or less visible. |
| Grid Style | Enum `MapGridStyle` | `MapGridStyle.OverWater`，范围 0f … 1f | `None` — No grid lines are displayed.<br>`OverWater` — Grid lines are drawn only over water areas.<br>`OverLand` — Grid lines are drawn only over land areas.<br>`Everywhere` — Grid lines are drawn over both land and water areas. |
| Boundary Thickness | Int32 `int` | `2`，范围 1 … 10 | Sets the thickness of boundary lines, such as map borders or region outlines. |
| Contour Thickness | Int32 `int` | `1`，范围 1 … 10 | Specifies the thickness of contour lines, affecting their visual prominence. |
| Grid Thickness | Int32 `int` | `1`，范围 1 … 10 | Controls the thickness of grid lines overlaid on the map. |

### Export

`QuadSpinner.Gaea.Nodes.Export` · Family `Assets` · Classification `Export` · ShortCode `ex`

> Exports terrain, masks, or textures to external files.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Format | Enum `FileFormats` | `FileFormats.EXR`，范围 0f … 1f | `GaeaRaw` — Exports the data in Gaea's native RAW format, preserving full precision and compatibility with Gaea.<br>`HalfRaw` — Exports the data as 16-bit half-precision RAW, balancing file size and detail.<br>`HalfRaw16` — Exports the data as 16-bit half-precision RAW with explicit 16-bit formatting.<br>`UshortRaw` — Exports the data as unsigned short (16-bit) RAW, suitable for many terrain and 3D applications.<br>`UshortRaw16` — Exports the data as unsigned short (16-bit) RAW with explicit 16-bit formatting.<br>`FloatRaw` — Exports the data as 32-bit floating point RAW, providing maximum precision for advanced workflows.<br>`FloatRaw32` — Exports the data as 32-bit floating point RAW with explicit 32-bit formatting.<br>`JPEG` — Exports the data as a JPEG image, using lossy compression for reduced file size and broad compatibility.<br>`PNG8` — Exports the data as an 8-bit PNG image, suitable for masks and lightweight outputs.<br>`PNG16` — Exports the data as a 16-bit PNG image, preserving more detail for heightfields and masks.<br>`PNG64` — Exports the data as a 64-bit PNG image, supporting high dynamic range and advanced workflows.<br>`TIFF8` — Exports the data as an 8-bit TIFF image, commonly used for masks and simple outputs.<br>`TIFF16` — Exports the data as a 16-bit TIFF image, suitable for high-quality heightfields and masks.<br>`TIFF32` — Exports the data as a 32-bit TIFF image, supporting high dynamic range and scientific workflows.<br>`EXR` — Exports the data as an OpenEXR image, ideal for high dynamic range and professional VFX pipelines. |
| Location | Enum `SaveLocation` | (HorizontalList，默认值在混淆常量表中) | `BuildFolder` — Exports the file to the project's build/output folder.<br>`Custom` — Allows you to specify a custom folder for the exported file.<br>`Explicit` — Exports the file to an explicitly defined path, overriding other location settings. |
| Output Path | String `string` | (Folder，默认值在混淆常量表中) | Defines the full file path or directory where the exported file will be saved. |
| If File Exists | Enum `OverwriteMode` | `OverwriteMode.Overwrite`，范围 0f … 1f | `Overwrite` — Replaces the existing file with the new export.<br>`Increment` — Automatically increments the filename to avoid overwriting existing files. |
| Information | Byte `byte` | — | Displays additional information or metadata about the export process or output file. |
| Prepare for Bridge | Command `bool` | `"transfer-out"` | Prepares the exported file for use with the Bridge system, enabling compatibility with external tools or workflows.<br>*C# 属性 `HoudiniOut`* |
| Information Houdini | Byte `byte` | — | Displays or stores metadata related to Houdini integration, such as file attributes or export status. |

### Halftone

`QuadSpinner.Gaea.Nodes.Halftone` · Family `Render` · Classification `Mask`

> Converts the terrain or mask into a halftone-style rendered output.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Pattern | Enum `HalftonePattern` | `HalftonePattern.FloydSteinberg`，范围 0f … 1f | `FloydSteinberg` — Applies Floyd-Steinberg error diffusion dithering, producing a classic, high-quality halftone effect with smooth gradients.<br>`Riemersma` — Uses Riemersma dithering, which distributes error along a space-filling curve for a unique, less directional halftone appearance.<br>`O2X2` — Uses a 2x2 ordered dithering matrix to create a small, repeating halftone pattern.<br>`O3X3` — Uses a 3x3 ordered dithering matrix for a slightly larger, repeating halftone pattern.<br>`O4X4` — Uses a 4x4 ordered dithering matrix, producing a more detailed and less repetitive halftone effect.<br>`O8X8` — Applies an 8x8 ordered dithering matrix for fine, detailed halftone shading with minimal visible repetition.<br>`H6X6A` — Uses a 6x6 halftone matrix (variant A) for a larger, more complex dot pattern.<br>`H8X8A` — Applies an 8x8 halftone matrix (variant A), generating a dense and detailed halftone texture.<br>`H6X6O` — Applies a 6x6 halftone matrix (variant O), producing a unique halftone pattern with distinct dot placement.<br>`H8X8O` — Uses an 8x8 halftone matrix (variant O), providing a dense and alternative halftone style.<br>`C5X5B` — Uses a 5x5 circular halftone matrix with black dots, simulating traditional print halftone screens.<br>`C5X5W` — Uses a 5x5 circular halftone matrix with white dots, inverting the typical halftone dot style.<br>`C6X6B` — Applies a 6x6 circular halftone matrix with black dots for a slightly larger dot pattern.<br>`C6X6W` — Uses a 6x6 circular halftone matrix with white dots, providing an inverted halftone effect.<br>`C7X7B` — Applies a 7x7 circular halftone matrix with black dots, creating a larger, more pronounced dot pattern.<br>`C7X7W` — Uses a 7x7 circular halftone matrix with white dots, offering a bold, inverted halftone style.<br>`DIAG` — <desc><br>`HLINE` — <desc> |
| Posterize | Boolean `bool` | `false`，范围 0f … 1f |  |
| Depth | Int32 `int` | `5`，范围 2 … 64 |  |

### LightX

`QuadSpinner.Gaea.Nodes.LightX` · Family `Render` · Classification `Colorizer` · ShortCode `lx`

> Creates a fully lit render using controllable sun, shadow, and ambient lighting.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 4 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Direction Selection | Enum `LightingDirectionType` | `LightingDirectionType.Manual`，范围 0f … 1f | `Manual` — Allows manual input of sun direction parameters such as azimuth and elevation.<br>`Geographic` — Calculates sun direction based on geographic coordinates, date, and time for physically accurate lighting. |
| North | Single `float` | `0f`，范围 0f … 360f | Sets the orientation of the north direction in the scene, affecting geographic sun calculations. |
| Latitude | Int32 `int` | `60`，范围 -90 … 90 | Specifies the latitude for geographic sun calculations, influencing sun position and lighting angle. |
| Day of Year | Int32 `int` | `1`，范围 1 … 365 | Sets the day of the year for geographic sun calculations, affecting seasonal sun position and lighting. |
| Solar Hour | Single `float` | `10f`，范围 0f … 24f | Specifies the time of day for geographic sun calculations, determining the sun's position in the sky. |
| Sun Azimuth | Single `float` | `0f`，范围 0f … 360f | Sets the horizontal angle of the sun, determining the direction from which sunlight is cast. |
| Sun Elevation | Single `float` | `30f`，范围 0f … 90f | Controls the vertical angle of the sun above the horizon, affecting the length and intensity of shadows. |
| Angular Diameter | Single `float` | `0.5`，范围 0f … 20f | Specifies the apparent size of the sun in the sky, influencing the softness of shadows and highlights. |
| Direct Light | Boolean `bool` | `true`，范围 0f … 1f | Adjusts the intensity of direct sunlight in the scene, affecting brightness and shadow contrast. |
| Shadows | Boolean `bool` | `true`，范围 0f … 1f | Enables or adjusts the rendering of shadows cast by terrain features, enhancing depth and realism. |
| Ambient Light | Boolean `bool` | `true`，范围 0f … 1f | Controls the overall ambient light level, simulating indirect illumination from the sky and environment. |
| Ambient Occlusion | Boolean `bool` | `true`，范围 0f … 1f | Enables or adjusts ambient occlusion, which darkens crevices and areas shielded from ambient light for added realism. |
| Quality | Enum `AOQuality` | (HorizontalList，默认值在混淆常量表中) | `Low` — Fastest rendering with basic lighting and shadow detail.<br>`Medium` — Balanced quality and performance with moderate lighting and shadow detail.<br>`High` — High-quality rendering with detailed lighting and shadows.<br>`Ultra` — Maximum quality with the most accurate lighting and shadow effects. |
| **Light** *(分组标题)* | — | — | `[Group]` 由 `Exposure`, `SunIntensity`, `AmbientIntensity`, `AirDensity` 声明 |
| Exposure | Single `float` | `1f`，范围 0f … 4f | Adjusts the exposure level, controlling the overall brightness and dynamic range of the rendered image. |
| Sun Intensity | Single `float` | `1f`，范围 0f … 2f | Sets the strength of the sun's light, affecting the brightness of direct illumination. |
| Ambient Intensity | Single `float` | `1f`，范围 0f … 2f | Controls the strength of ambient light, influencing the brightness of areas not directly lit by the sun. |
| Air Density | Single `float` | `1f`，范围 0f … 2f | Simulates atmospheric density, affecting the scattering of light and the appearance of haze. |
| Haze | Single `float` | `1f`，范围 0f … 2f | Adds atmospheric haze to the scene, softening distant terrain and simulating light diffusion. |
| Ozone | Single `float` | `1f`，范围 0f … 2f | Adjusts the ozone level in the atmosphere, influencing the color and intensity of sunlight. |
| **Colors** *(分组标题)* | — | — | `[Group]` 由 `AutomaticColors`, `SunColor`, `AmbientColor`, `GroundBrightness` 声明 |
| Automatic Colors | Boolean `bool` | `true`，范围 0f … 1f | Enables automatic adjustment of sun and ambient colors based on sun position and atmospheric conditions. |
| Sun Color | Color `Color` | — | Sets the color of direct sunlight, allowing for warm, cool, or custom lighting effects. |
| Ambient Color | Color `Color` | — | Specifies the color of ambient light, affecting the overall tone of shaded areas. |
| Ground Brightness | Single `float` | `0.65f`，范围 0f … 1f | Controls the brightness of the ground plane, influencing the overall illumination and visual balance of the scene. |

### Mesher

`QuadSpinner.Gaea.Nodes.Mesher` · Family `Assets` · Classification `Export` · ShortCode `me`

> Mesher can save specific nodes as meshes instead of heightfields, and can also generate LODs.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Format | Enum `MesherFormats` | `MesherFormats.OBJ`，范围 0f … 1f | `OBJ` — Exports the mesh in the standard OBJ format, widely supported for 3D models and compatible with most 3D software.<br>`FBX` — Exports the mesh in the FBX format, suitable for advanced workflows and supporting animation, hierarchy, and metadata.<br>`DAE` — Exports the mesh in the Collada (DAE) format, an open standard for exchanging 3D assets between applications.<br>`GLTF` — Exports the mesh in the glTF format, optimized for real-time rendering and web-based 3D applications.<br>`GLB` — Exports the mesh in the binary GLB format, a compact version of glTF for efficient storage and transmission. |
| Scale | Enum `MeshScale` | `MeshScale.Normalized`，范围 0f … 1f | `Normalized` — Exports the mesh with coordinates normalized to a 0–1 range, useful for workflows that require unitless or relative positions.<br>`Meter` — Exports the mesh with coordinates in meters, matching real-world scale for compatibility with engineering and GIS applications.<br>`Kilometer` — Exports the mesh with coordinates in kilometers, suitable for large-scale terrain or geospatial datasets. |
| Topology | Enum `Topology` | `Topology.AdaptiveTris`，范围 0f … 1f | `Tris` — Generates the mesh using triangles for all faces, ensuring compatibility with all 3D engines and applications.<br>`Quads` — Generates the mesh using quadrilaterals where possible, preferred for modeling and sculpting workflows.<br>`AdaptiveTris` — Uses adaptive triangulation to optimize mesh density, reducing polygon count in flat areas and increasing detail where needed. |
| Topology Warning | String `string` | (ComputedString，默认值在混淆常量表中) |  |
| Vertices Per Side | Int32 `int` | `2048`，范围 64 … 16384 | Sets the resolution of the mesh by specifying the number of vertices along each side. Higher values increase detail but also file size. |
| Artifact Reduction | Enum `Generic3` | `Generic3.None`，范围 0f … 1f | `None` — No artifact reduction is applied; the mesh is exported as generated.<br>`Low` — Applies minimal artifact reduction, preserving most original detail while correcting minor issues.<br>`Med` — Applies moderate artifact reduction, balancing detail preservation with improved mesh quality. |
| Create Normals | Boolean `bool` | `false`，范围 0f … 1f | If enabled, generates normal vectors for the mesh, improving shading and rendering quality in 3D applications. |
| Create UVs | Boolean `bool` | `false`，范围 0f … 1f | If enabled, generates UV coordinates for the mesh, allowing textures to be mapped accurately onto the surface.<br>*C# 属性 `CreateUVs`* |
| UV Origin | Enum `UVOrigin` | `UVOrigin.BottomLeft`，范围 0f … 1f | `TopLeft` — Sets the UV origin to the top-left corner, matching conventions used in some graphics applications.<br>`BottomLeft` — Sets the UV origin to the bottom-left corner, standard in most 3D engines and texture workflows. |
| Create Walls | Boolean `bool` | `false`，范围 0f … 1f | Creates vertical walls along the edges of the mesh, useful for generating closed or extruded terrain models. |
| Center Pivot | Boolean `bool` | `true`，范围 0f … 1f | If enabled, centers the mesh's pivot point at the origin, making it easier to manipulate in 3D applications. |
| Level of Detail | Enum `LOD` | `LOD.None`，范围 0f … 1f | `None` — Exports the mesh at full resolution with no LOD applied.<br>`LOD1` — Exports a simplified mesh with reduced detail, suitable for distant rendering or performance-sensitive applications.<br>`LOD2` — Exports a further simplified mesh with even fewer polygons.<br>`LOD3` — Exports a mesh with progressively lower detail, useful for very distant or background objects.<br>`LOD4` — Exports a highly simplified mesh, minimizing polygon count for maximum performance.<br>`LOD5` — Exports an extremely low-detail mesh, suitable for extreme distance or preview purposes.<br>`LOD6` — Exports the lowest possible detail mesh, retaining only the broadest features. |
| LOD Info | String `string` | (ComputedString，默认值在混淆常量表中) |  |
| Information | Byte `byte` | — |  |

### PointCloud

`QuadSpinner.Gaea.Nodes.PointCloud` · Family `Assets` · Classification `Export` · ShortCode `pc`

> Exports the terrain as a point cloud in formats such as PLY, XYZ, or CSV.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Format | Enum `PointCloudFormats` | `PointCloudFormats.PLY`，范围 0f … 1f | `PLY` — Exports the point cloud in the standard ASCII PLY (Polygon File Format) format, widely supported for 3D data exchange.<br>`PLY_BINARY` — Exports the point cloud in binary PLY format, offering smaller file sizes and faster read/write performance compared to ASCII.<br>`XYZ` — Exports the point cloud as a simple XYZ text file, with each line representing a point's X, Y, and Z coordinates.<br>`CSV` — Exports the point cloud as a CSV (Comma-Separated Values) file, suitable for use in spreadsheets or data analysis tools. |
| Scale | Enum `MeshScale` | `MeshScale.Normalized`，范围 0f … 1f | `Normalized` — Exports coordinates normalized to a 0–1 range, useful for workflows that require unitless or relative positions.<br>`Meter` — Exports coordinates in meters, matching real-world scale for compatibility with GIS and engineering applications.<br>`Kilometer` — Exports coordinates in kilometers, suitable for large-scale terrain or geospatial datasets. |
| Center Pivot | Boolean `bool` | `true`，范围 0f … 1f | If enabled, centers the point cloud around the origin by offsetting all points so that the dataset's centroid is at (0,0,0). Useful for easier manipulation in 3D applications. |
| Ignore Zero Values | Boolean `bool` | `true`，范围 0f … 1f | When enabled, points with zero or null values are excluded from the export. This helps remove empty data such as the normal low floor of the terrain from the output file. |

### Shade

`QuadSpinner.Gaea.Nodes.Shade` · Family `Render` · Classification `Colorizer`

> Produces a shaded terrain render based on lighting direction and surface relief.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Render Style | Enum `ShadeStyle` | `ShadeStyle.TableTop`，范围 0f … 1f | `TableTop` — Renders the terrain for a stylized overview.<br>`HillShade` — Applies traditional hillshading to simulate sunlight and shadow, enhancing the perception of terrain relief and surface features.<br>`Occlusion` — Highlights areas of the terrain that are occluded or in shadow, useful for analyzing light accessibility and terrain exposure.<br>`SoftLight` — Uses a soft, diffuse lighting model to gently illuminate the terrain, reducing harsh shadows and creating a more natural look. |
| Sun Azimuth | Single `float` | `0f`，范围 0f … 360f | Sets the horizontal angle of the sun in degrees, determining the direction from which sunlight is cast across the terrain. |
| Sun Elevation | Single `float` | `30f`，范围 0f … 90f | Controls the vertical angle of the sun above the horizon, affecting the length and intensity of shadows on the terrain. |
| Sunlight | Single `float` | `1f`，范围 0f … 4f | Adjusts the overall intensity or brightness of direct sunlight in the shading calculation. |
| Shade Bias | Single `float` | `0f`，范围 -1f … 1f | Offsets the shading calculation to reduce or increase shadow strength, helping to fine-tune the balance between light and dark areas. |
| Soft Shadows | Single `float` | `0.5f`，范围 0f … 1f | Enables or adjusts the softness of shadows, creating more gradual transitions between light and shadow for a realistic effect. |
| Reflected Light | Boolean `bool` | `true`，范围 0f … 1f | Simulates indirect illumination by adding light reflected from surrounding terrain, enhancing realism and reducing overly dark shadowed areas. |
| High Quality | Boolean `bool` | `false`，范围 0f … 1f | Enables high-quality rendering for shading, using more advanced calculations for smoother gradients and more accurate lighting effects. |

### Sunlight

`QuadSpinner.Gaea.Nodes.Sunlight` · Family `Render` · Classification `Mask` · ShortCode `si`

> Sunlight is a Data Map that gives you the sunlight integral (sun light/shadow map) of any given period (up to 365 days). It can be used to drive snow melt, vegetation growth, and more.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| North | Single `float` | `0f`，范围 0f … 360f | Specifies the direction considered as 'north' for sunlight calculations. Adjusting this affects the orientation of shadows and lighting in the terrain. |
| Year | Float2 `Float2` | `0.2f`，范围 0.0001f … 1f | Sets the year for solar position calculations. This can influence the sun's path and seasonal lighting effects on the terrain. |
| Latitude | Int32 `int` | `60`，范围 -90 … 90 | Defines the latitude of the terrain location. Changing the latitude alters the angle and intensity of sunlight, simulating different geographic regions. |

### TextureBaker

`QuadSpinner.Gaea.Nodes.TextureBaker` · Family `Utilities` · Classification `Processor` · ShortCode `txb`

> Bakes derived texture maps from the terrain for export and downstream use.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口；可变输入，最多 20。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Generate Normals | Boolean `bool` | `true`，范围 0f … 1f | Enables the generation of tangent-space normal maps for the mesh. When checked, MeshWarp will output normal maps that align with the mesh geometry at each LOD, suitable for advanced shading and detail. |
| Information | Byte `byte` | — |  |
| Add Input | Command `bool` | `"port-connect"` | Adds an additional input port to connect masks, color maps, or other data layers. Each input will be processed and fitted to the mesh at all LODs.<br>*C# 属性 `AddInput`* |
| LOD Info | String `string` | (ComputedString，默认值在混淆常量表中) | Shows Level of Detail (LOD) information for the mesh and all connected maps. Each input map will have an LOD generated to match the mesh's LODs as set in the Mesher node. |

### Unity

`QuadSpinner.Gaea.Nodes.Unity` · Family `Assets` · Classification `Export` · ShortCode `un`

> Exports terrain data in Unity-friendly resolutions and formats.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口；可变输入，最多 20。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Target Size | Enum `UnitySizes` | `UnitySizes.x2049`，范围 0f … 1f | `x8193` — Exports at 8193 x 8193 pixels, suitable for very large Unity terrains requiring maximum detail.<br>`x4097` — Exports at 4097 x 4097 pixels, commonly used for large terrain tiles in Unity.<br>`x2049` — Exports at 2049 x 2049 pixels, ideal for medium-sized Unity terrain tiles.<br>`x1025` — Exports at 1025 x 1025 pixels, suitable for smaller terrain tiles or test scenes in Unity.<br>`x513` — Exports at 513 x 513 pixels, used for small terrain tiles or prototyping in Unity. |
| Add Input | Command `bool` | `"port-connect"` | Adds an additional input map layer for export, allowing for more complex terrain data to be sent to Unity.<br>*C# 属性 `AddInput`* |

### Unreal

`QuadSpinner.Gaea.Nodes.Unreal` · Family `Assets` · Classification `Export` · ShortCode `ue`

> Exports terrain data in Unreal-friendly resolutions, formats, and naming conventions.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口；可变输入，最多 20。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Automatic Size | Boolean `bool` | `true`，范围 0f … 1f | Automatically determines the optimal export resolution for Unreal Engine based on the input terrain and project settings. |
| Target Size | Enum `UnrealSizes` | `UnrealSizes.x2017`，范围 0f … 1f | `x8129` — Exports at 8129 x 8129 pixels, suitable for very large landscapes in Unreal Engine.<br>`x4033` — Exports at 4033 x 4033 pixels, commonly used for large terrain tiles.<br>`x2017` — Exports at 2017 x 2017 pixels, ideal for medium-sized terrain tiles.<br>`x1009` — Exports at 1009 x 1009 pixels, suitable for smaller terrain tiles or test scenes.<br>`x505` — Exports at 505 x 505 pixels, used for small terrain tiles or prototyping.<br>`x253` — <desc><br>`x127` — <desc> |
| Dont Resize Textures | Boolean `bool` | `true`，范围 0f … 1f | Prevents automatic resizing of textures during export, preserving the original resolution of input textures. |
| LOD Info | String `string` | (ComputedString，默认值在混淆常量表中) | Provides Level of Detail (LOD) information for exported terrain, enabling optimized rendering and streaming in Unreal Engine. |
| Format | Enum `UnrealFormat` | (HorizontalList，默认值在混淆常量表中) | `PNG` — Exports terrain data as PNG images, suitable for color maps and masks.<br>`R16` — Exports terrain data as 16-bit RAW files, recommended for heightmaps to preserve elevation detail.<br>`RAW` — Exports terrain data as RAW files, compatible with Unreal Engine for heightmaps and other data. |
| **Naming** *(分组标题)* | — | — | `[Group]` 由 `UnrealFriendlyNaming`, `Map1`, `Map2`, `Map3` 声明 |
| Unreal Friendly Naming | Boolean `bool` | `true`，范围 0f … 1f | Applies Unreal Engine-compatible naming conventions to exported files for easier import and organization. |
| Map 1 | Enum `UEMapType` | `UEMapType.Height`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Map 2 | Enum `UEMapType` | `UEMapType.Color`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Map 3 | Enum `UEMapType` | `UEMapType.Color`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Map 4 | Enum `UEMapType` | `UEMapType.Color`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Map 5 | Enum `UEMapType` | `UEMapType.Mask`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Map 6 | Enum `UEMapType` | `UEMapType.Mask`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Map 7 | Enum `UEMapType` | `UEMapType.Mask`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Map 8 | Enum `UEMapType` | `UEMapType.Mask`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Map 9 | Enum `UEMapType` | `UEMapType.Mask`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Map 10 | Enum `UEMapType` | `UEMapType.Mask`，范围 0f … 1f | `Height` — <desc><br>`Mask` — <desc><br>`Color` — <desc><br>`Weight` — <desc> |
| Add Input | Command `bool` | `"port-connect"` | Adds an additional input map layer for export, allowing for more complex terrain data to be sent to Unreal Engine.<br>*C# 属性 `AddInput`* |
| **Information** *(分组标题)* | — | — | `[Group]` 由 `Information2`, `Information1` 声明 |
| Information 2 | Byte `byte` | — | Additional metadata or notes related to the Unreal Engine export process. |
| Information 1 | Byte `byte` | — | General information or notes about the Unreal Engine export settings. |

## Utility

*流程与数据工具：合并、遮罩、循环、路由、宏* — `NodeCategory.Utility`，共 20 个节点。

### Accumulator

`QuadSpinner.Gaea.Nodes.Accumulator` · Family `Utilities` · Classification `Generator` · ShortCode `cc` · Keywords `accumulator`

> Accumulates specific map types such as Water, Forest, or Snow from all available nodes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Type | Enum `AccumulatorType` | `AccumulatorType.SnowMask`，范围 0f … 1f | `SnowMask` — Accumulate all snow as a flat mask.<br>`SnowDepth` — Accumulate all Snow Depth at absolute values.<br>`Rivers` — Accumulate all rivers.<br>`WaterMask` — Accumulate all water as a flat mask.<br>`WaterDepth` — Accumulate all Water Depth in absolute values.<br>`ShoreMask` — Accumulate all Shore masks.<br>`DebrisMask` — Accumulate all DebrisMask (using Max mode)<br>`DebrisColor` — Accumulate just the DebrisColor (using Max mode).<br>`Trees` — Accumulate all trees generated by Trees and Shrubs nodes.<br>`TreeDeadZones` — Accumulate all dead zones in Trees nodes.<br>`TreeFreshwater` — Accumulate all fresh water flows from Tree nodes. |
| Restrict to Group | Boolean `bool` | `false`，范围 0f … 1f | Restricts accumulating from other nodes that are in the same Group as the Accumulator node. |
| Warning | String `string` | (ComputedString，默认值在混淆常量表中) |  |

### Chokepoint

`QuadSpinner.Gaea.Nodes.Chokepoint` · Family `Routing` · Classification `Processor` · ShortCode `cp`

> Chokepoint node is a special node whose sole purpose is to help avoid re-connecting many nodes, while adding no memory overhead.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| *(无参数)* | — | — | `Nodes.json` 中该节点的 `Flubs` 为空数组；程序集侧也没有带 `[Parameter]` 的属性。实际行为由实现类内部固定。 |

### Combine

`QuadSpinner.Gaea.Nodes.Combine` · Family `Routing` · Classification `Processor` · ShortCode `c` · Keywords `combine`

> Combine is one of Gaea's most important nodes. You can combine two terrains (or any node output) using various mathematical operations often known as Blend Modes.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 3 个端口；可变输入，最多 10。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Ratio | Single `float` | `0.5`，范围 0f … 1f | The ratio applied to the selected method. |
| Mode | Enum `BlendMode` | `BlendMode.Blend`，范围 0f … 1f | `Blend` — Simply overlays the source on top of the base without extra math. Direct normal blend; top layer replaces base with alpha control.<br>`Add` — Brightens by adding the source to the base. Linear addition of source and base channels, clamped at max.<br>`Screen` — Lightens by blending as if projected on a screen. Inverts both, multiplies, then inverts; 1 - (1 - A) × (1 - B).<br>`Subtract` — Darkens by subtracting the source from the base. Base minus source per channel, clamps at zero.<br>`Difference` — Emphasizes contrast by subtracting lower from higher values. Absolute difference \|A - B\| for high-contrast edge-like results.<br>`Multiply` — Darkens by multiplying source and base colors. Channel-wise multiplication; A × B, darkens with stacking.<br>`Divide` — Lightens by dividing base by source. Base divided by source; A / B with normalization/scaling.<br>`Divide2` — Alternative division with different scaling for smoother results. Alternate divide with different scaling/offset to reduce clipping.<br>`Max` — Keeps the brighter value at each pixel. Channel-wise maximum; keeps highest of A and B.<br>`Min` — Keeps the darker value at each pixel. Channel-wise minimum; keeps lowest of A and B.<br>`Hypotenuse` — Combines channels using geometric distance for soft blending. sqrt(A² + B²); Euclidean combination for smooth, bright blend.<br>`Overlay` — Combines multiply and screen for vivid contrast. Combines Multiply and Screen based on base brightness.<br>`Power` — Raises base to the power of source for nonlinear effects. Raises base to source power; A ^ B per channel.<br>`Exclusion` — Low-contrast version of Difference for softer inversion. A + B - 2AB; softer Difference with reduced contrast.<br>`Dodge` — Brightens highlights by dividing inverted base by inverted source. A / (1 - B); brightens highlights aggressively.<br>`Burn` — Darkens shadows by inverting, dividing, and inverting again. 1 - (1 - A) / B; intensifies shadows via division.<br>`SoftLight` — Gently lightens or darkens based on source brightness. Conditional blend approximating diffused light on surface.<br>`HardLight` — Strong contrast blend combining multiply and screen. Screen or Multiply based on source brightness threshold.<br>`PinLight` — Replaces pixels selectively with lighter or darker values. Replaces mid-range with source; keeps extremes from base.<br>`GrainMerge` — Adds source to base with mid-gray treated as transparent. A + B - 0.5; mid-gray = no change; good for texture merge.<br>`GrainExtract` — Subtracts source from base, centering results on mid-gray. A - B + 0.5; isolates texture/detail difference.<br>`Reflect` — Creates intense highlights by reflecting colors around white. A² / (1 - B); creates sharp highlight 'reflection' effects.<br>`Glow` — Emphasizes bright regions for a glowing effect. Inverse Dodge-like; emphasizes light bloom by brightening source areas.<br>`Phoenix` — Produces a fiery inversion by subtracting and swapping values. A - B + max(A, B); surreal color inversions with swap-like logic. |
| Output | Enum `ClampType` | `ClampType.Clamp`，范围 0f … 1f | `None` — Retain pure, unclamped data. Less safer, but useful in advanced usage.<br>`Clamp` — Clamp the data to 0..1 range. Slightly slower, but recommended for safety.<br>`Extend` — Extend to fill the range.<br>*C# 属性 `Clamp`* |
| Swap Inputs | Command `bool` | `"replace"` | Switches the two inputs.<br>*C# 属性 `SwitchInputs`* |
| Add Input | Command `bool` | `"port-connect"` | *C# 属性 `AddInput`* |
| Enhance | Enum `ProcessInput` | `ProcessInput.None`，范围 0f … 1f | `None` — No post-processing. Recommended.<br>`Autolevel` — Autolevel the output.<br>`Equalize` — Equalize the output. |

### Compare

`QuadSpinner.Gaea.Nodes.Compare` · Family `Routing` · Classification `Processor` · ShortCode `cm` · Keywords `ab compare comparison`

> Compares two inputs and produces a result based on their relative values.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| A/B | Single `float` | `0.5f`，范围 0f … 1f | Ratio of the terrain to compare.<br>*C# 属性 `Comparison`* |
| Colorized | Boolean `bool` | `true`，范围 0f … 1f | Show colorized output to signify the modified terrain. |
| Perpendicular | Boolean `bool` | `false`，范围 0f … 1f | Switch from Horizontal/Stacked to Perpendicular comparison. |
| Swap | Boolean `bool` | `false`，范围 0f … 1f | Swap A and B inputs. |

### DataExtractor

`QuadSpinner.Gaea.Nodes.DataExtractor` · Family `Utilities` · Classification `Mask` · ShortCode `de`

> Extracts specific derived data such as boundaries, differences, or Modifier maps from an input.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Data | Enum `DataExtraction` | `DataExtraction.ModifierMask`，范围 0f … 1f | `ModifierMask` — <desc><br>`Difference` — <desc><br>`Boundary` — <desc><br>`MixerMask` — <desc> |
| Layer | Int32 `int` | `1`，范围 1 … 6 |  |
| Level | Single `float` | `0.03f`，范围 0f … 1f |  |

### Edge

`QuadSpinner.Gaea.Nodes.Edge` · Family `Structure` · Classification `Processor` · ShortCode `ed` · Keywords `vignette edge wall zb zeroborders`

> Zero Borders softly transitions the edges of a terrain into nothing, similar to a vignette effect in paint applications. Useful when using Bomber or other effects where a tall edge would be problematic.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Style | Enum `EdgeStyle` | `EdgeStyle.Square`，范围 0f … 1f | `Round` — Creates a smooth, rounded edge transition for a softer boundary.<br>`Square` — Produces a straight, angular edge for a more defined and abrupt boundary.<br>`Precise` — Applies an exact edge in pixels, preserving sharpness and detail at the boundary. |
| Size | Single `float` | `1f`，范围 0f … 1f | Controls the width or thickness of the edge effect. Higher values create a broader edge region. |
| Pixels | Int32 `int` | `2`，范围 1 … 500 | Sets the edge width in pixel units, allowing for precise control over the edge's extent. |
| Softness | Single `float` | `0.25f`，范围 0f … 1f | Adjusts the smoothness of the edge transition. Higher values result in a more gradual, blended edge. |

### Gate

`QuadSpinner.Gaea.Nodes.Gate` · Family `Routing` · Classification `Processor` · ShortCode `g8`

> Defines a baking boundary for the graph by forcing all ancestor nodes to be baked.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| *(无参数)* | — | — | `Nodes.json` 中该节点的 `Flubs` 为空数组；程序集侧也没有带 `[Parameter]` 的属性。实际行为由实现类内部固定。 |

### Layers

`QuadSpinner.Gaea.Nodes.Layers` · Family `Routing` · Classification `Processor`

> Combines multiple layers using blend operations in a stacked workflow.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 4 个端口；可变输入，最多 15。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Blend Layer 1 | Single `float` | `1f`，范围 0f … 1f | *C# 属性 `Blend2`* |
| Blend Layer 2 | Single `float` | `1f`，范围 0f … 1f | *C# 属性 `Blend3`* |
| Blend Layer 3 | Single `float` | `1f`，范围 0f … 1f | *C# 属性 `Blend4`* |
| Blend Layer 4 | Single `float` | `1f`，范围 0f … 1f | *C# 属性 `Blend5`* |
| Blend Layer 5 | Single `float` | `1f`，范围 0f … 1f | *C# 属性 `Blend6`* |
| Blend Layer 6 | Single `float` | `1f`，范围 0f … 1f | *C# 属性 `Blend7`* |
| Blend Layer 7 | Single `float` | `1f`，范围 0f … 1f | *C# 属性 `Blend8`* |

### LoopBegin

`QuadSpinner.Gaea.Nodes.LoopBegin` · Family `Routing` · Classification `Processor` · ShortCode `lb`

> Begins a Loop circuit.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Information 1 | Byte `byte` | — |  |

### LoopEnd

`QuadSpinner.Gaea.Nodes.LoopEnd` · Family `Routing` · Classification `Processor` · ShortCode `le`

> Ends a Loop circuit.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| **Primed** *(分组标题)* | — | — | `[Group]` 由 `Primed`, `PrimedBuild`, `Information` 声明 |
| Design Time | Boolean `bool` | `false`，范围 0f … 1f | *C# 属性 `Primed`* |
| Build Time | Boolean `bool` | `true`，范围 0f … 1f | *C# 属性 `PrimedBuild`* |
| Information | Byte `byte` | — |  |
| **Loop** *(分组标题)* | — | — | `[Group]` 由 `Loops`, `MutateSeeds`, `Seed`, `LoopInProgress` 声明 |
| Loops | Int32 `int` | `2`，范围 2 … 50 | Number of loops to perform |
| Mutate Seeds | Boolean `bool` | `true`，范围 0f … 1f | When enabled, the seeds of all nodes within the loop are mutated. |
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) | The seed for mutation if enabled above. |

### MacroPort

`QuadSpinner.Gaea.Nodes.MacroPort` · Family `Routing` · Classification `Complex`

> Defines an input or output port inside a macro for passing height, mask, or color data.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Direction | Enum `TransferDirection` | `TransferDirection.Input`，范围 0f … 1f | `Input` — Designates the port as an input, allowing data to be received by the macro node.<br>`Output` — Designates the port as an output, allowing data to be sent from the macro node. |
| Display | Enum `DisplayIntent` | `DisplayIntent.Heightfield`，范围 0f … 1f | `Heightfield` — Represents terrain elevation data, typically used for heightmaps.<br>`Mask` — Represents mask data, used for isolating or selecting specific regions in the terrain.<br>`Color` — Represents color data, used for visual effects or texture information. |
| Is Optional | Boolean `bool` | `false`，范围 0f … 1f |  |
| Fallback | Enum `FallbackMap` | `FallbackMap.Null`，范围 0f … 1f | `Null` — Return a null value. May cause node to be disrupted, but needed for Switch and other mechanisms.<br>`Black` — A black (0) value map.<br>`White` — A white (1) value map.<br>`Grey` — A grey (0.5) value map. |

### Mask

`QuadSpinner.Gaea.Nodes.Mask` · Family `Utilities` · Classification `Processor` · ShortCode `ma`

> Mask draws a mask. If the Input port is connected to another node, a 2D representation of that terrain is shown in the background as a guide. This is optional, as the Input port only provides a drawing guide and does not affect the actual mask.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| *(无参数)* | — | — | `Nodes.json` 中该节点的 `Flubs` 为空数组；程序集侧也没有带 `[Parameter]` 的属性。实际行为由实现类内部固定。 |

### MathX

`QuadSpinner.Gaea.Nodes.MathX` · Family `Utilities` · Classification `Generator` · ShortCode `mth`

> Evaluates mathematical expressions to generate or modify terrain data procedurally.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Expression | String `string` | (TextBox，默认值在混淆常量表中) | Math expression or program to execute. |
| Open Editor | Command `bool` | `"terminal-2"` | Opens the Math Editor dialog.<br>*C# 属性 `OpenEditor`* |
| Normalized Coordinates | Boolean `bool` | `false`，范围 0f … 1f | Normalizes all coordinate inputs. |

### Mixer

`QuadSpinner.Gaea.Nodes.Mixer` · Family `Routing` · Classification `Colorizer` · ShortCode `mx`

> Mixer allows layer-based manipulation of color textures and contains in-built masking.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 6 个端口；可变输入，最多 33。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Blend Layers | String `string` | (Custom，默认值在混淆常量表中) |  |
| Add Input | Command `bool` | `"port-connect"` | *C# 属性 `AddInput`* |
| Show Simplified | Boolean `bool` | `false`，范围 0f … 1f |  |
| Preserve Masks | Boolean `bool` | `false`，范围 0f … 1f |  |

### Repeat

`QuadSpinner.Gaea.Nodes.Repeat` · Family `Structure` · Classification `Processor` · ShortCode `rp` · Keywords `repeat`

> Repeat takes a shape and repeats it in a tiled pattern. It is often combined with the Seamless node.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Tiles | Int32 `int` | `2`，范围 2 … 50 | The number of repetitions on either axis. Controls how many times the input is tiled horizontally and vertically across the terrain. |
| Compensate Height | Boolean `bool` | `true`，范围 0f … 1f | Adjusts the height of each tile to prevent elevation buildup at tile seams, ensuring a smoother and more seamless repeat pattern. |
| Height | Single `float` | `1f`，范围 0.1f … 10f | Sets the maximum elevation for the repeated tiles, allowing you to control the overall height of the tiled output. |

### Reseed

`QuadSpinner.Gaea.Nodes.Reseed` · Family `Routing` · Classification `Processor`

> Re-randomizes an upstream procedural node by overriding or refreshing its seed behavior.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Seed | Int32 `int` | (Seed，默认值在混淆常量表中) |  |

### Route

`QuadSpinner.Gaea.Nodes.Route` · Family `Routing` · Classification `Processor` · ShortCode `ro`

> Route chooses the flow of the graph based on the Input/Output ports chosen, and relies on integer input for automation.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Choice | Int32 `int` | `0`，范围 0 … 9 | The port through which the input should be routed. |

### Seamless

`QuadSpinner.Gaea.Nodes.Seamless` · Family `Structure` · Classification `Processor` · ShortCode `sls` · Keywords `seamless`

> Seamless can transform any input terrain or color map into a tileable/repeating pattern.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 2 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Edge | Single `float` | `0.5`，范围 0f … 1f | The amount of blending across the opposite edges. |
| Shift X | Single `float` | `0.5`，范围 0f … 1f | Shift blending on the X axis.<br>*C# 属性 `ShiftX`* |
| Shift Y | Single `float` | `0.5`，范围 0f … 1f | Shift blending on the Y axis.<br>*C# 属性 `ShiftY`* |
| Preview Tiling | Command `bool` | `"layout-grid"` | *C# 属性 `ToggleTiling`* |

### Switch

`QuadSpinner.Gaea.Nodes.Switch` · Family `Routing` · Classification `Processor` · ShortCode `swt`

> Switch chooses between two different heightfield inputs and relies on a boolean (true/false) input.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）；构造器额外添加 1 个端口。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Switch Route | Boolean `bool` | `false`，范围 0f … 1f | Selects which input route is active. Use this to dynamically switch between different input sources or branches in your graph. |
| Discard Alt in Final Build | Boolean `bool` | `false`，范围 0f … 1f | If enabled, alternate (inactive) input routes are discarded during the final build, reducing memory usage and export size.<br>*C# 属性 `DiscardAlternate`* |

### Var

`QuadSpinner.Gaea.Nodes.Var` · Family `Utilities` · Classification `Generator` · ShortCode `var`

> Reads or modifies named graph variables for procedural control and automation.

*端口（推断）*：默认 1 入 1 出（基类 `QuadSpinner.Gaea.Engine.Fx.Node`）。

| 参数 | 类型 | 默认值 / 范围 | 枚举取值 / 说明 |
|---|---|---|---|
| Edit Mode | Enum `VariableEdit` | `VariableEdit.Modify`，范围 0f … 1f | `Consume` — Reads and uses the value of the specified variable without altering it.<br>`Modify` — Applies an expression or new value to the variable, updating its value for subsequent nodes. |
| Variable Name | String `string` | (TextBox，默认值在混淆常量表中) | The name of the variable to consume or modify. This should match the variable defined elsewhere in the graph or macro. |
| Expression | String `string` | (TextBox，默认值在混淆常量表中) | An optional mathematical or logical expression to apply when modifying the variable. Used only in 'Modify' mode. |
| Default Value | String `string` | (TextBox，默认值在混淆常量表中) | The value to use if the specified variable is not set or available. Ensures the node has a fallback value. |

