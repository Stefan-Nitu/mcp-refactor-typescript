/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '*.config.ts',
        'dist/'
      ]
    },
    testTimeout: 30000, // LSP operations can take time
    hookTimeout: 30000
  },
  esbuild: {
    target: 'node18'
  }
});