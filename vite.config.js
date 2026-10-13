/**
 * vite.config.js — Vite + Vue 3 for the Gaea reversal UI.
 *
 * WHY `root` IS `web/`
 * The kernels, the registry and the extracted assets already live under `web/`, and they are
 * plain ES modules with no DOM dependency. Pointing the Vite root there means they are imported
 * AS IS -- `import { hydraulicDroplet } from '../js/kernels/erosion.js'` -- instead of being
 * copied, aliased or rewritten. The rewrite is a UI rewrite; not one line of kernel code changes.
 *
 * WHY `publicDir` IS `assets`
 * `web/assets` holds the extracted vendor data (CLUT palettes, overlays, ImageMagick tables) and
 * the kernel code reaches it by URL: `assets/color/Rock.png`, `assets/overlays/uv.png`,
 * `assets/magick/thresholds.json`. Setting `publicDir` to `assets` would flatten those to
 * `/color/...`, breaking every path. So `publicDir` stays off and `copyVendorAssets` copies the
 * tree to `dist/assets/` on build, preserving the layout the runtime expects.
 *
 * `web/assets` is gitignored -- it is regenerable from a local Gaea install with
 * `python tools/extract-assets.py` and `python tools/extract-magick.py`.
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB = resolve(import.meta.dirname, 'web');

/** Copy `web/assets` into the build output, keeping the `assets/` prefix the URLs rely on. */
function copyVendorAssets() {
  return {
    name: 'copy-vendor-assets',
    apply: 'build',
    closeBundle() {
      const from = resolve(WEB, 'assets');
      const to = resolve(WEB, 'dist', 'assets');
      if (!existsSync(from)) {
        this.warn(
          'web/assets is absent: run tools/extract-assets.py and tools/extract-magick.py. '
          + 'The CLUTer, Halftone and viewport-overlay features will fall back or be unavailable.',
        );
        return;
      }
      mkdirSync(to, { recursive: true });
      cpSync(from, to, { recursive: true });
    },
  };
}

export default defineConfig({
  root: WEB,
  plugins: [vue(), copyVendorAssets()],
  server: {
    // 127.0.0.1 rather than 0.0.0.0 on purpose: Chromium withholds `Worker` on
    // `http://<LAN-IP>/`, and the evaluator and mesh builders are workers. Binding to the
    // loopback interface keeps that from ever being the reason something silently fails.
    host: '127.0.0.1',
    port: 5174,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  // The vendored three.js stays where it is so `render3d.js` keeps working unchanged.
  resolve: {
    alias: {
      '@': resolve(WEB, 'src'),
      '@kernels': resolve(WEB, 'js', 'kernels'),
      '@js': resolve(WEB, 'js'),
    },
  },
});
