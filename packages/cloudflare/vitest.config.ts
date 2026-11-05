import { defineConfig } from 'vitest/config'

// The workerd tests, run with `pnpm test:cloudflare`. The unit tests in src
// run with the rest of the repository's.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Wrangler bundles the Worker and runs it in workerd, and reminders wait
    // for real alarms at whole minutes.
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
})
