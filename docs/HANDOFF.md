# 交接文档 — Gaea 全量算法级逆向

> 给接手的新会话。读这一份即可开始,不必重读历史。

---

## 0. 用户的要求(原始意图)

**对 Gaea 2.3.1 做"全量算法级"逆向,web 版实现。**

四项交付物:

1. **节点规范参考库** — 每个节点的参数、范围、默认值、语义
2. **算法还原文档** — 每个算法做什么、怎么做
3. **可运行的重实现代码** — `web/js/` 下的浏览器实现
4. **可复现分析工具链** — 从安装的 Gaea 重新生成以上一切的脚本

**当前进度:目录 182 个节点中有 93 个已实现算法(51.1%),其中 21 个 `exact`、30 个 `model`。**
本会话累计新增登记 20 个节点(73 → 93)。最近一批:Shaper 系列、Seamless、Repeat、Soil、Peaks、
Transpose(三模式)、Sharpen、**Contours**。所有 exact 节点都有 oracle 逐数值对拍。

---

## 1. 环境事实(先确认这些)

| 项 | 值 |
|---|---|
| 工作区 | `D:\sgames\gaea-rea` |
| Gaea 安装 | `D:\Gaea 2` |
| 版本 | Gaea 2.3.1 / .NET 8 / Unity 6000.3.12f1(视口内嵌 Unity) |
| Git HEAD | `3f917f8`(**用户自己的提交,禁止 `git commit`**) |
| 开发服务器 | `http://127.0.0.1:5174/`(`npx vite --host 127.0.0.1 --port 5174`;当前在跑) |
| Python | **`py -3.11`(Windows 原生)**。msys64 的 python 装不上 PyPI Windows wheel |
| .NET | 8.0.300 |
| Ghidra | 未使用;本项目的路线是 managed 反编译 + 运行时 oracle,不需要 Ghidra |

---

## 2. 硬约束(违反会出问题)

1. **禁止 `git commit`** — 用户自己提交。
2. **禁止按进程名 kill headless chrome** — 只按记录的 PID 关闭自己启动的。
3. **不必每实现一个节点就全量回归** — 跑针对性 suite 即可。
4. **少问,多做。**

---

## 3. 本轮最重要的新东西:**数值 oracle(这是质变)**

### 3.1 为什么

手工读 Eazfuscator 混淆后的 IL/反编译会得到"看起来合理"的猜测。最危险的一条:`\uf55c\uf0ba\ue6e5.\uf70f\ue6c9\ue2b3` 从用法上看像"应用曲线",实际有两个重载:

| 重载 | 语义 |
|---|---|
| `(float[] a, float[] b, int n)` | **逐元素相减 `a-b`**(不是曲线!) |
| `(float[] a, float curve, int n)` | **原地指数曲线**(Shaper 的传递函数) |

猜错不会崩,只会画出一张"合理但不对"的地形。**唯一可靠办法:让真实程序集自己算,再逐数值 diff。**

### 3.2 已建成的 oracle

`tools/gaea-probe` 新增 `oracle` 模式:

```bash
dotnet tools/gaea-probe/bin/Release/net8.0/gaea-probe.dll "D:\Gaea 2" \
       oracle tools/oracle-spec-exact.json evidence/oracle-exact.json
```

spec JSON 可以:

* `type` / `method` 支持 `uXXXX` 转义名(混淆名字),也支持普通名(`Profiles`、`Shaper`)
* `ret` 指定重载的返回类型(`Int32`/`Single`/`Double`/`Map`…)——**同名重载靠返回类型和参数类型自动选**
* 参数种类:`f32` `f64` `i32` `i64` `bool` `string` `enum` `null` `f32arr` `i32arr`
  `map`(支持 `data` / `gen` / `chans` 多通道)、`maps`、`res`(Resolution)、`f2`(Float2)、`ref`(引用前面 call 的结果)
* 返回:`Map`(含所有通道)、`Map[]`、数组、枚举、标量
* 支持 `calls: [...]` 一次跑多个调用

