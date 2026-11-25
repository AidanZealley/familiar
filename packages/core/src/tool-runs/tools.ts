import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation'
import type {
  Harness,
  JsonObject,
  RegistrySnapshot,
  ToolExecutionResult,
} from '@earendil-works/pi-durable'
import {
  toolSettingsOf,
  ToolSettingsDocument,
  type ToolAnnotations,
} from '../connections/tool-settings.ts'
import { mcpExtensionName } from '../mcp/connection.ts'
import { connectionToolOf } from '../questions/index.ts'
import type { FamiliarCapabilities } from '../workspace/capabilities.ts'
import type { FamiliarId } from '../workspace/familiars.ts'

/**
 * One of a Familiar's MCP connection tools, as it has it now: what a person
 * can run for it without a model (`tools.run`, `tools.read`), and what a
 * plugin can check a model's choice of tools against.
 */
export type ConnectionTool = {
  /** By its name in Pi, such as `mcp__home__HassTurnOff`. */
  name: string
  description?: string
  /** Its input schema. */
  parameters: object
  annotations?: ToolAnnotations
  /** The owner wants it approved before each run (or it's destructive). */
  askBeforeRunning: boolean
}

/** Where a run goes: the server and the tool's own name there. */
export type ResolvedTool = ConnectionTool & { server: string; own: string }

/**
 * A Familiar's connection tools, read from their owners on every call and
 * never kept: the registry (connected servers' tools), the Familiar's
 * capabilities (which connections it uses) and the owner's tool settings
 * (turned off, or ask first). MCP tools only: plugins' need Pi's tool API.
 */
export function connectionToolsOf(
  harness: Harness,
  options: {
    registry: () => RegistrySnapshot
    capabilities: (familiar: FamiliarId) => Promise<FamiliarCapabilities>
  },
) {
  const settings = () =>
    harness.snapshot(ToolSettingsDocument, BACKGROUND_CONTEXT)

  const describe = (
    registry: RegistrySnapshot,
    name: string,
    overrides: Awaited<ReturnType<typeof settings>>,
  ): ResolvedTool | undefined => {
    const found = connectionToolOf(registry, name)
    if (found?.connection.kind !== 'mcp') {
      return undefined
    }
    const tool = registry.tools().find(({ tool }) => tool.name === name)?.tool
    const chosen = toolSettingsOf(
      overrides,
      found.connection,
      found.tool,
      found.annotations,
    )
    if (!tool || !chosen.enabled) {
      return undefined
    }
    return {
      name,
      ...(tool.description !== undefined && { description: tool.description }),
      parameters: tool.parameters as object,
      ...(found.annotations && { annotations: found.annotations }),
      askBeforeRunning: chosen.askBeforeRunning,
      server: found.connection.name,
      own: found.tool,
    }
  }

  return {
    /** `name`, if `familiar` can run it now; else undefined. */
    resolve: async (familiar: FamiliarId, name: string) => {
      const registry = options.registry()
      const found = connectionToolOf(registry, name)
      if (found?.connection.kind !== 'mcp') {
        return undefined
      }
      const { mcp } = await options.capabilities(familiar)
      if (!mcp.includes(found.connection.name)) {
        return undefined
      }
      return describe(registry, name, await settings())
    },
    /** Every connection tool `familiar` can run now. */
    list: async (familiar: FamiliarId): Promise<ConnectionTool[]> => {
      const registry = options.registry()
      const { mcp } = await options.capabilities(familiar)
      const extensions = new Set(mcp.map(mcpExtensionName))
      const overrides = await settings()
      return registry
        .tools()
        .filter(({ extension }) => extensions.has(extension.name))
        .flatMap(({ tool }) => {
          const found = describe(registry, tool.name, overrides)
          if (!found) {
            return []
          }
          const { server: _, own: __, ...connectionTool } = found
          return [connectionTool]
        })
    },
  }
}

/**
 * Why `args` don't fit `tool`'s parameters, in Pi's words; undefined if they
 * do. Pi's own check, as for a model's call.
 */
export function argsProblem(
  tool: Pick<ConnectionTool, 'name' | 'parameters'>,
  args: JsonObject,
) {
  try {
    validateToolArguments(
      { name: tool.name, description: '', parameters: tool.parameters },
      { type: 'toolCall', id: 'person', name: tool.name, arguments: args },
    )
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** A result's text, its text blocks joined: what a read hands back. */
export const textOf = (result: ToolExecutionResult) =>
  (result.output ?? [])
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')

const short = (text: string, length = 300) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text

/**
 * Whether a run failed, with the tool's own text if it gave any: the
 * result's `isError`, or a JSON result whose `failed` list (top level or
 * under `data`) isn't empty, which is how Home Assistant's Assist tools
 * report a device that didn't respond. Undefined if it worked.
 */
export function failureOf(
  result: ToolExecutionResult,
): { message?: string } | undefined {
  const text = textOf(result)
  const failed = { ...(text && { message: short(text) }) }
  if (result.isError) {
    return failed
  }
  try {
    const parsed = JSON.parse(text) as {
      failed?: unknown
      data?: { failed?: unknown }
    }
    const list = parsed?.failed ?? parsed?.data?.failed
    if (Array.isArray(list) && list.length > 0) {
      return failed
    }
  } catch {
    // Not JSON: nothing more to read from it.
  }
  return undefined
}
