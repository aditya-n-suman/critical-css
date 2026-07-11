import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Real-browser integration tests: generous per-test budget for cold launches.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Playwright browsers must not be launched from parallel workers against
    // the same pool instance in these tests.
    fileParallelism: false,
  },
})
