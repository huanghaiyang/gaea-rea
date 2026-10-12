# Gaea 2.3.1 数据格式：`Map` / 高度场 / mask / 缓存 / 导出 / 常量池外壳

目标：`D:\Gaea 2\Gaea.Engine.dll`（Gaea 2.3.1，.NET 8）。
配套：`docs/engine-model.md`（对象模型）、`docs/engine-flows.md`（时序）。

> **observed** = 反编译代码直接可见；**inferred** = 推理；**unknown** = 未能确定。
> 混淆类保留 `\uf55c\uf0ba\ue6xx` 原名。数值字面量若来自加密常量池，标注为「池索引未解析」。

---

## 1. `Map` 的内存布局

### 1.1 结构（observed，`Fx.Map.cs:1094-1220`）

```
QuadSpinner.Gaea.Engine.Fx.Map : IDisposable        (非泛型 = float 通道)
├── MapInfo Info                     struct，唯一字段 RenderIntent      :3540-3565
├── Channel[] _channels              通道数 = NumberOfChannels
├── float[]? __firstChannelData      通道 0 的裸数组（快速引用）
├── float[]? __rData/__gData/__bData 通道 0/1/2 的裸数组
├── float[][]? __channelsData        全部通道的裸数组
├── Channel? __rChannel/__gChannel/__bChannel
├── int _resolutionX, _resolutionY
├── _RGB? _rgb                       三通道颜色视图
└── bool _isDisposed
```

`Map.Channel`（`Fx.Map.cs:14-60`）：

```
Channel : IDisposable
├── float[] _data         长度 = _resolutionX * _resolutionY
├── int _resolutionX/_resolutionY
└── this[x, y] => _data[y * _resolutionX + x]
```

### 1.2 关键布局事实

* **observed** 元素类型 = `System.Single`（IEEE-754 binary32），通道内连续存放。
* **observed** 索引公式 `_data[y * _resolutionX + x]` ⇒ **行主序（row-major）、y 为行**。
  没有 stride/padding、没有 tile 嵌套——分块只在导出/缓存粒度上做，内存里始终是完整矩形。
* **observed** 通道彼此独立（`float[][]`），**通道没有名字**，只有 0..N-1 索引；
  语义由 `MapInfo.RenderIntent`（高度场/遮罩/颜色/原始）与端口上的 `Accumulator` 字符串承载。
* **observed** 单通道 = 高度场或遮罩；三通道 = 颜色（`R`/`G`/`B` = `__rChannel/__gChannel/__bChannel`，
  `inferred` 对应索引 0/1/2）；更多通道由 `Map(res, n)` 支持（`NumberOfChannels = _channels.Length`）。
* **observed** 泛型版本 `` Map`1 `` 结构相同、元素类型为 `DataType`（例：`Map<Vector>`）。
* **observed** `Resolution` 是 struct（`int X, int Y`，`Fx.Numeric.cs`）；`Map.Resolution` =
  `new Resolution(_resolutionX, _resolutionY)`。
* **observed** 数组池化：静态 `_useArrayPool` + 泛型版 `Map.Pool`（静态 `allocated`/`returned` 计数）；
  `Channel.allocateArray(length)` 是唯一分配入口。
* **observed** `InterpolateBilinear(Vector2[, EdgeBehaviour])` 与 `AtomicAdd(x, y, v)` 说明
  **存在并行写入与双线性重采样**（`AtomicAdd` 用 `Interlocked`/CAS，`inferred`）。
* **observed** 数值安全：`Map.Utils` 提供 `CopyArray` / `CalculateChunks(resX, resY)`；
  分块并行计算在 `Process(...)` / `Generate(...)`（接 `Func<...>`）里，闭包捕获 `chunkLength`。

### 1.3 `MindMap`：无

引擎内没有"多分辨率金字塔"容器；HD 由 `QuadSpinner.Gaea.Engine.IO.HDService`
（`BuildHD(Node)` / `ClearHD()` / `ClearHD(int)`，`IO.cs:70-153`）另建。

---

## 2. 节点缓存文件：`<...>.bin` + `<...>.meta`

### 2.1 路径（observed `Fx.Cache.cs:103-121`）

```
<集群目录>\<cacheFolder>_<工程Id>.Id\<节点Id>_<端口名>.bin
```

* `<集群目录>` = `CacheClusters` 之一：`Progressive` / `Primary` / `Bakes` / `HD`（`observed`）
* 同目录同名 `.meta`（`Cache.DeleteOffloaded` 删 `.bin` 与 `Path.ChangeExtension(Filename, ".meta")`）
* 字符串池恢复了 `\Gaea\Caches`（索引 28631）、`\Cache`、`\MacroCache`、`CacheColorId`
  —— 说明首选目录在 `Gaea\Caches` 下（**observed** 字符串，拼接逻辑未逐一确认）

### 2.2 `.bin` = 无头裸 `float32` 数组

**observed** `_cls_E6EF.cs`（缓存序列化器）+ `_cls_E6EC.cs`（底层 IO）：

```csharp
// 写（_cls_E6EF.cs:29）
\uf55c\uf0ba\ue6ec.<m>\uf7ab(path, map);            // 裸写 map 数据
text = Path.ChangeExtension(path, ".meta");
meta = new MetaDictionary {
    ["Resolution"]   = map.Resolution.X.ToString(),
    ["Channels"]     = map.NumberOfChannels.ToString(),
    ["RenderIntent"] = map.Info.RenderIntent.ToString(),
    // 条件写入 Min/Max（分块缩放）
    // 调用方附加，例如 ["GUID"] = Thumbprint.ToString("N")
};
写 JSON(text);

