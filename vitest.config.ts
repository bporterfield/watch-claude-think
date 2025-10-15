import { defineConfig } from 'vitest/config';

// Detect CI environment
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: isCI ? 90000 : 30000, // 90s in CI to allow for retry logic, 30s locally
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockHelpers.ts',
        '**/__tests__/fixtures/**',
      ],
    },
  },
});
