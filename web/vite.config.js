import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Jalankan API dengan HDB_ALLOWED_HOSTS=localhost:5173 supaya guard Host/Origin menerima proxy ini.
    proxy: { '/api': 'http://127.0.0.1:4321' },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  test: { environment: 'jsdom', include: ['src/**/*.test.{js,jsx}'] },
});