关键实现文件:`tools/gaea-probe/Oracle.cs`、`Overloads.cs`、`EngineTypes.cs`、`Json.cs`(允许 NaN/Infinity)。

### 3.3 验证方式

```bash
node tools/verify-exact.mjs      # 351 个数值用例:338 全过 + 13 例在已知近似界内(blur 边缘 / Repeat / Contours)
```

它把同一输入同时喂给"真实 Gaea"和"JS 移植",逐 float 比较。**只有 maxAbsDiff ≤ 2e-4 才算通过。**

---

## 4. 常量池(上一轮成果,已复核)

* 探针 `scan` 解密各程序集的 int/long/float/double 池 → `evidence/pool_<asm>_<kind>.json`
* `tools/probe-pools.mjs` **通过真实访问器** `\ue713.\uf3e6\uf893\ue6d5(N)` 复核:访问器就是 `数组[N]` 直取,字段转储与访问器一致
* **重载选择决定取哪个池**:同一个 `\ue6d5(N)` 在 float 上下文取 float 池、int 上下文取 int 池、double 上下文取 double 池。
  例:曲线里的 `\ue6d5(11)` 是 float[11]=1f;而 `Math.Abs(...) < \ue6d5(29)` 因有 `(double)` 转换取 double[29]=1e-5。
* 节点侧源码 `evidence/decompiled/Gaea.Nodes.resolved.cs` 已把 `\ue0003.\ue001/\ue002/\ue003(N)` 全部解成数字(15,013 处,零残留)
* **引擎侧**源码 `evidence/decompiled/Gaea.Engine.whole.cs` 是未解常量的整模块反编译(新生成,2.2 MB)。查 obfuscated helper 的实现就看这份。

---

## 5. 本轮已确认的精确语义(全部有数值对拍)

| 语义 | 来源 | 结论 |
|---|---|---|
| `Blur(array, N, radius, iterations)` | `\uf55c\uf0ba\ue6dc` | 分数半径 box blur:R=floor(radius), F=frac;每轮先横后纵,共 `iterations` 轮;权重 `1/(2R+2F+1)`;越界复制边缘 |
| 指数曲线 | `\uf70f\ue6c9\ue2b3(float[],float,int)` | `t=(v-min)/(max-min)`, `v'=((exp(t*c)-1)/(exp(c)-1))*(max-min)+min`;range<1e-5 跳过 |
| 成对减 / 加 | `\ue2b3(float[],float[],int)` / `\ue2b4` | 逐元素 `a-b` / `a+b` |
| `Profiles.Shaper` | 全量样板 | 见 `web/js/kernel/gaea-exact.js`;**300 用例全过** |
| `Normalize(map,a,b,outA,outB)` | oracle 实测 | `a→outA, b→outB` 线性,**不外扩截断**(ramp 0..1 + (0.2,0.8,10,20) → 6.67..23.33) |
| `map.Autolevel()` | oracle 实测 | min→0, max→1 |
| `\ueb77\uf21d\ue95e(map,a=0,b=1)` | oracle 实测 | `clamp(v,a,b)-a`(Bias 式下移+封顶) |
| `Others.SmoothedMedianBlur` | oracle 实测(512) | `half=size/2*(width/512)` **整数除法**;整行复用同一个窗口缓冲区、整块排序、取 `sorted[len/2-1]` 与 `sorted[len/2+1]` 的平均;**越界未写入的残留值参与排序**——照抄这点边界才对 |
| `Masking.Mask(a,b,m)` | 源码 | `a*(1-m)+b*m` |
| `Combiner.Mix` | `MathV.Mix` | `a*(1-t)+b*t`;枚举值由包装函数钉死:Blend0 Add1 Screen2 Subtract3 Difference4 Multiply5 Divide6 Divide2 7 Max8 Min9 |
| 标量扩展 | `\uf55c\uf0ba\ue6c1` | `\ue792(int)→Resolution`、`\ue792(int)→float = x/2`、`\ue793(float)=x*0.5`、`\ue798(float)=x*0.1`、clamp(x,0,1) 等 |
| 渐变 | `Gradients.*` | Linear 用 `-sin/cos` 与 `0.017453292f`;Radial/Cone/Hemisphere 公式见 `gaea-fields.js`;**LinearGradient 必须用 float32 逐步 round**,否则 Repeat 边界差一整个 1.0 |
| 折叠 / 旋涡 / Shape / HSL | `Profiles.Sine/Triangle/Sawtooth`、`Others.SwirlHeightfield`、`Shape.Generate*`、`ColorCore.ModifyHSL` | 全部实现在 `web/js/kernel/gaea-fields.js`,oracle 全过 |

