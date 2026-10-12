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
| `OrbitControls.js` | 40,755 | `3d79d07ecb686b4e` |

Files are byte-identical to the published package; nothing was patched. Bare specifiers
(`import ... from 'three'` inside `OrbitControls.js`) are resolved by the import map in
`index.html`, which is why the vendored files can stay pristine and verifiable.

To re-download and confirm the digests:

```powershell
$env:npm_config_cache="$PWD\.npm-cache"
New-Item -ItemType Directory -Force .build\three-dl | Out-Null
Set-Location .build\three-dl
npm pack three@0.186.1 --registry=https://registry.npmmirror.com
tar -xzf three-0.186.1.tgz
Get-FileHash package\build\three.core.js, package\build\three.module.js,
             package\examples\jsm\controls\OrbitControls.js -Algorithm SHA256
```
