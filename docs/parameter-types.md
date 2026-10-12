# Gaea 2.3.1 参数类型语义说明

本文件解释 `D:\Gaea 2\Resources\Nodes.json` 中 `Type` 字段的每一个取值。
所有计数来自对该文件的全量扫描；语义结论由 `D:\Gaea 2\Gaea.Nodes.dll` 与 `D:\Gaea 2\Gaea.Engine.dll` 的元数据佐证。

## 一、总体分布

182 个节点的顶层条目共 **1341** 个。按 `Type` 取值统计：

| `Type` 取值 | 数量 | 性质 | 对应 C# 类型 |
|---|---|---|---|
| `(缺失 / null)` | 126 | UI 分组标题，不是参数 | 无（由 `[Group]` 特性表达） |
| `Enum` | 187 | 枚举参数，`Flubs` 列出成员 | 节点内具体枚举类型 |
| `EnumValue` | 0 | 枚举成员，只出现在 `Enum` 之下 | 枚举字段 |
| `Single` | 600 | 32 位浮点 | `float` / `System.Single` |
| `Int32` | 178 | 32 位有符号整数 | `int` / `System.Int32` |
| `Boolean` | 158 | 布尔 | `bool` / `System.Boolean` |
| `Float2` | 31 | 二元浮点向量 | `Float2` |
| `Command` | 20 | 命令按钮 | `bool` + `[Parameter(Parameters.Command, "<icon>")]` |
| `String` | 17 | 字符串 | `string` |
| `Byte` | 13 | 8 位无符号整数（只读信息位） | `byte` |
| `Color` | 8 | 颜色 | `Color` |
| `List`1` | 3 | 泛型列表 | `List<T>` |

校验：8 个非 `EnumValue` 的叶子类型加上缺失项与 `Enum`，构成全部顶层条目；
`EnumValue`（0）全部位于深度 1，即嵌套在 `Enum` 之下。递归扫描得到的最大嵌套深度为 **1**。

## 二、重点：126 个 `Type` 缺失项到底是什么

**结论：它们全部是 UI 分组标题（section header），不是参数，也没有对应的 C# 属性。**

证据链如下。

### 1. 缺失 `Type` 与 `IsGroup: true` 完全重合

- `Type` 缺失的条目：**126** 个
- `IsGroup` 为真的条目：**126** 个
- 两者差集：**0** 个（完全一致）

这些条目的键集合只有 `{Name, Description, IsGroup}` 或 `{Name, IsGroup}`，**没有 `Flubs` 子数组**，
因此 JSON 里不存在"分组包含子项"的显式嵌套。原文是**扁平有序列表**，分组的辖域由位置决定：
某个 `IsGroup: true` 条目之后、下一个 `IsGroup` 条目之前的全部参数都属于该分组。

例（`Erosion`）：

```
  0  Erosion                  [GROUP]
  1  Duration                 Single
  2  Rock Softness            Single
  3  Strength                 Single
  4  Downcutting              [GROUP]
  5  Downcutting              Single
  6  Inhibition               Single
  7  Base Level               Single
  8  Scale                    [GROUP]
  9  Feature Scale            Int32
 10  Real Scale               Boolean
 11  Terrain Scale            Int32
 12  Verticality              Int32
 13  Flow                     [GROUP]
 14  Debris                   Single
 15  Volume                   Single
 16  Sediment Removal         Single
 17  Selective Processing     [GROUP]
 18  Area Effect              Enum
 19  Bias Type                Enum
 20  Bias                     Single
 21  Reverse                  Boolean
 22  Other Settings           [GROUP]
 23  Seed                     Int32
 24  Aggressive Mode          Boolean
 25  Deterministic            Boolean
 26  Information              [GROUP]
 27  Information              Byte
```

### 2. 分组标题与程序集的 `[Group]` 特性一一对应

`QuadSpinner.Gaea.Engine.Fx.GroupAttribute` 的定义（观察自 `Gaea.Engine.dll` 元数据）：

```
=== QuadSpinner.Gaea.Engine.Fx.GroupAttribute (Class) ===
  field  String <Name>k__BackingField
  field  GroupType <Type>k__BackingField
  field  Boolean <IsCollapsed>k__BackingField
  method Void .ctor(String name, GroupType type, Boolean isCollapsed)
=== QuadSpinner.Gaea.Engine.Fx.GroupType (Enum) ===
  field  GroupType Fixed
  field  GroupType Collapsible