| `Map.Blur`(原生) | 冲激+斜坡实测 | 可分离、归一化、边缘规则未完全复原;**百分比入口半径 = value/40*N**;核为实测数据表 |
| `Mosaic.Seamless` | 源码+oracle | 水平/垂直两次 shift 混合,`Smoothstep=6x^5-15x^4+10x^3`;`Channel[x,y]` = `y*N+x`(别转置) |
| `Mosaic.Repeat` | 源码 | 先 `Resize(HighQuality)` 缩到 ceil(N/tiles),再整数对齐 `Insert(Add)` 平铺;Resize 未移植 → model |
| `Profiles.GraphicEQ` | 源码+oracle | 7 段:半径 N/10 起、按 log52/log5 递增的 blur 差分,band7 为残差;内部对拍 8e-3 |
| `Texturize.Soil2` | 源码+oracle | 5 次递增 blur 的差累加后 autolevel;内部对拍 2e-2(边缘放大) |

| `FilterCore.FilterProcess` | 源码+oracle | 模糊差分滤波器组:半径 `(1-f*0.9999)*N*0.25`;LowPass/HighPass/LowShelf/HighShelf 已对拍通过,BandPass/Notch 受 blur 边缘模型影响(2e-2 内) |
| `AspectMaps.GetThreshold` | 源码 | `v > threshold ? 1 : 0`(另有 < / 区间两个变体) |
| Map 运算符 | Fx.Map.cs | `+`/`-`/`*` 都是逐元素(Add/Subtract/Multiply),不是混合模式 |
| `Map.Flip()`(`\ueb77\uf21d\ue95d()` 无参) | oracle | **水平镜像**,不是取反!(ramp 上两者恰好等价,曾据此误判) |
| `Map.Autolevel()` / `.Drop()` / `.Invert()` | oracle | 分别是 min/max→0..1、减基线截断、1-v |
| `Combiner.Transpose` | oracle | 参考图先 `FilterProcess(0.75, gain0, LowShelf)` 再 drop,按 Amount 加进地面,最后把新范围映回原 min/max — **已逐值通过** |

| `Map.Flip()` 无参 = 水平镜像;无参 `uE95E` = "min<0 则上移" | oracle | 两者在 ramp 上都酷似取反/Drop,必须用非对称或有符号范围的图才能区分 |
| `AspectMaps.GetCurvature` | 源码+oracle | 有限差分 + 三种曲率(H/V/Average),注意 `max=Max/2` 而 `min=Min` 不除以 2;精确(2e-6) |
| `Sharpen` | 源码 | Edge = `map + GetCurvature(0,1,0.2,Vertical)*0.008*Amount`;Frequency = GraphicEQ 顶带 +Amount |

| `XorShift64Star` | 常量池 | 参数精确:步进 `>>12,<<25,>>7`、乘数 `2685821657736338717`、`nextFloat=(x*M>>24)*2^-40`、seed=0 用默认常量 |
| `Profiles.Terrace` | 源码 + oracle | 10 轮边界抖动 + smoothstep 分档;与随机流一起验证(2e-5) |
| `Morphology.DilateCross` | 源码 + oracle | van Herk 分段 max-filter,两次 transpose 得到十字膨胀;逐值一致(1e-6) |
| `Cartographer.Contours` | 源码 + oracle | 两级 terrace + 曲率 + Max + 膨胀;但**极小半径 blur** 仍为模型 → 标 model |

---

## 6. 代码结构(新增部分)