// 读（_cls_E6EF.cs:61-102）
meta = 读 JSON(path.meta) ?? new MetaDictionary();
map  = \uf55c\uf0ba\ue6ec.<m>\uf7a5<float>(path)      // 泛型裸数组读
         .<构造 Map>(meta.Resolution, meta.Channels);
if (meta.Min != 0 || meta.Max != 1) {
    \uf55c\uf0ba\ue6d5.\ueb77\uf21d\ue95c(map, out min, out max);
    \uf55c\uf0ba\ue6cb.\ueb20\uee69\uf028 = new Float2(meta.Min, meta.Max);
    map = 重新缩放(map, min, max, ...);
}
map.Info.RenderIntent = meta.RenderIntent;
```

底层写实现（**observed** `_cls_E6EC.cs:265-281`）：

```
FileStream(path, FileMode.Create, FileAccess.Write)
Buffer.BlockCopy(float[] src, 0, byte[] array, 0, n)   // float[] → byte[] 直拷
fileStream.Write(array); fileStream.Close();
```

⇒ **`.bin` 布局 = 无头、无压缩、little-endian IEEE-754 float32，
长度 = `Resolution.X * Resolution.Y * Channels`，通道优先、通道内行主序**（`inferred` 的通道顺序：
`__channelsData[c][y*x + x]`，**observed** 索引公式，故通道间是"平面分离"而非交错）。

对应的 16 位变体走 `MemoryMarshal.AsBytes<Half>(span)`（`_cls_E6EC.cs:358-359`）⇒ binary16 无头输出。

### 2.3 `.meta` = JSON `MetaDictionary`

**observed** `MetaDictionary : Dictionary<string,string>`（`MetaDictionary.cs:7`），
默认构造写入：

| 键 | 默认值 | 类型属性 |
| --- | --- | --- |
| `Channels` | `"1"` | `internal int Channels`（解析失败回落 `<pool>(1)`） |
| `Resolution` | `"-1"` | `internal int Resolution` |
| `RenderIntent` | `"Default"` | `internal RenderIntent`（`Enum.Parse`，失败回落 `<pool>(1)`） |
| `Min` | `"0"` | `internal float Min`（缺键回落 `<pool>(3)`） |
| `Max` | `"1"` | `internal float Max`（缺键回落 `<pool>(11)`） |
| `GUID` | 惰性生成 | `internal Guid Guid`（`Guid.NewGuid()` 后回写） |

* **observed** `Min`/`Max` 是**分块/区域构建时的值域**（`Cache` 写 `.bin` 前若处于特定 portion 会折算，
  读回时用 `Float2(min,max)` + 重缩放恢复）。`Min=0,Max=1` 表示无缩放。
* **observed** `GUID` = `Cache.Thumbprint`，是**磁盘失效判据**：
  `Cache.IsDifferentFromDisk()` 比较 `.meta` 的 `GUID` 与内存 `Thumbprint`。
* **observed** 全部是字符串（`Dictionary<string,string>`），因此工程文件与元数据都是人类可读的
  JSON（Newtonsoft 写出）。

---

## 3. 导出文件格式

**observed** `QuadSpinner.Gaea.Engine.IO.FileFormats`（`IO.cs:6-38`，带 `[Description]`，即 UI 显示名与扩展名）：

| 成员 | 描述（原文） | 扩展名 |
| --- | --- | --- |
| `GaeaRaw` | Gaea Pure Raw | `.graw` |
| `HalfRaw` | Half Raw 16-bit | `.raw` |
| `HalfRaw16` | Half Raw 16-bit | `.r16` |
| `UshortRaw` | Ushort Raw 16-bit | `.raw` |
| `UshortRaw16` | Ushort Raw 16-bit | `.r16` |
| `FloatRaw` | Float Raw 32-bit | `.raw` |
| `FloatRaw32` | Float Raw 32-bit | `.r32` |
| `JPEG` | JPEG 8-bit | `.jpg` |
| `PNG8` / `PNG16` / `PNG64` | PNG 8/16/64-bit | `.png` |
| `TIFF8` / `TIFF16` / `TIFF32` | TIFF 8/16/32-bit | `.tif` |
| `EXR` | OpenEXR 32-bit | `.exr` |

### 3.1 裸数组写出（observed `_cls_E6EC.cs`）

```
float32 家族（GaeaRaw / FloatRaw / FloatRaw32）:
    FileStream(path, FileMode.Create, FileAccess.Write)
    Buffer.BlockCopy(float[] → byte[])                  :265-273
    fileStream.Write(byte[])                            :273
    ⇒ 无头、little-endian、row-major、长度 X*Y*Channels

