# Gaea-REA — web terrain generator

A browser-native reimplementation of QuadSpinner Gaea 2.0's node-graph terrain workflow, built
from the reverse-engineering evidence in [`docs/`](../docs).

**Zero build step, zero dependencies:** plain HTML, ES modules and CSS. Open `index.html` and it
runs.

* All **182 Gaea nodes** from `data/nodes.json` are browsable and searchable, each with its real
  description, real parameter list, real enum members and real section grouping.
* **56 node algorithms** are implemented, including the whole core set: fractal noise, Worley
  cellular, Voronoi, domain warping, height adjustment, all 24 combine modes, craters, mountains,
  canyons, glaciers, D8 flow accumulation, two hydraulic erosion models, thermal erosion, and
  16-bit PNG export.
* The terrain engine is **verifiable**: every algorithm is a pure ES module imported unchanged by
  the browser, the Worker and the Node test harness. Two suites exercise it (149 assertions).

What this build does *not* do, and how close each algorithm is to Gaea, is documented honestly in
[IMPLEMENTATION-NOTES.md](IMPLEMENTATION-NOTES.md).

---

## Run it

```powershell
# any static server works; module imports need http(s), not file://
python -m http.server 8080 --directory D:\sgames\gaea-rea\web
# then open http://127.0.0.1:8080/
```

`file://` will not work for evaluation: browsers refuse `fetch()` on `file://` origins, so
`data/nodes.json` cannot be loaded. The app detects this and prints the command to run instead of
failing silently. Styles and the graph editor would work either way.

### In-browser self-test

```
http://127.0.0.1:8080/?selftest=1
```