```

- Nodes.json 的分组标题共 126 个；其中 **122** 个在同一个实现类里能找到 `[Group("<同名>")]`。
- 找不到同名 `[Group]` 的分组标题：**4** 个。
- 反向：程序集里有 `[Group]` 但 Nodes.json 没有对应标题的：**0** 个。

未匹配清单：

- `Lake` / `Simple Mode`
- `Lake` / `Advanced Mode`
- `Lake` / `Shore Formation`
- `Wizard2` / `Advanced`

### 3. `[Group]` 是"粘性"的，与 JSON 的位置语义完全一致

`[Group(...)]` 只标注在**开启**该分组的那个属性上，后续属性继承它直到下一个 `[Group]`。
例（`QuadSpinner.Gaea.Nodes.MultiFractal`，节选自反编译结果）：

```csharp
[Group("Fractal", GroupType.Fixed, false)]
[Parameter(Parameters.Enum, MultifractalNoiseType.FBM, 0f, 1f)]
[Name("Noise Type")]
public MultifractalNoiseType NoiseType { get; set; }

[Parameter(0.5f, 0f, 1f)]
[Name("Roughness")]
public float FractalGain { get; set; }        // 继承 Fractal

[Group("Warp", GroupType.Fixed, false)]
[Parameter(Parameters.HorizontalList, Perturb.None, 0f, 1f)]
public Perturb Perturb { get; set; }