```
web/js/kernel/gaea-exact.js     精确数学:stats/blur/curve/pair/remap/Profiles.Shaper
web/js/kernel/gaea-fields.js    精确生成器:Linear/Radial/Cone/Hemisphere/Fold/Swirl/Shape/HSL
web/js/kernel/gaea-combine.js   精确合成:Combiner.Mix 全模式/Mask/Normalize/Autolevel/Median/RGB
web/js/kernel/gaea-mosaic.js    精确平铺:Resize(LinearFast)/Insert(Add)/Mosaic.Repeat/Seamless
web/js/kernel/gaea-filter.js    FilterCore.FilterProcess(7 模式)+ Combiner.Transpose/Embed/Insert(全部验证)
web/js/kernel/gaea-aspect.js    AspectMaps.GetCurvature / GetThreshold
web/js/kernel/gaea-random.js    XorShift64Star 精确移植(所有带 Seed 节点的底座)
web/js/kernel/gaea-terrace.js   Profiles.Terrace(精确)
web/js/kernel/gaea-morphology.js Morphology.DilateCross(精确)
web/js/kernel/gaea-cartographer.js Cartographer.Contours / Outline
web/js/kernel/gaea-blur.js      原生 Map.Blur 的模型:分离卷积 + 实测核 LUT + 混合边缘规则
web/js/kernel/blur-kernel-data.js  GENERATED:原生 blur 的可分离 1D 核(92 个半径)
web/js/kernel/gaea-exact.js     追加:graphicEQ / soil2(基于 blur)
web/js/kernels/profiles.js      节点层包装(ctx → 上面这些),全部标注 exact/approx
web/js/registry.js              注册表;本轮新增:
                                Shaper, LinearGradient, RadialGradient, Cone, Hemisphere,
                                HSL, Fold, Swirl, Shape, Median, Compare, RGBMerge, RGBSplit
tools/verify-exact.mjs          300 个 oracle 数值对拍用例
tools/analyze-pending.mjs       生成 docs/node-workbreakdown.json(按共享 helper 分组)
tools/probe-helpers.mjs         探 helper 语义(blur/pair/curve)
tools/probe-pools.mjs           用真实访问器复核常量池
tools/probe-range.mjs           探 Normalize/Autolevel/clamp 语义
```

---

## 7. 还没做的活(按杠杆排序)

`py -3.11 tools/list-pending-nodes.py` 会刷新 `docs/node-pending.json`(当前 96 条)。
`node tools/analyze-pending.mjs` 会把剩余节点按**共享 helper** 分组(`docs/node-workbreakdown.json`)。

### 7.1 最大杠杆:**移植 FastNoise(FNSIMD)**

约 **30+ 个剩余节点**依赖 `FNSIMD`(`Gaea.Nodes.dll` 里 68 处 `[DllImport("FastNoise")]`):

* `RawNoise.Perlin / Voronoi / MultiFractal / Gabor / Cellular` → `Noises.*`
* 进而解锁:`Mountain` / `MountainRange` / `Ridge`(→ `Uplift`、`Slump`、`Stones`、`Wizard` 部分)、
  `Plates`、`DuneSea`、`Sand`、`WaveShine`、`DriftNoise`、`Gabor`、`LineNoise`
* FastNoise 是公开库(Jordan Peck / Auburn),FNSIMD 是其 SIMD 版;**同一 API 的标量实现可复刻**,
  然后用 oracle 对 `Noises.Perlin(...)` 逐值校验(seed/frequency/axisScales/octaves/noiseType 全可控)。

**做法建议**:先 oracle `RawNoise.Perlin` 的小分辨率输出,逆向出 hash/梯度/插值;
再实现 JS;再 `verify-exact` 加 20+ 用例。这是接下来投入产出比最高的一块。

#### 7.1 状态(已完成 Perlin 标量内核)

`web/js/kernel/fastnoise.js` 已移植 FastNoiseSIMD 的标量 Perlin,`Perlin` 节点
(`generators.js` → `perlinNode`)已改接该内核。用 `tools/gaea-probe` 对
`RawNoise.Perlin` 取了 13 组 16² 网格(不同 Scale/Seed/Octaves/Gain/Type/轴缩放),
逐值误差 ≤ 3e-7,金值固化在 `web/tests/gaea-fastnoise-test.mjs`。

