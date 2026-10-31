import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Wrangler bundles the Worker and runs it in workerd, and reminders wait
    // for real alarms at whole minutes.
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
})
