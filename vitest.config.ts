import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Agent worktrees are full copies of the repo; their tests aren't ours.
    // The Cloudflare Worker's run in workerd, with `pnpm test:cloudflare`.
    exclude: [...configDefaults.exclude, '.claude/**', 'apps/cloudflare/**'],
    // Stdio tests spawn Node, which can take over the default second while
    // every other test file runs alongside.
    expect: { poll: { timeout: 5000 } },
  },
})