half 家族（HalfRaw / HalfRaw16）:
    Span<byte> span = MemoryMarshal.AsBytes<Half>(halfArray.AsSpan());   :358
    fileStream.Write(span);                                              :359
    ⇒ 无头 little-endian binary16

ushort 家族（UshortRaw / UshortRaw16）:
    同一组重载中的 16 位转换路径（Buffer.BlockCopy 到 byte[] 后整块写）

读回（observed :303-321）:
    FileStream(path, FileMode.Open, FileAccess.Read)
    fileStream.Read(byte[], 0, n)  →  Buffer.BlockCopy(byte[] → float[])
```

⇒ **`.r32` / `.raw` / `.r16` / `.graw` 都是无头裸栅格数组**，没有 magic、没有宽高字段
（尺寸必须由外部配置或 `.meta` 提供）。这是与 `.bin` 缓存**完全相同**的布局，
只是扩展名不同。**observed** 依据：`.bin` 与 `.raw` 共用同一批 `\uf55c\uf0ba\ue6ec` 读写重载。

### 3.2 图像格式

* **observed** 存在以 Magick.NET 类型为参数的重载：
  `\uf55c\uf0ba\ue6ec.<m>\uf7a5(string filename, Map map, int, PixelType pixelType = PixelType.Float,
  CompressionType compressionType = CompressionType.None)`（`_cls_E6EC.cs:426`）。
* **observed** 随程序分发 `Magick.NET-Q16-HDRI-OpenMP-x64.dll`（982 KB）、
  `Magick.NET.Core.dll`、`BitMiracle.LibTiff.NET.dll`（642 KB）、`TinyExr.dll`（336 KB）。
  ⇒ PNG/JPEG/TIFF 走 Magick.NET / LibTiff.NET；**EXR 走 TinyExr**（`inferred`：TinyExr 是唯一 EXR 相关原生库）。
* **observed** 写网格走文本：`StreamWriter(filename, false, Encoding.Default, <pool>(165))` +
  `"# Generated by Gaea " + <pool>` + `"g " + Path.GetFileNameWithoutExtension(filename)`
  （`IO.cs:1060-1066`，即 **OBJ 格式**）。

### 3.3 网格 / 点云

* **observed** `QuadSpinner.Gaea.Engine.IO.Sophia`（13 方法 / 16 字段 / 6 属性）是**网格生成器**
  （不是工程序列化器）：`Sonar` 风格的 `ProcessMesh` / `CalculateErrors` /
  `SaveOBJ(string, MeshScale)` / `SaveMesh(string, MeshScale, bool centered, bool exportNormals,
  bool exportUVs, UVOrigin, Vector2 topLeft, Vector2 bottomRight)`，属性
  `MaxError` / `SafetyThreshold` / `OptimizationThreshold` / `Accuracy` / `FinderAccuracy` / `TargetPolycount`。
* **observed** `IO.Topology`（枚举）、`IO.MesherFormats`、`IO.PointCloudFormats`、
  `IO.MeshExportOptions`（struct，13 字段 / 11 属性：用到 `Centered`、`CreateNormals`、
  `CreateTextureCoordinates`、`UVOrigin`、`TopLeft`、`BottomRight`，见 `_cls_E6EC.cs:827`）。
* **observed** 网格导出分流入口：
  `\uf55c\uf0ba\ue6cb.\ue6f8\ue1a7\uefc7(string, Map, Topology, MeshExportOptions)`（`_cls_E6CB.cs:1264`）
  与 `\uf55c\uf0ba\ue6ec.<m>\uf7a5/\uf7a6/\uf7a7(string, Map, Topology, MeshExportOptions)`
  （`_cls_E6EC.cs:468/692/758`）、`\uf7a5(string, Map, MeshExportOptions)`（`:844`）、
  `\uf7a5(string, Vector3[], MeshExportOptions, bool)`（`:968`，点云）。

---

## 4. 分块（Bucket）文件与补边

* **observed** `Node.ExportBucketBin()`（`Fx.Node.cs:1335-1366`）命名：
  ```
  {Id}_{Name}_{port.Name}_y{Bucket.Position.Y}_x{Bucket.Position.X}.bin
  ```
  写到 `\uf55c\uf0ba\ue6cb.\ueb20\uee69\uf029`（Bucket 输出目录），通过
  `\uf55c\uf0ba\ue6ec.<m>\uf7a8(path, map)` 写裸 float32。
  ⇒ **分块中间产物与缓存 `.bin` 同布局**。
* **observed** `QuadSpinner.Gaea.Engine.IO.TileVertexBorder`：
  * 公开 `readonly struct Tile : IEquatable<Tile>`，参与 `(Map, Tile)` 元组
    （`Tile` 有 `X`、`Y`、`Map`、`Name`，见 `Fx.Node.cs:1304` 构造 `new TileVertexBorder.Tile(x, y, map, "")`）。
  * `public static IReadOnlyList<(Map, Tile)> Expand(IReadOnlyList<Tile> tiles,
     int tilesPerDimension, int stripSize = 1)`（`IO.cs:1409`）
    —— 按 `tilesPerDimension` 校验网格，为每块生成**带 1 像素边距**的扩展块。
  * `inferred`：这正是 `BuildDefinition.EdgeBlending` / `OverlappingPixels` / `EdgeSize` /
    `BucketSizeWithMargin = BucketResolution + EdgeSize * k` 的落地机制：
    先把瓦片扩展出边距，再在写入时按 `EdgeBlending` 融合接缝。
* **observed** 切片用 `Transformer.<m>(map, x*TileResolution, y*TileResolution, ResizeMethod)`
  （`Fx.Node.cs:1296`），`Transformer` 提供 `AnchorPosition` / `BlendMode`（10 种）/
  `ResizeMethod` / `TransformQuality` 等枚举。
* **observed** 瓦片文件名模板默认 `_y%Y%_x%X%`（字符串池索引 22159，经 152/152 调用点验证），
  由 `BuildDefinition.TilePattern` 提供、`Tile.TileSuffix(pattern)` 渲染。

---

## 5. Eazfuscator.NET 常量池外壳（已还原）

这一节是**本次逆向的独立成果**：它解释了为什么"反编译看起来干净，但所有数字与字符串都是
`<混淆类>.<方法>(N)`"。

### 5.1 外壳算法（observed，源自 `\uf55c\uf0ba\ue72b.\uf3e6\uf893\ue6d5(Stream)`）

```
托管资源字节流 raw:
  ┌───────────────────────────────────────────────────────────────┐
  │ UInt16 headerLen                                              │  2 B
  │ byte[headerLen] header                                        │
  │ byte ivLen; byte[ivLen] iv                                    │
  │ byte[] payload            （余下全部）                         │
  └───────────────────────────────────────────────────────────────┘

