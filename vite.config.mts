import { defineConfig } from 'vite';

// The renderer is a plain TS + CSS app. Electron loads the production build from
// disk with a file:// URL, so relative asset paths are required.
export default defineConfig({
  base: './',
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome124',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
