# Vendored dependencies

Nothing here is fetched at runtime. The app is served from plain files over HTTP and
may also be opened from `file://`, so every dependency is committed as-is.

## three.js

| Item | Value |
| --- | --- |
| Version | `0.186.1` |
| License | MIT (see `LICENSE`) |
| Source | `npm pack three@0.186.1` from `registry.npmmirror.com` |

| File | Bytes | SHA-256 (first 16) |
| --- | --- | --- |
| `three.core.js` | 1,458,113 | `9edde002b066a9a0` |
| `three.module.js` | 662,772 | `9052042d676cb0fd` |

Both files are byte-identical to the published package; nothing was patched.

`js/render3d.js` imports `three.module.js` by **relative path**, not by the bare
`'three'` specifier, because the Node test suite imports the same module and Node has
no import map. `three.module.js` itself imports `three.core.js` relatively, so the pair
resolves identically in the browser and in Node.

`OrbitControls.js` was vendored and then removed: the camera maths in `viewport.js` was
derived from the projection, confirmed by the user against the running app, and is
pinned by `tests/camera-controls-test.mjs`, so handing camera control to OrbitControls
would silently change behaviour that had already been signed off. It is not needed.

To re-download and confirm the digests:

```powershell
$env:npm_config_cache="$PWD\.npm-cache"
New-Item -ItemType Directory -Force .build\three-dl | Out-Null
Set-Location .build\three-dl
npm pack three@0.186.1 --registry=https://registry.npmmirror.com
tar -xzf three-0.186.1.tgz
Get-FileHash package\build\three.core.js, package\build\three.module.js -Algorithm SHA256
```