1) header[i] ^= iv[i % ivLen]                        // 逐字节 XOR，循环用 IV
2) 解析 header（BinaryReader）:
     string  marker          // 实测固定 11 字符："licF46B7B1E"
     byte    flags           // bit0 = 压缩(inflate)，bit1 = 加密(decrypt)
     byte    alg             // 1=DES 2=Aes 3=TripleDES 4=Rijndael 5=RC2 6=自定义 XOR
     byte    keySel          // < 64 → 密钥内联；>= 64 → 取自程序集公钥
     byte    keyLen
     if keySel < 64:  byte[keyLen] key          // 紧随其后，内联
     else:            key = assemblyPublicKey[keySel + 12 .. +keyLen]
3) if (flags & 2) != 0:  CryptoStream(payload, alg.CreateDecryptor(key, iv)) → body
   else                  body = payload
4) if (flags & 1) != 0:  body = Inflate(body)        // ★ 见 5.3
```

* **observed** 内置 inflater 是 `\uf55c\uf0ba\ue729` 的嵌套类 `\ue347`（Inflater，
  `byte[32769]` 窗口 + `\ue348` InputBuffer + `\ue349` OutputWindow + `int[19]` 码长表 +
  81920 B 拷贝缓冲），`\uf55c\uf0ba\ue729.\uf3e6\uf893\ue6d5(Stream, Stream)` 做循环拷贝。
  结构对应 .NET Framework 的托管 `System.IO.Compression.Inflater`。

### 5.2 `Gaea.Engine.dll` 的 4 个托管资源（observed）

| 资源名 | 原始大小 | header | flags | alg | keySel / keyLen | 内容 |
| --- | --- | --- | --- | --- | --- | --- |
| `IehNg` | 8 435 | 48 | `0x03` | 2 (AES) | 30 / 32（内联） | **字符串常量池**（已还原） |
| `ZyPox` | 1 371 | 48 | `0x01` | 2 (AES) | 31 / 32（内联） | **整型/浮点常量池**（未还原，见 §6） |
| `mesIQ` | 9 198 | 16 | `0x01` | 2 (AES) | 67 / 16（取自公钥） | 另一个池（未还原） |
| `CGRk` | 631 850 | 59520 | — | — | — | **不是**该外壳（`headerLen`/`ivLen` 无意义，marker 解析失败） |

* **observed** 程序集公钥 160 B（RSA-1024，强名签名），故 `keySel >= 64` 分支可用。
* **observed** 资源名本身由混淆类里的短字符串 XOR 常量生成，例如
  `\uf55c\uf0ba\ue713` 的 `string \uf3e6\uf893\ue6d5()` = `"\"\x01(\x17\0"` 每位 `^ 0x78` → `"ZyPox"`；
  `\uf55c\uf0ba\ue712` 的 = `"!\r\0&\x0f"` 每位 `^ 104` → `"IehNg"`。

### 5.3 inflate 变体：**跳过 2 字节后 raw deflate**

* **observed** `IehNg` 经 AES 解密后的前 2 字节被 inflater 当作头部消耗，
  真正的 raw deflate 从偏移 2 开始。等价实现：
  `new DeflateStream(new MemoryStream(body, 2, body.Length - 2), Decompress)`。
  （`ZLibStream` 因尾部校验不成立而失败；`raw deflate` 从偏移 0 失败。）
* **observed** 还原出的字符串池 = 16968 B，偏移 0 起是**连续的长度前缀字符串**
  （`BinaryReader.ReadString()`：7-bit 变长长度 + UTF-8）。
  首个条目是 31 字节的"垃圾串"，永不被引用；之后对齐。

### 5.4 字符串池的键公式（已实测求解）

```
loader: Dictionary<int,string> dict;
        while (stream.Position < stream.Length)
            dict.Add((int)stream.Position + A) ^ B, binaryReader.ReadString();
        // 反编译文本给出 A 的表达式 (-53877703 - -598490234 + -544612502) 与 B = --30605
