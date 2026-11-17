import { defineConfig } from 'vite';

// GitHub Pages serves the project at https://<user>.github.io/laws-tours-world-explorer/
export default defineConfig({
  base: '/laws-tours-world-explorer/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
});
