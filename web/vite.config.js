import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  // vitest 3 memakai Vite 7 (esbuild); plugin React v6 hanya menangani JSX di Vite 8.
  ...(process.env.VITEST ? { esbuild: { jsx: 'automatic' } } : {}),
  server: {
    port: 5173,
    // UI memakai src/shared/vault-crypto.js dari backend.
    fs: { allow: [projectRoot] },
    // Jalankan API dengan HDB_ALLOWED_HOSTS=localhost:5173 supaya guard Host/Origin menerima proxy ini.
    proxy: { '/api': 'http://127.0.0.1:4321' },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  test: { environment: 'jsdom', include: ['src/**/*.test.{js,jsx}'] },
});
