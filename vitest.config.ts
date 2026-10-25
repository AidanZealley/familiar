import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  // Agent worktrees are full copies of the repo; their tests aren't ours.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
})