[Parameter(0.4f, 0f, 0.5f)]
[Name("Roughness")]
public float WarpRoughness { get; set; }      // 继承 Warp
```

两个属性显示名都叫 `Roughness`，靠分组区分；Nodes.json 里也正是两个 `Roughness`，分属 `Fractal` 与 `Warp`。
这正是本参考库把分组归属标注为**位置推断**而非"文件明文"的原因，同时也是它可被程序集交叉验证的原因。

### 4. 实践含义

- 写节点图/生成器时，**不能**把 `Type` 缺失项当成需要赋值的参数；它们只影响 UI 呈现。
- 参数总数若按"顶层条目"算是 1341；按"真实可赋值参数"算是 **1215**（1215）。两个数都对，但含义不同。
- 分组标题可以用来还原 UI 排版，也是参数→属性配对的消歧键（见 `nodes-crosscheck.md`）。

## 三、逐类型说明

### `Enum` 与 `EnumValue`

共 187 个 `Enum` 参数、0 个 `EnumValue` 成员。
`Enum` 条目自身带 `Flubs`，其子项 `Type` 一律为 `EnumValue`，含 `Name` 与 `Description`。
程序集侧对应一个具体枚举类型；Nodes.json 不记录类型名，类型名由本库从属性签名补齐。

交叉核对：171 个枚举参数已解析出程序集枚举类型。
其中 Nodes.json 成员数与枚举字段数 **一致 171 个，不一致 0 个**。

<details><summary>全部枚举参数 → 程序集枚举类型（点击展开）</summary>

| 节点 | 参数 | 枚举类型 | Nodes.json 成员数 | 枚举字段数 |
|---|---|---|---|---|
| Accumulator | Type | `AccumulatorType` | 11 | 11 |
| Anastomosis | Downcutting | `AnastomosisDowncutting` | 9 | 9 |
| Anastomosis | Quality | `RelativeQuality` | 4 | 4 |
| AO | Quality | `AOQuality` | 4 | 4 |
| Aperture | Mode | `ApertureMode` | 2 | 2 |
| Aperture | Shape | `ApertureKernel` | 5 | 5 |
| Bomber | Distribution | `BombDistribution` | 2 | 2 |
| Bomber | Blend Mode | `BombBlendMode` | 9 | 9 |
| Bomber | Quality | `ResizeQuality` | 3 | 3 |
| Canyon | Style | `CanyonStyle` | 5 | 5 |
| Cartography | Gradient Style | `MapGradientStyle` | 3 | 3 |
| Cartography | Land Palette | `CartographyLandPalette` | 8 | 8 |
| Cartography | Water Palette | `CartographyWaterPalette` | 3 | 3 |
| Cartography | Grid Style | `MapGridStyle` | 4 | 4 |
| Cellular | Distance Metric | `DistanceMetric` | 3 | 3 |
| Cellular | Distance Function | `DistanceFunction` | 5 | 5 |
| Clamp | Mode | `ClampMode` | 2 | 2 |
| Combine | Mode | `BlendMode` | 24 | 24 |
| Combine | Output | `ClampType` | 3 | 3 |
| Combine | Enhance | `ProcessInput` | 3 | 3 |
| Constant | Output | `ConstantType` | 2 | 2 |
| Cracks | Style | `CrackStyle` | 3 | 3 |
| Crater | Style | `CraterStyle` | 2 | 2 |
| Crater | Rim | `ShortSharp` | 2 | 2 |
| Crumble | Direction | `GradientDirection` | 5 | 5 |
| Curvature | Type | `CurvatureType` | 3 | 3 |
| Curve | Mode | `AbsoluteRelative` | 2 | 2 |
| DataExtractor | Data | `DataExtraction` | 4 | 4 |
| Debris | Shape | `DebrisShape` | 2 | 2 |
| Denoise | Type | `DenoiseType` | 3 | 3 |
| Dilate | Kernel | `KernalType` | 4 | 4 |
| Distance | Method | `DistanceMode` | 2 | 2 |
| Distance | Mode | `DistanceRTStyle` | 2 | 2 |
| DotNoise | Style | `DotNoiseStyle` | 2 | 2 |
| DotNoise | Blend Mode | `BombBlendMode` | 9 | 9 |
| DuneSea | Dune Type | `ABCD` | 4 | 4 |
| DuneSea | Chaos | `DuneChaosLevel` | 4 | 4 |
| DuneSea | Undulation | `DuneUndulationLevel` | 4 | 4 |
| EasyErosion | Style | `QuickErosion` | 15 | 15 |
| EasyErosion | Bias Angle | `GradientDirection` | 5 | 5 |
| Edge | Style | `EdgeStyle` | 3 | 3 |
| Erosion | Area Effect | `AreaEffect` | 4 | 4 |
| Erosion | Bias Type | `BiasType` | 2 | 2 |
| Export | Location | `SaveLocation` | 3 | 3 |
| Filter | Mode | `FilterMode` | 7 | 7 |
| Flip | Type | `FlipType` | 3 | 3 |
| FlowMapClassic | Quality | `RelativeQuality` | 4 | 4 |
| Fold | Waveform | `FoldWaveform` | 3 | 3 |
| FractalTerraces | Warp Style | `ABCD` | 4 | 4 |
| GroundTexture | Method | `GroundStyle` | 3 | 3 |
| Halftone | Pattern | `HalftonePattern` | 18 | 18 |
| Hillify | Creep | `HillCoverage` | 2 | 2 |
| Hillify | Surface | `HillSurface` | 2 | 2 |
| Lake | Type | `LakeType` | 2 | 2 |
| Lichtenberg | Style | `ABC` | 3 | 3 |
| LightX | Direction Selection | `LightingDirectionType` | 2 | 2 |
| LightX | Quality | `AOQuality` | 4 | 4 |
| LinearGradient | Edge Behavior | `GradientEdgeBehaviour` | 3 | 3 |
| LineNoise | Bucket Size | `LineNoiseSize` | 4 | 4 |
| LineNoise | Style | `LineNoiseStyle` | 4 | 4 |
| MacroPort | Direction | `TransferDirection` | 2 | 2 |
| MacroPort | Display | `DisplayIntent` | 3 | 3 |
| MacroPort | Fallback | `FallbackMap` | 4 | 4 |
| Match | Mode | `MatchType` | 2 | 2 |
| Median | Mode | `MedianType` | 3 | 3 |
| Median | Strength | `MedianStrength` | 4 | 4 |
| Mesher | Artifact Reduction | `Generic3` | 3 | 3 |
| Mesher | Level of Detail | `LOD` | 7 | 7 |
| Mountain | Style | `MountainStyle` | 5 | 5 |
| Mountain | Bulk | `MountainBulk` | 3 | 3 |
| MountainRange | Style | `MountainRangeStyle` | 4 | 4 |
| MountainRange | Bulk | `MountainBulk` | 3 | 3 |
| MountainSide | Type | `MountainSideType` | 2 | 2 |
| MountainSide | Style | `MountainStyle` | 5 | 5 |
| MultiFractal | Noise Type | `MultifractalNoiseType` | 3 | 3 |
| MultiFractal | Type | `VariationType` | 2 | 2 |
| MultiFractal | Perturb | `Perturb` | 3 | 3 |
| Noise | Noise Type | `ConstantNoiseType` | 5 | 5 |
| Noise | Blend Mode | `PrimitiveBlendMode` | 3 | 3 |
| Normals | Type | `NormalMapType` | 2 | 2 |
| Normals | Handedness | `Handedness` | 2 | 2 |
| Normals | Up Axis | `UpAxis` | 2 | 2 |
| Pattern | Type | `PatternType` | 4 | 4 |
| Perlin | Type | `PerlinNoiseType` | 3 | 3 |
| Perlin | Type | `NoiseWarpType` | 3 | 3 |
| Recurve | Style | `RecurveStyle` | 2 | 2 |
| RGBMerge | Enhance R | `ProcessInput` | 3 | 3 |
| RGBMerge | Enhance G | `ProcessInput` | 3 | 3 |
| RGBMerge | Enhance B | `ProcessInput` | 3 | 3 |
| Rivers | River Valley Width | `RiverValleyWidths` | 5 | 5 |
| RockNoise | Style | `ABC` | 3 | 3 |
| Rockscape | Clusters | `RockClusters` | 4 | 4 |
| Rockscape | Relief | `RockRelief` | 4 | 4 |
| Roughen | Quality | `RelativeQuality` | 4 | 4 |
| Rugged | Style | `ABCDE` | 5 | 5 |
| SatMap | Library | `CLUTLibrary` | 6 | 6 |
| SatMap | Enhance | `ProcessInput` | 3 | 3 |
| SatMap | Rough | `Generic5` | 5 | 5 |
| Sea | Sea | `SeaArrangement` | 2 | 2 |
| Sediments | Type | `Sedimentation` | 3 | 3 |
| Sediments | Style | `AB` | 2 | 2 |
| Shade | Render Style | `ShadeStyle` | 4 | 4 |
| Shape | Geometry | `Shapes` | 2 | 2 |
| Sharpen | Method | `SharpenMethod` | 2 | 2 |
| Shrubs | Shape | `TreeShape` | 3 | 3 |
| Shrubs | Seek Water | `WaterAffinity` | 2 | 2 |
| Shrubs | Avoid Trees | `AvoidTrees` | 3 | 3 |
| Slope | Type | `SlopeMapType` | 2 | 2 |
| SlopeBlur | Window | `SlopeWindow` | 2 | 2 |
| SlopeBlur | Quality | `SlopeQuality` | 4 | 4 |
| SlopeBlur | Antialiasing | `SlopeAntialiasing` | 3 | 3 |
| SlopeWarp | Quality | `SlopeQuality` | 4 | 4 |
| SlopeWarp | Antialiasing | `SlopeAntialiasing` | 3 | 3 |
| Slump | Style | `ABCD` | 4 | 4 |
| Snow | Melt Type | `MeltType` | 2 | 2 |
| Snowfield | Direction | `GradientDirection` | 5 | 5 |
| SoftClip | Clip Mode | `ClipMode` | 2 | 2 |
| SuperColor | Texture | `TextureMapType` | 4 | 4 |
| SuperColor | Library | `CLUTLibrary` | 6 | 6 |
| SuperColor | Process | `TextureProcessType` | 3 | 3 |
| SuperColor | Amount | `Generic4` | 4 | 4 |
| Synth | Samples | `SynthSamples` | 9 | 9 |
| TextureBase | Accentuate | `AccentuateType` | 3 | 3 |
| TextureBase | Enhance | `ProcessInput` | 3 | 3 |
| Texturizer | Style | `QuickTexture` | 12 | 12 |
| Tint | Enhance | `ProcessInput` | 3 | 3 |
| Transform | Edges | `EdgeFade` | 4 | 4 |
| Transform | Quality | `ResizeQuality` | 3 | 3 |
| Transpose | Mode | `TransposeMode` | 3 | 3 |
| Trees | Output | `TreeOutput` | 2 | 2 |
| Trees | Shape | `TreeShape` | 3 | 3 |
| Trees | Seek Water | `WaterAffinity` | 2 | 2 |
| Trees | Avoid Trees | `AvoidTrees` | 3 | 3 |
| Unity | Target Size | `UnitySizes` | 5 | 5 |
| Unreal | Target Size | `UnrealSizes` | 7 | 7 |
| Unreal | Format | `UnrealFormat` | 3 | 3 |
| Unreal | Map 1 | `UEMapType` | 4 | 4 |
| Unreal | Map 2 | `UEMapType` | 4 | 4 |
| Unreal | Map 3 | `UEMapType` | 4 | 4 |
| Unreal | Map 4 | `UEMapType` | 4 | 4 |
| Unreal | Map 5 | `UEMapType` | 4 | 4 |
| Unreal | Map 6 | `UEMapType` | 4 | 4 |
| Unreal | Map 7 | `UEMapType` | 4 | 4 |
| Unreal | Map 8 | `UEMapType` | 4 | 4 |
| Unreal | Map 9 | `UEMapType` | 4 | 4 |
| Unreal | Map 10 | `UEMapType` | 4 | 4 |
| Var | Edit Mode | `VariableEdit` | 2 | 2 |
| Volcano | Surface | `HillSurface` | 2 | 2 |
| Voronoi | Function | `VoronoiFunction` | 2 | 2 |
| Voronoi | Form | `VoronoiForm` | 8 | 8 |
| Voronoi | Type | `NoiseWarpType` | 3 | 3 |
| Warp | Warp Source | `WarpNoiseType` | 7 | 7 |
| Warp | Mode | `WarpMode` | 3 | 3 |
| WaterColor | Source | `WaterSource` | 2 | 2 |
| WaterColor | Palette | `WaterColors` | 9 | 9 |
| Whorl | Type | `WhorlType` | 2 | 2 |
| Wizard | Strength | `Generic4` | 4 | 4 |
| Wizard | Density | `Generic4` | 4 | 4 |
| Wizard | Material | `Generic4` | 4 | 4 |
| Wizard | Channel Depth | `Generic4` | 4 | 4 |
| Wizard | Channel Width | `Generic4` | 4 | 4 |
| Wizard | Deposits | `Generic4` | 4 | 4 |
| Wizard | Removal | `Generic4` | 4 | 4 |
| Wizard | Bulk | `Generic4` | 4 | 4 |
| Wizard2 | Power | `Generic4` | 4 | 4 |
| Wizard2 | Depth | `Generic4` | 4 | 4 |
| Wizard2 | Scale | `Generic4` | 4 | 4 |
| Wizard2 | Deposits | `Generic4` | 4 | 4 |
| Wizard2 | Flow | `Generic4` | 4 | 4 |
| Wizard2 | Shape | `Generic4` | 4 | 4 |
| Wizard2 | Detail | `Generic4` | 4 | 4 |

</details>

### `Command`

共 20 个。语义是**动作按钮**，不保存数值。
程序集侧实现为一个普通布尔属性，加 `[Parameter(Parameters.Command, "<icon-name>")]`（或 `Parameters.CommandButton`）：

```csharp
// QuadSpinner.Gaea.Nodes.Combine
[Parameter(Parameters.Command, "replace")]
[Name("Swap Inputs")]
public bool SwitchInputs { get; set; }

