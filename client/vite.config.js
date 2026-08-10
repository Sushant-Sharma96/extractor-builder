import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Scripts run from the repo root; treat ./client as the Vite project root.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // API + generated site previews both live on the Express server (3001).
      // Without /preview, the iframe loads Vite's SPA index → stripmine UI again.
      '/api': 'http://localhost:3001',
      '/preview': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
