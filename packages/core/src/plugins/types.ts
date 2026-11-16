import type { PluginSecret } from '../connections/index.ts'
import type { FamiliarTool } from '../tools.ts'

export type { FamiliarTool } from '../tools.ts'

/**
 * Tools that aren't core's, grouped under a stable name with the secrets they
 * share. Each tool is a plain Pi tool; Familiar gives it `familiar(context)`.
 */
export type FamiliarPlugin = {
  /** Keys its secrets, so keep it stable. */
  name: string
  /** For the owner, on the Connections page. */
  title: string
  secrets?: readonly PluginSecret[]
  tools: readonly FamiliarTool[]
}
