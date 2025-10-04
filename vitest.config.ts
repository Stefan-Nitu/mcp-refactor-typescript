/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
    hookTimeout: 30000,
    fileParallelism: false, // Run integration tests sequentially to avoid race conditions
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  },
  esbuild: {
    target: 'node18'
  }
});