已确认的事实:

* hash `seed ^ 1619x ^ 31337y ^ 6971z`,再 `h*h*h*60493`、`(h>>>13)^h`;
* 五阶 fade、三线性 lerp、16 项梯度表(12–15 项由 oracle 逐格解出);
* 每倍频 `seed+i`、`f*=2`、`amp*=gain`,末乘 `1/Σgain^i`;billow `2|n|-1`,ridged 取其负;
* 坐标 `((i,y)/R + offset*wavelength/R - 0.5)*R`,频率 `(1-Scale)*0.01*(512/R)`,
  `offset = (X, Y)` 以噪声空间单位相加;节点层 Ridged = 反转 Billowy。

**仍未解决**:`WarpType Simple/Complex` 的梯度扰动。试过三轴独立 Perlin、Value、
最近格点梯度、z 偏移以及 perturbFrequency/幅度扫描,误差始终 ≥ 0.30,故只做结构移植,
`Perlin` 节点标注为 "exact (warp approximate)",测试对 Warp 只断言确定性/有限/非退化。
下一步是用同一 oracle 对 `RawNoise.Voronoi`(`SetNoiseType(7)`、cellular lookup)取金值,
再决定是否先绕过扰动接线 Voronoi。

#### 7.1.1 状态(已完成 Voronoi/Cellular 标量内核)

`web/js/kernel/fastnoise.js` 已移植 FastNoiseSIMD 的标量 Cellular,`Voronoi` 节点
(`generators.js` → `voronoi`)已改接 `fnVoronoiGrid`。用 oracle 对 `RawNoise.Voronoi`
取 25 组 16²/64² 网格(三种距离函数、八种 Form、jitter 0/0.45、多种 seed、四个方向的一格偏移、
非整数波长),逐值误差 ≤ 2.2e-5,金值固化在 `web/tests/gaea-voronoi-test.mjs`。

已确认的事实:

* DLL 内枚举顺序与上游 FastNoiseSIMD 不同:`WhiteNoise = 6`、`Cellular = 7`(故 `SetNoiseType(7)`);
* Cellular hash **没有** Perlin 的 `(h>>>13)^h` 折叠:`h = ((seed ^ 1619x ^ 31337y ^ 6971z)^3) * 60493`;
* `ValCoord3D = h / 2^31`(有符号 int 直接重解释,范围 [-1,1));Form C 返回 `0.5 + 0.5*ValCoord(最近单元)`;
* 抖动点是**单位向量 × Jitter**:方向由 hash 的三段 10 bit `(h&1023)/511.5-1`、`((h>>>10)&1023)/511.5-1`、
  `((h>>>20)&1023)/511.5-1` 归一化;实测 `|p| = Jitter`(jitter 0.45 时中心距离² 恒为 0.2025);
* 距离:Euclidean `dx²+dy²+dz²`,Manhattan `|dx|+|dy|+|dz|`,Natural `(|dx|+|dy|+|dz|)·(dx²+dy²+dz²)`;
* Form → ReturnType:`C→0`、`N→7`、`R→1`、`P→2`、`A→3`、`S→4`、`M→5`、`D→6`;
  `R=d1`、`P=d2`、`A=d1+d2`、`S=d2-d1`、`M=d1·d2`、`D=d1/d2`;采样后统一 `0.5+0.5*v`(可 >1);
* 采样 frame 与 Perlin 相同,但频率是 `Scale*0.01*(512/R)`(不是 `1-Scale`),`SetAxisScales(W,Z,1)`;
* 节点 `Build`:`Noises.Voronoi(res, Scale, Function, Form, Gain, WarpType, Frequency, Amplitude,
  WarpOctaves, Seed, 1-X, Y, ScaleX, ScaleY, Jitter)`;`Gain` 未传入 `RawNoise`(无效),
  `Clamp < 1` 时整体乘 `Clamp`。节点默认 `Scale=0.5、Jitter=0.45、Form=P、WarpType=Complex、
  Frequency=0.05、Amplitude=0.5、WarpOctaves=14、X=Y=0.5`。

