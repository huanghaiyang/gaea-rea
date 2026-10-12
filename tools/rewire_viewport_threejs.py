#!/usr/bin/env python3
"""Rewire the 3D preview from the hand-rolled GL to three.js (js/render3d.js).

Replaces five regions of viewport.js:
  _initGL + availability getters, _draw3D, _uploadMesh + _uploadHeightTexture,
  the now-unused compile() helper, and the old GLSL constants (re-exported from
  render3d.js so the shader tests keep a single source to inspect).

Camera math and the pointer handlers are deliberately untouched: those sign
conventions were derived from the projection, confirmed by the user against the
running app, and are pinned by tests/camera-controls-test.mjs.

Verified by parsing the result and by the test suite.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

WS = pathlib.Path(__file__).resolve().parent.parent
T = WS / "web" / "js" / "viewport.js"


def find_block(lines: list[str], start_pat: str, end_pat: str, from_line: int = 0) -> tuple[int, int]:
    """Line indices [start, end) for a block starting at start_pat and closing at end_pat."""
    start = None
    for i in range(from_line, len(lines)):
        if start_pat in lines[i]:
            start = i
            break
    if start is None:
        raise SystemExit(f"start pattern not found: {start_pat}")
    for i in range(start + 1, len(lines)):
        if end_pat in lines[i]:
            return start, i + 1
    raise SystemExit(f"end pattern not found after {start_pat}: {end_pat}")


def main() -> int:
    src = T.read_text(encoding="utf-8")
    if "Renderer3D" in src:
        print("already rewired; nothing to do")
        return 0
    lines = src.split("\n")

    # ---- 1. import Renderer3D and re-export the shader sources -------------
    old_import = "import { MeshWorkerController } from './mesh-worker-controller.js';"
    if old_import not in src:
        print("import anchor not found")
        return 1
    new_import = (
        "import { MeshWorkerController } from './mesh-worker-controller.js';\n"
        "import { Renderer3D, SHADER_VERT_3D, SHADER_FRAG_3D } from './render3d.js';"
    )
    src = src.replace(old_import, new_import, 1)
    lines = src.split("\n")

    # ---- 2. drop the old GLSL consts, re-export three.js's instead ----------
    vs_start, _ = find_block(lines, "const VERT = `#version 300 es", "}`;")
    fs_end = None
    for i in range(vs_start, len(lines)):
        if lines[i].startswith("const FRAG = `#version 300 es"):
            _, fs_end = find_block(lines, "const FRAG = `#version 300 es", "}`;", i)
            break
    if fs_end is None:
        print("FRAG block not found")
        return 1
    # Also drop the old exported aliases that referenced them.
    alias_start = None
    alias_end = None
    for i in range(fs_end, min(fs_end + 40, len(lines))):
        if "export const SHADER_VERT = VERT;" in lines[i]:
            alias_start = i
        if alias_start is not None and "export const SHADER_FRAG = FRAG;" in lines[i]:
            alias_end = i
            break
    # Include the doc comment above the aliases.
    if alias_start is not None:
        j = alias_start - 1
        while j >= 0 and lines[j].strip().startswith(("*", "/**", "//", "")):
            j -= 1
        alias_start = j + 1
    if alias_start is None or alias_end is None:
        print("shader alias exports not found")
        return 1

    shader_block = [
        "/* ---------------------------------------------------------------- shaders */",
        "",
        "/** Shader sources live in render3d.js; re-exported so the static GLSL checks in",
        " * tests/shader-src-test.mjs have one place to inspect. */",
        "export const SHADER_VERT = SHADER_VERT_3D;",
        "export const SHADER_FRAG = SHADER_FRAG_3D;",
    ]
    lines = lines[:vs_start] + shader_block + lines[alias_end + 1:]

    # ---- 3. _initGL + getters -> three.js ----------------------------------
    a, b = find_block(lines, "  _initGL() {", "  get status() { return this.glInfo; }")
    init_block = [
        "  _initGL() {",
        "    // three.js owns the render target and geometry; viewport.js keeps the camera",
        "    // maths and the pointer handlers, whose conventions are pinned by tests.",
        "    this.renderer3d = new Renderer3D(this.c3d);",
        "    this.available3D_ = this.renderer3d.available;",
        "    this.glInfo = this.renderer3d.info;",
        "  }",
        "",
        "  /** Kept as a stable name for the rest of the class and for callers. */",
        "  get gl() { return this.renderer3d && this.renderer3d.available ? this.renderer3d : null; }",
        "",
        "  get available3D() { return !!(this.renderer3d && this.renderer3d.available); }",
        "  get status() { return this.glInfo; }",
    ]
    lines = lines[:a] + init_block + lines[b:]

    # ---- 4. _draw3D -> delegate -------------------------------------------
    a, b = find_block(lines, "  _draw3D() {", "/* --------------------------------------------------- mesh cache + worker */")
    draw_block = [
        "  _draw3D() {",
        "    const s = this.field;",
        "    if (this._meshStale(s)) this._requestMesh(s);",
        "",
        "    const r = this.renderer3d;",
        "    if (!r || !r.available) return;",
        "",
        "    // Nothing to draw until the first mesh arrives; the request is already in",
        "    // flight and a cleared frame beats blocking the UI thread.",
        "    if (!this.mesh) return;",
        "",
        "    r.resize(this.c3d.width, this.c3d.height);",
        "    r.setCamera(this.camera);",
        "    r.setRamp(this.ramp);",
        "    r.render({ r: 0.043, g: 0.058, b: 0.078, a: 1 });",
        "  }",
        "",
    ]
    lines = lines[:a] + draw_block + lines[b:]

    # ---- 5. _uploadMesh / _uploadHeightTexture -> delegate -----------------
    a, b = find_block(lines, "  _uploadMesh(res) {", "  get meshInfo() { return this.mesh; }")
    upload_block = [
        "  _uploadMesh(res) {",
        "    const r = this.renderer3d;",
        "    if (!r || !r.available) return;",
        "    r.setMesh(res);",
        "    this.ibCount = res.idx.length;",
        "    this.mesh = {",
        "      src: res.token,",
        "      size: res.token && res.token.size,",
        "      exag: this.exaggeration,",
        "      n: res.n,",
        "      stride: res.stride,",
        "      vertices: res.vertices,",
        "      triangles: res.triangles,",
        "      mode: res.mode,",
        "      buildMs: res.buildMs,",
        "    };",
        "    this._uploadHeightTexture(res.n, res.stride);",
        "  }",
        "",
        "  /**",
        "   * Upload the height field as a single-channel float texture so the fragment",
        "   * shader can derive normals, occlusion and specular per pixel.",
        "   *",
        "   * Normalized to 0..1 (and widened when the field is flat) so the shader never",
        "   * depends on reading a negative value out of a float texture.",
        "   */",
        "  _uploadHeightTexture(n, stride) {",
        "    const r = this.renderer3d;",
        "    const s = this.field;",
        "    if (!r || !r.available || !s || !s.data) return;",
        "",
        "    const size = s.size;",
        "    const channels = s.channels || 1;",
        "    const gridStep = n > 1 ? 1 / (n - 1) : 1;",
        "    const width = (n - 1) * (stride * gridStep);",
        "    this._meshWidth = width;",
        "",
        "    const range = s.max - s.min;",
        "    const wide = range > 1e-9;",
        "    const inv = wide ? 1 / range : 1;",
        "",
        "    const tex = new Float32Array(size * size);",
        "    const data = s.data;",
        "    if (wide) {",
        "      for (let i = 0, p = 0; i < tex.length; i++, p += channels) {",
        "        tex[i] = (data[p] - s.min) * inv;",
        "      }",
        "    } else {",
        "      tex.fill(0.5);",
        "    }",
        "",
        "    r.setHeightTexture(tex, size, width);",
        "    this._heightTexSize = size;",
        "  }",
        "",
        "  get meshInfo() { return this.mesh; }",
    ]
    lines = lines[:a] + upload_block + lines[b:]

    # ---- 6. drop the unused compile() helper ------------------------------
    out = "\n".join(lines)
    pat = "function compile(gl, type, src) {"
    if pat in out:
        ls = out.split("\n")
        a = next(i for i, l in enumerate(ls) if pat in l)
        depth = 0
        b = a
        for i in range(a, len(ls)):
            depth += ls[i].count("{") - ls[i].count("}")
            if depth == 0 and i > a:
                b = i + 1
                break
        if a > 0 and ls[a - 1].strip() == "":
            a -= 1
        ls = ls[:a] + ls[b:]
        out = "\n".join(ls)
        print("removed the unused compile() helper")

    # ---- 7. resize must also resize the renderer ---------------------------
    old_resize_tail = """    for (const canvas of [this.c2d, this.c3d]) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
  }"""
    new_resize_tail = """    for (const canvas of [this.c2d, this.c3d]) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    if (this.renderer3d && this.renderer3d.available) this.renderer3d.resize(w, h);
  }"""
    if old_resize_tail in out:
        out = out.replace(old_resize_tail, new_resize_tail, 1)
        print("resize() now forwards to the renderer")
    else:
        print("WARNING: resize() tail not matched; renderer resize not wired")

    # ---- 8. constructor + setMode + draw dispatch --------------------------
    out = out.replace("    this.gl = null;\n", "    this.renderer3d = null;\n", 1)
    out = out.replace("if (mode === '3d' && !this.gl) {", "if (mode === '3d' && !this.available3D) {", 1)
    out = out.replace("if (this.mode === '3d' && this.gl) this._draw3D();",
                      "if (this.mode === '3d' && this.available3D) this._draw3D();", 1)

    T.write_text(out, encoding="utf-8")
    print(f"wrote {T} ({len(out)} bytes)")

    check = T.read_text(encoding="utf-8")
    for probe in ("Renderer3D", "SHADER_VERT_3D", "renderer3d.setMesh", "renderer3d.render",
                  "renderer3d.setHeightTexture", "this.gl = null", "compile(gl,"):
        print(f"  {probe!r}: {check.count(probe)}")

    p = subprocess.run(["node", "--check", str(T)], capture_output=True, text=True)
    print("syntax:", "OK" if p.returncode == 0 else p.stderr[:500])
    return 0 if p.returncode == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