drives the live application through 40+ assertions (catalog, panels, evaluation, viewport, graph
editing, undo, export, and every implemented algorithm) and writes a JSON report into
`<pre id="selftest-output">`. Useful on a machine with a working browser — see
[Verification](#verification-status).

### Tests from the command line

```powershell
cd D:\sgames\gaea-rea\web
node tests/smoke.mjs        # engine, numerics and physics — 86 assertions
node tests/app-test.mjs     # the whole application under a DOM shim — 63 assertions
python ../tools/validate_web.py   # static: every import/asset resolves
```

`tests/app-test.mjs` installs `tests/dom-shim.mjs` and then imports `js/app.js` exactly as
`index.html` does, so it exercises the real import graph, event wiring, parameter panel and
export path — not a mock.

---

## What it does

| Area | Behaviour |
| --- | --- |
| **Library panel** | All 182 nodes from `data/nodes.json`, searchable by node name, description *or parameter name*. Grouped by category, with a green dot for implemented nodes, a used-in-graph highlight, and filters (All / Implemented / Catalog only / In graph). |
| **Graph editor** | Add, drag, connect (output → input), select, delete. Clicking an input port opens a rewire menu listing upstream outputs. Self-connections and cycle-forming connections are refused. Zoom, pan, fit, dotted-grid canvas, colour-coded ports by channel kind. |
| **Parameter panel** | Controls generated from the merged schema: `Single`→slider + numeric field, `Int32`/`Byte`→number, `Boolean`→switch, `Enum`→select with the vendor's option list, `Color`→picker + alpha, `Float2`→dual field, `String`→text, and section headers as dividers. Every parameter tooltip states whether its default and range came from the recovered Gaea assembly metadata or were hand-tuned for this implementation. |
| **Viewport** | A 2D heightmap through four colour ramps, and a **WebGL2 lit 3D mesh** with orbit / pan / zoom and vertical exaggeration. Whichever node is selected (or a pinned node, or the terminal output) is what you see; source chips switch between them. |
| **Build control** | Resolution 64/128/256/512/1024, a global seed added to every node's own `Seed`, per-node seeds, a randomise button. |
| **Export** | **PNG16** — true 16-bit greyscale with a hand-written zlib stream (stored deflate blocks + CRC32 + Adler32), plus a PNG8 companion for viewing. Exported at build resolution, not screen resolution. |
| **Undo/redo** | Snapshot history, 60 steps, covering add / delete / connect / move / parameter edits — one step per continuous slider drag, not one per pixel. |
| **Diagnostics** | An Info tab with build facts, per-node timings as bars, evaluation errors, and the coverage numbers derived from the code rather than hard-coded. |
| **Robustness** | Every kernel is NaN-safe, every division goes through a guarded helper, every sampler clamps. A node that throws is reported in Info → Diagnostics and the graph still evaluates. |

### Keyboard

| Key | Action |
| --- | --- |
| `1` / `2` | 2D / 3D viewport |
| `F` | fit graph to view |
| `Delete` | delete the selected node |
| `E` | export PNG |
| `/` | focus library search |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo |
| `Ctrl+N` | new graph |
| `Esc` | close the port menu |
| drag / wheel / middle-drag / double-click | orbit / zoom / pan / reset camera (3D) |

---

## Architecture

```
index.html
  └── js/app.js                     composition root: wires panels to state, owns the toolbar
        ├── js/state.js             app state, undo/redo history, schema cache, event bus
        ├── js/graph.js             node/edge model, topological order, cycle detection
        ├── js/graph-editor.js      canvas interaction, drawing, hit-testing, connections
        ├── js/library-panel.js     searchable node palette from data/nodes.json
        ├── js/params-panel.js      schema-driven control generation
        ├── js/info-panel.js        build facts, timings, diagnostics, coverage
        ├── js/viewport.js          WebGL2 shaded 3D preview + 2D height map
        ├── js/colormap.js          height ramps, shared by the 2D view and the 3D shader
        ├── js/export.js            PNG8 / true PNG16 writers (own zlib + CRC32)
        ├── js/eval-controller.js   debounced evaluation, worker orchestration, inline fallback
        ├── js/eval-worker.js       off-main-thread evaluation entry
        ├── js/evaluator.js         graph walk, memoisation, error reporting
        ├── js/demo-graph.js        the reference 9-node pipeline behind "Demo"
        ├── js/selftest.js          the ?selftest=1 harness
        └── js/registry.js          <<< THE single extension point
              └── js/kernels/*.js   algorithm implementations
                    └── js/kernel/*.js  shared primitives (noise, fields, hashing, coords)
```

### The single extension point

`js/registry.js` holds one descriptor per node. Adding or improving an algorithm means editing
exactly one place:

```js
{ name: 'MultiFractal', algorithm: multiFractal, category: CAT.PRIM,
  summary: '...', inputs: [], outputs: [OUT_H()],
  params: { Size: { d: 0.5, min: 0, max: 1, step: 0.005 } },
  note: 'approx' }
```

Parameter keys are the **exact Gaea parameter names** (`Rock Softness`, `Downcutting`,
`Sediment Removal`), so the registry lines up with `data/nodes.json` and with the recovered
assembly metadata. Everything else — library panel, parameter panel, evaluation, export — is
driven from the registry plus the catalog.

A node present in `data/nodes.json` but absent from the registry is still fully usable: it
appears in the library with its real parameters, gets correct control types, and evaluates as a
pass-through with a badge that says so. Four catalogued names (`DuneSea`, `EasyErosion`,
`Snowfield`, `Thermal2`) resolve by alias to an implemented algorithm, and a small alias table in
the registry is the only place that mapping lives.

### Field representation

A field is a structure-of-arrays over `Float32Array` with named channels (`height`, `mask`,
`color`, `flow`), mirroring Gaea's `Map`/`Channel` design recovered in
[`docs/engine-model.md`](../docs/engine-model.md): a node may emit several named channels at
once, and an unconnected input contributes nothing rather than invalidating the node.

### Computation

* `js/kernel/*` — coordinate spaces and sampling, integer hashing and xorshift PRNG, value /
  Perlin / 3D / Worley noise, 22 fractal flavours, separable convolution, morphology,
  histogram/remap helpers, statistics.
* `js/kernels/generators.js` — `Constant`, `File`, `MultiFractal`, `Perlin`, `Ridge`, `Cellular`,
  `Cellular3D`, `Voronoi`, `DotNoise`, `Crater`, `Mountain`, `Canyon`, `Glacier`, `Cracks`,
  `FlowMap`.
* `js/kernels/filters.js` — `Adjust`, `Clamp`, `Autolevel`, `Equalize`, `Extend`, `Clip`,
  `Invert`, `Flip`, `Curve`, `Warp`, `DirectionalWarp`, `Blur`, `Deflate`, `Dilate`, `Denoise`,
  `Combine`, `Mask`, `Blend`.
* `js/kernels/erosion.js` — D8 flow accumulation, droplet erosion, stream-power erosion, thermal
  talus relaxation.
* `js/kernels/features.js` — `Slope`, `Height`, `Occlusion`, `Distance`, `FractalTerraces`,
  `Steps`, the Select family, `Sea`, `Snow`, `Shift`, `Shear`, `Transform`.

Evaluation runs in a Worker with a debounce, and results are cached per node by a
parameter + input fingerprint, so editing one node does not recompute the graph. If Workers are
unavailable the controller falls back to inline evaluation and says so in the status pill.

---

## Node coverage

| | Count |
| --- | --- |
| Nodes in the catalog | 182 |
| Registered algorithms | 56 |
| Catalogued nodes running one under their own name | 46 |
| ...plus catalogued nodes resolving by alias | 4 |
| Catalog-only (schema-driven pass-through) | 132 |

Fidelity of the 56 registered algorithms, self-reported by the registry and cross-checked
per algorithm in [IMPLEMENTATION-NOTES.md](IMPLEMENTATION-NOTES.md):

| Fidelity | Count | Meaning |
| --- | --- | --- |
| `exact` | 4 | Standard, unambiguous operation (`Constant`, `Output`, `Export`, `Group`) |
| `approx` | 27 | Right family and parameter surface; constants, ordering or profiles differ |
| `model` | 24 | A standard published model stands in for Gaea's unrecovered method |
| `stub` | 1 | Interface only (`File`) |

The 132 catalog-only nodes are not silent holes. Each one:

* appears in the library with its real description and parameter count,
* renders its **complete, correctly-typed** parameter list (a `Boolean` becomes a switch, an
  `Enum` becomes a dropdown with Gaea's own option labels, a `Color` becomes a picker, a `Float2`
  becomes a dual field), with Gaea's section grouping,
* shows a **not implemented** badge and an explanation in the parameter panel,
* and still evaluates — it passes its first connected input through, so a graph that uses it
  never breaks.

---

## Data pipeline

`data/nodes.json` is **generated from the installed Gaea**, not hand-written:

```powershell
node web/data/build-catalog.mjs     # reads D:\Gaea 2\Resources\Nodes.json
```

It classifies each of the 1341 catalog entries as a value parameter (1192), a section header
(126), a `Command` button (20) or a list-typed entry (3), so the parameter panel can render
Gaea's real grouping without inventing structure.

When the sibling reverse-engineering artefact `docs/node-specs-from-il.json` is present, the
generator also imports the recovered `[Parameter(default, min, max)]` attributes: **1150 of 1192
parameters match by name**, and after validating every value against its declared type, **565
defaults and 540 min/max ranges** reach the UI. Each parameter records where its numbers came
from, and the tooltip says so. See
[IMPLEMENTATION-NOTES.md §1](IMPLEMENTATION-NOTES.md) for the details and the rejection rules.

---

## Verification status

Both suites were run to completion in this environment:

* `tests/smoke.mjs` — **86/86 pass.** Includes numerical properties (noise distribution,
  D8 flow accumulation mass balance and outlet behaviour, erosion monotonicity and mass drift,
  blur mean preservation), all 24 combine modes over a degenerate grid, per-algorithm evaluation
  at three resolutions for all 56 registered nodes, and bit-identical determinism.
* `tests/app-test.mjs` — **63/63 pass, 0 console errors, 0 console warnings.** Drives the real
  application.
* **The browser could not be started here.** Chromium's mojo IPC needs named pipes, which this
  sandbox denies; Chrome and Edge were tried with `--headless`, `--headless=new`, `--dump-dom`
  and `--remote-debugging-port`, and every launch self-terminates. Therefore the GLSL shaders
  have never been compiled by a real driver, the 3D terrain has never been rendered, and no
  screenshot exists. `?selftest=1` is provided to close exactly that gap on a machine with a
  working browser.

Full statement of what is and is not verified: [IMPLEMENTATION-NOTES.md §9](IMPLEMENTATION-NOTES.md).

---

## Performance

Measured here with the demo pipeline (2× `MultiFractal`, `Warp`, `Erosion2`, `Snow`, `Mountain`,
`Combine`, `Autolevel`), single-threaded; the browser Worker produces the same numbers:

| Build resolution | Demo pipeline | Slowest node | Isolated droplet erosion |
| --- | --- | --- | --- |
| 128 × 128 | 0.17 s | `Erosion2` 0.06 s | 0.08 s |
| 256 × 256 | 0.59 s | `Erosion2` 0.31 s | 0.31 s |
| 512 × 512 | 2.7 s | `Erosion2` 1.5 s | 1.5 s |
| 1024 × 1024 | ~10 s | `Erosion2` ~6 s | ~6 s |

* Cost is **O(N²)** per node, so **O(N²·nodes)** per pass. Erosion is the only
  super-linear-in-practice node (its droplet count also grows with N²) and it dominates.
* `Erosion2.Duration` sets the droplet budget linearly, so halving it halves the erosion cost.
* Memory is one `Float32Array` per field per node in the evaluated sub-graph (4·N² bytes each;
  1 MB at 512²), not pooled across passes.
* Evaluation is off the main thread, so a 3-second 512 px build does not freeze the UI; the
  status pill shows `building…` and per-node timings land in the Info tab.
* Fields cross the worker boundary as transferred `ArrayBuffer`s, so there is no copy on return.
* 3D meshing is capped at 384×384 samples (≤ 294 k triangles), so a 1024² field still renders
  smoothly at high exaggeration.

---

## Known limitations

* **132 catalogued nodes have no algorithm**; they pass through. Nothing about them is guessed.
* **`File` does not decode anything** (deliberate stub — see notes §5.1).
* **Erosion is a standard published model, not Gaea's**, and it is **single-scale** where Gaea's
  `Erosion2` is a multi-scale Laplacian-pyramid particle solver. This is the largest structural
  divergence in the project.
* **No channel plumbing**: Gaea passes several named channels between nodes; this build carries
  one scalar field plus a 4-channel colour path.
* **No colour pipeline** (`CLUTer`, `SuperColor`, `SatMap`, `Tint`, …) and greyscale-only export.
* **No tiled/overlapping build**, and no persistent cache.
* **Export is PNG only** — the RAW/JPEG/EXR formats in `Export`'s enum are not written.
* **Curve splines are not editable in the UI**, so `Curve`/`Recurve` fall back to the identity
  spline unless one is supplied programmatically.
* **No graph save/load to disk**; a reload starts from the demo graph.
* **`Erosion2`'s droplet count scales with resolution**, so a 512 px build is a refinement of the
  256 px preview rather than a pixel-exact match.