[Parameter(Parameters.Command, "port-connect")]
[Name("Add Input")]
public bool AddInput { get; set; }
```

第二个字符串参数是图标名（Tabler 图标集风格，如 `dice-five`、`file-shredder`、`port-connect`）。
`Parameters` 枚举（`QuadSpinner.Gaea.Engine.Fx.Parameters`，19 个字段）列出了全部渲染方式，
`Command` 与 `CommandButton` 是其中两项。

### `Single` / `Int32` / `Boolean`

600 / 178 / 158 个。
分别对应 C# `float` / `int` / `bool`。取值范围与默认值来自 `[Parameter(default, min, max)]`：

```csharp
// QuadSpinner.Gaea.Engine.Fx.ParameterAttribute 的构造函数重载
method Void .ctor()
method Void .ctor(Single defaultValue, Single min, Single max)
method Void .ctor(Single default1, Single default2, Single min, Single max)
method Void .ctor(Object defaultValue, Single min, Single max)
method Void .ctor(Parameters parameterType)
method Void .ctor(Parameters parameterType, String icon)
method Void .ctor(Parameters parameterType, Single default1, Single default2, Single min, Single max)
method Void .ctor(Parameters parameterType, Object defaultValue, Single min, Single max)
```

因此本库按参数个数解读：3 个参数 = `(默认, 最小, 最大)`；4 个 = Float2 的 `(默认x, 默认y, 最小, 最大)`。
注意布尔值在 IL 里写作 `true`/`false`，而范围仍以 `0f`/`1f` 给出（例：`[Parameter(true, 0f, 1f)]`）。

全部 1238 个实现属性中，**1019** 个带可读的 min/max，**1036** 个带可读的默认值。
其余属性的默认值写在字段初始化器里，形如 `private float <Radius>k__BackingField = \ue0003.\ue002(93);`，
其中 `\ue0003.\ue002(int)` 是混淆器的常量表查询（见第六节），静态不可读。

### `Float2`

共 31 个。二元浮点向量，对应 C# `Float2`。
`[Parameter]` 用 4 参数重载给出两个分量的默认值，例：

```csharp
// QuadSpinner.Gaea.Nodes.Erosion2
[Parameter(Parameters.RangeClipper, 0f, 1f, 0f, 1f)]   // 形如 (kind, default1, default2, min, max)
public Float2 Slope { get; set; }
```

### `String`

共 17 个。C# `string`。
含用户可编辑的路径、名称，以及只读的信息行（例如 `Accumulator` 的 `Warning`）。只读与否由 `[Parameter(Parameters.ComputedString)]` 或 `[CustomControl]` 决定。

### `Byte`

共 13 个。C# `byte`。
观察到的全部实例都叫 `Information*` 并且没有 `[Parameter]` 特性，
说明它是**节点信息位**（例如"当前是否处于 HD 模式""是否被烘焙"），只在 UI 上显示、不可编辑：

```csharp
// QuadSpinner.Gaea.Nodes.Erosion
[Group("Information", GroupType.Fixed, false)]
[Parameter]
[Description("")]
public byte Information { get; set; }
```

### `Color`

共 8 个。C# `Color`，带 alpha 的 RGBA。
属性通常还带 `[Parameter(Parameters.HorizontalList, ...)]` 与自定义颜色控件特性。

### ``List`1``

