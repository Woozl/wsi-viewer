import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Deployed as a GitHub Pages project site at <user>.github.io/wsi-viewer/.
  base: '/wsi-viewer/',
  plugins: [tanstackRouter({ autoCodeSplitting: true }), react(), tailwindcss()],
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
