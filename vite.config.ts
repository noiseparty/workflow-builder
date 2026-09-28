import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: '/',
  plugins: [preact()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      // In production the shell serves /theme.css on the same origin. Locally, borrow the live one.
      '/theme.css': { target: 'https://www.skabene.id.lv', changeOrigin: true, secure: true },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
} as any);
