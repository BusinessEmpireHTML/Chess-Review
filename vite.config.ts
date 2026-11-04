import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// Relative base so the build works from any sub-path on any static host.
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