**仍未解决**:

* Form C 在 jitter ≥ 0.85 时,恢复出的方向公式与 Gaea 的差值足以翻转"最近单元"的**近似平局**
  (jitter=1 的 16² 网格中 256 个像素错 1 个,最大误差 0.13);距离类输出不受影响。
* Form N(NoiseLookup)需要 PerlinFractal lookup 频率(节点设为 `Scale*(512/R)`),尚未实现。
* Warp Simple/Complex 与 Perlin 同源,仍是结构移植,未做金值校验。
* 节点层还有两个混淆后处理(`\ueb77\uf21d\ue961()`、`\ueb77\uf21d\ue95f()`),按"归一化到 [0,1]"
  建模(先归一化再乘 `Clamp`,与反编译里的调用顺序一致);若后续发现它们不是归一化需要再校正。

### 7.2 原生 blur(已大体解决,边缘仍为模型)

`Map.Blur` 是 P/Invoke,但它的行为已经测出来了:

* **可分离**(冲激响应满足 `p11*p00 == p10*p01`,到 float32 精度精确)
* **归一化 + 边缘**保持常数
* 百分比入口 `map.Blur(value)` 的换算:**radius_px = value / 40 * resolution**(40 就是 float 池里那个歧义常量)
* 核形状**不是普通高斯**,尾部衰减更快,所以以数据表形式保存(不是公式)
* 生成链:`node tools/build-blur-lut.mjs` → `web/js/kernel/blur-kernel-data.js`(24 KB,92 个半径)
* 现状:**内部精确(1.7e-4),边缘是 clamp/mirror 各半的模型(最坏 2.7e-3)**;`Soil`/`Peaks`/`GraphicEQ` 因此标 `model`

**仍未解释**:支撑半径在 p≈2/4/8/12 处跳变,且边缘响应既非 clamp 也非 mirror。
最可能的解释是**大半径时先下采样→小核 blur→上采样**(那样内部线性不变、边缘由 resize 规则决定)。
若要继续追边缘:验证"下采样因子随 p 分档",并复刻 HighQuality resize。

### 7.3 原生侵蚀

`Erosions.PE` / `Classic` / `Thermal2` / `Hillify` 走 `Gaea.Native.dll` 的 SYCL kernel
(已有 `evidence/kernels/` 与 `docs/gaea-erosion-kernel-recovered.md` 的部分情报)。
`web/js/kernels/erosion.js` 是近似实现;要精确需要按已有 SPIR-V/SYCL 逆向继续。

### 7.4 纯 CPU、只差翻译的(可以立刻做)

| helper / 类 | 剩余节点数 | 依赖 |
|---|---|---|
| `Combiner.Max/Min/Screen` + `Masking.Mask` | ~15 | 已有 `gaea-combine.js`,只差逐个 Build 抄 |
| `Warps.FractalWarp` | 7 | 依赖 RawNoise(见 7.1),但骨架可先写 |
| `Profiles.ComplexTerraces/FractalTerrace/Terrace` | ~6 | `XorShift64Star` + 纯数学,已可读;`Warps.FractalWarp` 是唯一噪声依赖 |
| `AspectMaps.GetThreshold/GetCurvature/GetSlope/GetHeightNormalized` | ~14 | 纯差分/直方图,可读 |
| `Morphology.DilateCross` + `AspectMaps.GetCurvature` + `Profiles.Terrace` | Grid/Contours ≈2 | 纯 CPU;DilateCross 是分段 max-filter,较长 |
| `Combiner.Embed/Insert` | Transpose 的另两个模式 | 已移植但数值仍不符(见 9 踩坑);需重新核对 body |
| `Landscapes.Craterfield`(CraterfieldGenerator) | 3 | 纯 CPU 随机坑,可读 |
| `Texturize.Soil2` | 3 | 需要 7.2 的 blur |
| `RGBMerge/RGBSplit/Median/Compare` | 已完成 ✅ | — |

### 7.4b 已解决:Combiner.Embed / Insert(本轮)