```

* **observed** 手工按反编译表达式算得 `A=29, B=30605`，但与实测位置不符；
* **observed** 用 48 个真实调用点做联合求解，唯一最优解 **`A = 31`, `B = 30605`**（48/48 命中），
  随后在**全部 152 个**字符串池调用点上 **152/152 命中**。
* ⇒ 反编译文本里那个 `+` 运算链的化简有误差（混淆器把常量拆成了带陷阱的表达式），
  但 `B = --30605` 无误。**结论：不要手工化简混淆表达式，要做交叉验证求解。**

### 5.5 可复现命令

```powershell
# 列出托管资源
tools\GaeaPools\bin\Release\net8.0\GaeaPools.exe list  "D:\Gaea 2\Gaea.Engine.dll"
# 逐资源解码，写 res_<hex(name)>.bin
tools\GaeaPools\bin\Release\net8.0\GaeaPools.exe dump  "D:\Gaea 2\Gaea.Engine.dll" <outdir>
# 分类（int 池 / 字符串池 / 未知）
tools\GaeaPools\bin\Release\net8.0\GaeaPools.exe probe "D:\Gaea 2\Gaea.Engine.dll"
# 字符串池条目（位置<TAB>值）
tools\GaeaPools\bin\Release\net8.0\GaeaPools.exe strs  "D:\Gaea 2\Gaea.Engine.dll" IehNg
# 外壳头字段与 payload 前 24 字节
tools\GaeaPools\bin\Release\net8.0\GaeaPools.exe debug "D:\Gaea 2\Gaea.Engine.dll"
# 混淆整数表达式求值（32 位 unchecked）
tools\GaeaPools\bin\Release\net8.0\GaeaPools.exe eval  "-((-775936807 ^ 0x271B0CED) - -153409420) >> 6"
```

已产出并已应用：

* `evidence/decompiled/engine/pool_strings.tsv` —— 1020 条 `池索引<TAB>字符串`
* `evidence/decompiled/engine/deob/*.cs` —— 31 个反编译文件中 210 处字符串池调用被替换为字面量
  （其余标识符仍以 `\uXXXX` 转义形式保留，便于回指元数据）

---

## 6. 缺口与下一步

1. **整型/浮点常量池未还原**（资源 `ZyPox`，1304 B，`flags=0x01`，`keySel=31`，内联 32 B 密钥）。
   实测：外壳解出后，其 payload 在**任何偏移 0..512** 上都不是 raw deflate 或 zlib，
   也非 AES（1304 不是 16 的倍数），`xorIV` / `xorKey` / 自定义 XOR / 逐字节逆序变换全部失败。
   ⇒ inflater 对该资源有其它前置步骤，或该资源的 `flags` 语义与 `IehNg` 不同。
   建议两条路：
   * (a) 把 `\uf55c\uf0ba\ue729` 的 `\ue347` / `\ue348` / `\ue349` 逐方法 IL 与 .NET
     `System.IO.Compression.Inflater` 对照，找出被改动处（尤其是"2 字节头部"的读取条件）；
   * (b) 用 `tools/GaeaPoolReflect`（**已写好**）反射驱动目标自身的池加载器，
     直接读私有 `int[]/long[]/float[]/double[]` 与 `Dictionary<int,string>`。
     当前被 `Assembly.LoadFrom` 的依赖缺失挡住：
     `Babel.Licensing, Version=11.7.0.0, PublicKeyToken=138d17b5bd621ab7` 不在 `D:\Gaea 2`，
     需要先在磁盘上找到它（或其加载路径）。
2. `mesIQ`（9198 B）的内容用途 unknown。
3. `CGRk`（631 850 B）不是常量池外壳；`unknown` 其格式（可能是烘焙数据或压缩目录）。
4. `.gaea` 的容器/文件头 unknown（写出器不在 `Gaea.Engine.dll`）；
   本文件只证明了缓存 `.bin`/`.meta` 与导出裸数组的布局。
5. `.graw`（Gaea Pure Raw）与 `.r32` 在原始写出路径上共用同一重载；
   两者是否存在头部差异 **unknown**（若存在，代码应在 `Gaea.dll` 的导出包装层）。
6. 图像编码器的具体位深/色彩空间映射（`PixelType`/`CompressionType` 的实际取值）**unknown**——
   这些枚举来自 Magick.NET，不是 Gaea 自己的类型。
