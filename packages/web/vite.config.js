import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Keep OCR offline in development and in the single-file distribution.
function localOcr() {
  const root = resolve(require.resolve('tesseract.js/package.json'), '..');
  const core = resolve(require.resolve('tesseract.js-core/package.json'), '..');
  const eng = resolve(require.resolve('@tesseract.js-data/eng/package.json'), '..', '4.0.0_best_int', 'eng.traineddata.gz');
  const files = { 'worker.min.js': resolve(root, 'dist/worker.min.js'), 'eng.traineddata.gz': eng };
  for (const f of readdirSync(core).filter((f) => /\.wasm(?:\.js)?$/.test(f))) files[f] = resolve(core, f);
  return {
    name: 'local-ocr',
    configureServer(server) {
      server.middlewares.use('/ocr', (req, res, next) => {
        const f = files[req.url.split('?')[0].slice(1)];
        if (!f) return next();
        res.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        res.end(readFileSync(f));
      });
    },
    generateBundle() { for (const [name, file] of Object.entries(files)) this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(file) }); },
  };
}

// In dev, the API runs on 7420 (`npm run dev:server`) and vite proxies to it.
export default defineConfig({
  plugins: [react(), localOcr()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7420', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:7420', ws: true, changeOrigin: true },
    },
  },
});
