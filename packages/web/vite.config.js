import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the API runs on 7420 (`npm run dev:server`) and vite proxies to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7420', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:7420', ws: true, changeOrigin: true },
    },
  },
});