之前差 0.2~0.9 的两个原因都已定位,现在**逐值通过**:

1. `Map` 无参 `\ueb77\uf21d\ue95d()` 是**水平镜像**,不是取反(ramp 上二者等价,是假阳性);
   Embed 用它镜像参考图。
2. Embed 末尾的无参 `\ueb77\uf21d\ue95e()` **不是 Drop**,而是"若 min<0 则整体减去 min"(上移)。
   用 -1..0 / -0.5..0.5 / 0.5..1.0 / 0.1..0.3 四种范围的图探测才区分开。
3. Insert 里 `Profiles.GraphicEQ` **没有** autolevel 调用——之前多写了一步。

顺带确认:`shiftClamp(a,b)=clamp(v,a,b)-a`(4e-8 内)、`Map` 的 `+ - *` 都是逐元素。

### 7.4c 仍未解决的疑点:HighQuality resize

`Mosaic.Repeat` 精确化与 `Grid`/`Contours` 都卡在 `Transformer.Resize(..., HighQuality)`。
已定位到:选项结构 `\ue69f\ue387\uf867`(`bool` 缩放标志 / `float a` / `float[] LUT`)、
四个静态预设 `\ue872\uf650\ue1a0..a3`(Engine.whole.cs:25582-25588)、权重 LUT 生成函数与
采样器(26252-26290)。还差:int 池 `const(21)` 的实际值、以及 `<>c.<>9.\uebbd\uf03d\uecb3..b6`
这几个 `Func<float,float,float>` 的核公式(疑似 cubic-convolution / Lanczos 两种)。
**建议下一步**:直接 oracle `Transformer.Resize(map, res, HighQuality)` 的一维冲激响应,像 blur 那样
用数据表复刻,而不是继续猜常量。

### 7.4d 剩余节点的解锁分析(本轮实测)

用 `docs/node-workbreakdown.json` 交叉"已实现原语集合",剩余 89 个待办里**只有 1 个**是纯 CPU 可直译的
(Sharpen,已做);其余都缺一个关键原语,按缺口分组:

| 缺口 | 涉及节点 |
|---|---|
| `RawNoise.*` / FNSIMD | MountainRange、Plates、DuneSea、Sand、Uplift、LineNoise、DriftNoise、Gabor、WaveShine、SatMap …(约 30) |
| 原生侵蚀(SYCL) | Erosions.PE/Classic/Thermal2/Hillify、Wizard/Wizard2 |
| `Landscapes.Craterfield` / 仿真 | Stones、Scatters.Bomb、Crumble、Anastomosis、Rivers |
| `Profiles.ComplexTerraces` / `Cartographer.*` | Stratify、Contours、Grid |
| `SyclFunctions.Cellular3D` | IceFloe |
| 其它单点 | Distress(GetCanyon+Recurve)、Weathering(ColorTransport)、Mesher(3D) |

### 7.5 结构性/UI 节点(建议明确跳过)

`LoopBegin/LoopEnd/MacroPort/Reseed/Switch/Match/Mixer/Object/PointCloud/Meshify/Draw/Synth/Layers/Meshify/Sunlight/LightX/AO/ColorThreshold/Heal/HydroFix`
—— 要么是图控制语义(web 版 DAG 不需要),要么依赖灯箱/位图/原生。

---

## 8. 工具链

