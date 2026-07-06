import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Scripts run from the repo root; treat ./client as the Vite project root.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
