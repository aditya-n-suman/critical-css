import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Real-browser dual-render tests: generous per-test budget for cold launches.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One Playwright pool instance is shared across the suite; do not launch
    // browsers from parallel workers against it (mirrors packages/browser).
    fileParallelism: false,
  },
})