```bash
# 常量池(升级 Gaea 后重跑)
dotnet tools/gaea-probe/bin/Release/net8.0/gaea-probe.dll "D:\Gaea 2" scan
py -3.11 tools/resolve-constants.py          # → evidence/decompiled/Gaea.Nodes.resolved.cs

# 整模块反编译引擎侧(拿到 blur/曲线/工具类干净源码)
dotnet build tools/GaeaDump/GaeaDump.csproj -c Release
tools/GaeaDump/bin/Release/net8.0/GaeaDump.exe whole "D:\Gaea 2\Gaea.Engine.dll" > evidence/decompiled/Gaea.Engine.whole.cs

# 数值 oracle
node tools/verify-exact.mjs                  # 300 用例,必须全过
node tools/probe-helpers.mjs                 # blur / pair / curve 语义
node tools/probe-pools.mjs                   # 常量池访问器复核
node tools/probe-range.mjs                   # Normalize/Autolevel/clamp
node tools/probe-blur.mjs                    # 原生 blur 冲激响应
node tools/probe-blur-percent.mjs            # 百分比换算 + 边缘规则
node tools/build-blur-lut.mjs                # 重建 web/js/kernel/blur-kernel-data.js
node tools/smoke-new-nodes.mjs               # 新增节点的最小求值冒烟(18/18)

# 待办分析
py -3.11 tools/list-pending-nodes.py
node tools/analyze-pending.mjs               # docs/node-workbreakdown.json

# Web 验证(开发服务器 5174 需在跑)
node tools/verify-headless.mjs --url=http://127.0.0.1:5174/   # 18 项,应 PASS
node tools/web-import-check.mjs
```

**已知假阳性**:`verify-3d.mjs` / `verify-three.mjs` 的 "x% lit" 断言是错的(WebGL 未开
`preserveDrawingBuffer`,帧后被清空)。**看截图,别信这条。**

---

## 9. 踩坑清单(新增)

| 坑 | 教训 |
|---|---|
| 按参数个数选重载 | `\ue2b3` 两个重载参数个数相同;必须按**参数类型 + 返回类型**选(已由 `Overloads.Pick` 处理) |
| float64 算渐变 | LinearGradient 的 Repeat 边界,double 下 0.9999999 不翻转、float32 下等于 1 会翻转;必须逐步 `Math.fround` |
| 中值滤波"清理"边界 | 原生实现复用每行缓冲区、整块排序、越界残留值参与排序;把它写"干净"后边界差 0.5 |
| `buf.slice(0,k).sort()` | Float32Array 的 `sort()` 是数值排序;`Array.prototype.sort` 才是字典序 |
| oracle JSON 里 NaN | System.Text.Json 默认拒 NaN;已开 `AllowNamedFloatingPointLiterals` |
| 4×4 输入触发内部 chunk bug | Gaea 的 stats/autolevel 在极小分辨率会越界;oracle 测试用 ≥16 |
| 用单侧和归一化核 | 冲激响应的 1D 核必须除以**双侧和**(u0+2Σu);用单侧和会让 blur 亮 2.4 倍,真实图像对拍立刻暴露 |
| 用 ramp 推断单目算子语义 | ramp 上「水平镜像」和「取反」结果一样(1-x),据此把 Map.Flip 误判成 Invert;要用非对称输入(hills)才能区分 |
| 二维卷积核当 1D 用 | 原生 blur 的边缘既不是 clamp 也不是 mirror;先测冲激/斜坡再定规则,别猜 |
| 局部变量遮蔽参数助手 | `const N = ctx.size` 把 `N()` 取参助手遮住,5 个渐变/Shape 内核直接 throw;只有 `smoke-new-nodes.mjs` 抓到,headless 的 demo 图不含这些节点 |
| `list-pending-nodes.py` 的计数 | 与 registry 条目数不是同一口径;报进度时用 "registry 96 / catalog 182" |

---

## 10. 建议的第一步

1. `node tools/verify-exact.mjs` —— 331 全过 + 10 例已知近似(blur 边缘 6、Repeat 4)
2. `node tools/smoke-new-nodes.mjs` —— 17/17
3. `node tools/analyze-pending.mjs` —— 剩余 90 条的分组(见 7.4d)
4. 下一批建议(按性价比):
   * **HighQuality resize 用冲激响应数据表复刻**(7.4c)→ `Mosaic.Repeat` 精确 + `Grid`/`Contours`
   * **FastNoise/FNSIMD 用 oracle 反推**:先 `RawNoise.Perlin` 在 N=2/4 的高倍缩放下取网格点,
     反推 hash/gradient LUT,再逐字段拟合 fractal/perturb 参数;这是最大一块(约 30 节点)
   * **`Profiles.ComplexTerraces`** → Stratify(单一缺口)
   * `Cartographer.Contours/Grid` 的 builder 本来就不难,只等 resize/Terrace
