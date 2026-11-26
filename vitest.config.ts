import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/api/src/**/*.test.ts', 'apps/worker/src/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    setupFiles: ['./vitest.setup.ts'],
  },
});
