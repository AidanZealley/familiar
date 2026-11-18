import { defineDoc, type Tx } from '@earendil-works/pi-durable'
import type { Connection } from './secrets.ts'

export type ToolAnnotations = { destructiveHint?: boolean }
export type ToolSettings = { enabled: boolean; askBeforeRunning: boolean }

type Overrides = Record<string, Record<string, Partial<ToolSettings>>>

export const ToolSettingsDocument = defineDoc<Overrides>({
  kind: 'familiar.tool-settings',
  version: 1,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true,
})

const key = (connection: Connection) => `${connection.kind}:${connection.name}`

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
