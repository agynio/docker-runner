import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/**/*.test.ts'],
    exclude: ['test/e2e/**'],
    hookTimeout: 60_000,
    coverage: { enabled: false },
  },
});
