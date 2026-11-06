import type { PluginFetch } from './connections/index.ts'

/**
 * Plugins' fetch outside Node, unless the host passes its own: the runtime's
 * fetch. Workers and browsers can't reach their host's private network.
 */
export const defaultFetch: PluginFetch = (input, init) =>
  globalThis.fetch(input, init)
