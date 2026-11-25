import { defineDoc, type Tx } from '@earendil-works/pi-durable'
import type { ToolAnnotations } from '@modelcontextprotocol/client'
import type { Connection } from './secrets.ts'

/** MCP's tool annotations, which plugin tools declare too. */
export type { ToolAnnotations } from '@modelcontextprotocol/client'

export type ToolSettings = {
  enabled: boolean
  askBeforeRunning: boolean
  runInBackground: boolean
}

type Overrides = Record<string, Record<string, Partial<ToolSettings>>>

export const ToolSettingsDocument = defineDoc<Overrides>({
  kind: 'familiar.tool-settings',
  version: 1,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true,
})

const key = (connection: Connection) => `${connection.kind}:${connection.name}`

export async function removeToolSettings(tx: Tx, connection: Connection) {
  delete (await tx.doc(ToolSettingsDocument))[key(connection)]
}

export async function prunePluginToolSettings(
  tx: Tx,
  names: readonly string[],
) {
  const overrides = await tx.doc(ToolSettingsDocument)
  const installed = new Set(names.map((name) => key({ kind: 'plugin', name })))
  for (const connection of Object.keys(overrides)) {
    if (connection.startsWith('plugin:') && !installed.has(connection)) {
      delete overrides[connection]
    }
  }
}

export function toolSettingsOf(
  overrides: Readonly<Overrides> | null | undefined,
  connection: Connection,
  tool: string,
  annotations: ToolAnnotations | undefined,
): ToolSettings {
  const tools = overrides?.[key(connection)]
  const chosen = tools && Object.hasOwn(tools, tool) ? tools[tool] : undefined
  return {
    enabled: chosen?.enabled ?? true,
    runInBackground:
      connection.kind === 'mcp' && chosen?.runInBackground === true,
    askBeforeRunning:
      chosen?.askBeforeRunning ?? annotations?.destructiveHint === true,
  }
}

export async function updateToolSettings(
  tx: Tx,
  connection: Connection,
  tool: string,
  change: Partial<ToolSettings>,
) {
  const overrides = await tx.doc(ToolSettingsDocument)
  const connectionKey = key(connection)
  overrides[connectionKey] ??= {}
  const tools = overrides[connectionKey]!
  const previous = Object.hasOwn(tools, tool) ? tools[tool] : undefined
  tools[tool] = { ...previous, ...change }
}
