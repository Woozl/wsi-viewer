import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * GitHub Pages has no rewrite rules, so a deep link such as /wsi-viewer/view is
 * a hard 404. Serving the same document as 404.html lets the static host fall
 * through to the client router.
 */
function spaFallback(): Plugin {
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    closeBundle(): void {
      const out = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
      copyFileSync(resolve(out, 'index.html'), resolve(out, '404.html'));
    },
  };
}

export default defineConfig({
  // Deployed as a GitHub Pages project site at <user>.github.io/wsi-viewer/.
  base: '/wsi-viewer/',
  plugins: [tanstackRouter({ autoCodeSplitting: true }), react(), tailwindcss(), spaFallback()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // The WASI core is ~8.5 MB; warning on it every build is just noise.
    chunkSizeWarningLimit: 1024,
  },
});
