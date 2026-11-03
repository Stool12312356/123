import { defineConfig } from 'vite';
import { cpSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** copies the prepared GLB library (and manifest) into dist so the build runs offline */
function copyAssets() {
  return {
    name: 'redstorm-copy-assets',
    apply: 'build' as const,
    closeBundle() {
      const out = join('dist', 'assets');
      mkdirSync(out, { recursive: true });
      const walk = (from: string, to: string) => {
        mkdirSync(to, { recursive: true });
        for (const name of readdirSync(from)) {
          const a = join(from, name), b = join(to, name);
          if (statSync(a).isDirectory()) walk(a, b);
          else if (name.endsWith('.glb')) cpSync(a, b);
        }
      };
      if (existsSync('assets/models')) walk(join('assets', 'models'), join(out, 'models'));
      // manifest lives next to the GLBs (assets/models/../manifest.json -> assets/manifest.json)
      if (existsSync('assets/manifest.json')) cpSync(join('assets', 'manifest.json'), join('dist', 'manifest.json'));
      // draco decoder is fetched by DRACOLoader at runtime; the project ships none, so
      // geometry in the prepared GLBs is uncompressed (see tools/build-assets.js).
    }
  };
}
export default defineConfig({
  base: './',
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  worker: { format: 'es' },
  plugins: [copyAssets()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1800, assetsInlineLimit: 0, rollupOptions: { output: { manualChunks: { three: ['three'], physics: ['@dimforge/rapier3d-compat'] } } } }
});