共 3 个。这是 .NET 反射给出的泛型类型名 `List<T>` 的字面写法，
Nodes.json 直接照抄了 `Type.Name` 而没有展开类型参数。
观察到的实例：

- `CLUTer` / `Gradient Data` → C# 属性 `GradientData`，类型 `List<Float4>`
- `Curve` / `Curve Spline` → C# 属性 `CurveSpline`，类型 `List<Float2>`
- `Synth` / `Data` → C# 属性 `Data`，类型 `List<Float4>`

因此 `List`1` 的完整含义必须回到程序集才能确定（上表已给出具体元素类型）。

## 四、`Parameters` 渲染枚举

`[Parameter]` 的第一个参数（当它是 `Parameters` 枚举值时）决定 UI 渲染方式，
与"数据类型"是两个正交维度。定义见 `QuadSpinner.Gaea.Engine.Fx.Parameters`：

```
Standard, Enum, Custom, Seed, NamedToggle, HorizontalList, HorizontalListNoLabel,
OptionGrid, OptionsGridDehumanized, GradientEditor, Command, CommandButton,
ComputedString, Range, RangeClipper, Folder, TextBox, Array
```

统计（按实现属性）：

| 渲染方式 | 属性数 |
|---|---|
| `Parameters.HorizontalList` | 122 |
| `Parameters.Seed` | 74 |
| `Parameters.Enum` | 40 |
| `Parameters.Command` | 18 |
| `Parameters.HorizontalListNoLabel` | 17 |
| `Parameters.ComputedString` | 7 |
| `Parameters.OptionGrid` | 5 |
| `Parameters.Custom` | 4 |
| `Parameters.TextBox` | 4 |
| `Parameters.GradientEditor` | 2 |
| `Parameters.OptionsGridDehumanized` | 2 |
| `Parameters.RangeClipper` | 2 |
| `Parameters.Folder` | 1 |
| `Parameters.CommandButton` | 1 |

## 五、混淆对类型判定的影响

`Gaea.Nodes.dll` 的**类型名被混淆**（如 `\ue0002`、`\ue0003`），但**成员名完整可读**。
受影响的部分：

- 属性类型名若指向被混淆的枚举，反射会给出 `enum` 而非真实名（例如 `ColorErosion.Ver` 的类型显示为 `enum`）。
- 枚举成员的具体数值需要 `\ue0003` 的常量表才能读出，静态不可得；Nodes.json 的成员**顺序**与元数据字段顺序一致，可作为顺序依据。
- 端口方向 `PortType` 的所有取值都以 `(PortType)\ue0003.\ue000(1)` 形式出现，无法静态判定（见 `nodes-crosscheck.md`）。

## 六、`Type` 缺失项与"真正未知"的区分

| 现象 | 判定 | 依据 |
|---|---|---|
| `Type` 字段缺失 | **不是未知**，是分组标题 | 与 `IsGroup: true` 100% 重合，且能从 `[Group]` 找到同名声明 |
| 属性类型显示为 `enum` | 真实类型被混淆，未知 | 混淆器把类型名替换为单字符 |
| 默认值为 `\ue0003.\ue002(N)` | 未知 | 加密常量表 |
| 端口方向 | 未知 | `PortType` 常量被混淆 |

