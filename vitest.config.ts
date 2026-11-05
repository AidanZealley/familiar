import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Agent worktrees are full copies of the repo; their tests aren't ours.
    // The Cloudflare package's workerd tests run with `pnpm test:cloudflare`.
    exclude: [
      ...configDefaults.exclude,
      '.claude/**',
      'packages/cloudflare/test/**',
    ],
    // Stdio tests spawn Node, which can take over the default second while
    // every other test file runs alongside.
    expect: { poll: { timeout: 5000 } },
  },
})
