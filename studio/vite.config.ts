import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://127.0.0.1:${process.env.STUDIO_PORT || 8787}`;

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: { '/api': api, '/ws': { target: api.replace('http', 'ws'), ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
