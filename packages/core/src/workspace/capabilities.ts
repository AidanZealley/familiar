import {
  AgentDoc,
  configure,
  type AgentState,
  type Tx,
} from '@earendil-works/pi-durable'
import { mcpExtensionName } from '../mcp/connection.ts'
import { pluginExtensionName } from '../plugins/index.ts'
import type { FamiliarId } from './familiars.ts'

/**
 * Which plugins and MCP connections a Familiar uses, by name. The one record
 * of it is Pi's own: the extensions its chat selects, in the chat's
 * `pi.agent`. Its chat leaves the host's default selection, every installed
 * extension, as it is, except for the plugins and connections it turned
 * off, which it removes. So a plugin or connection added later reaches
 * every Familiar, including those that chose, and core's own extensions are
 * always on. Tool search comes with any MCP connection (see mcp/connection.ts).
 */
export type FamiliarCapabilities = {
  /** Plugins, by `FamiliarPlugin.name`. */
  plugins: string[]
  /** MCP connections, by server name. */
  mcp: string[]
}

/** A change to what a Familiar uses: each list given replaces that kind's. */
export type CapabilitiesChange = Partial<FamiliarCapabilities>

/** A capability no one can assign; nothing was changed. */
export class CapabilityError extends TypeError {}

const extensionNames = {
  plugins: pluginExtensionName,
  mcp: mcpExtensionName,
} satisfies Record<keyof FamiliarCapabilities, (name: string) => string>

const kinds = Object.keys(extensionNames) as (keyof FamiliarCapabilities)[]

/** The extension names a chat's selection removes. */
const removedBy = (agent: Readonly<AgentState> | undefined) =>
  new Set(
    agent?.extensions && !Array.isArray(agent.extensions)
      ? (agent.extensions.remove ?? [])
      : [],
  )

/** What of `available` a Familiar's chat, with `agent`, uses. */
export function capabilitiesOf(
  agent: Readonly<AgentState> | undefined,
  available: FamiliarCapabilities,
): FamiliarCapabilities {
  const removed = removedBy(agent)
  const used = (kind: keyof FamiliarCapabilities) =>
    available[kind].filter((name) => !removed.has(extensionNames[kind](name)))
  return { plugins: used('plugins'), mcp: used('mcp') }
}

/**
 * Sets what `familiar` uses, of `available`, from its next request. Throws a
 * CapabilityError for a name that isn't available. A name no longer
 * available, such as a removed connection's, stays off if it was, so the
 * Familiar keeps its choice should it come back.
 */
export async function setCapabilities(
  tx: Tx,
  familiar: FamiliarId,
  available: FamiliarCapabilities,
  change: CapabilitiesChange,
) {
  const removed = removedBy(await tx.doc(AgentDoc, familiar))
  for (const kind of kinds) {
    const chosen = change[kind]
    if (chosen === undefined) {
      continue
    }
    if (
      !Array.isArray(chosen) ||
      chosen.some((name) => !available[kind].includes(name))
    ) {
      throw new CapabilityError(
        `Choose ${kind === 'plugins' ? 'plugins' : 'MCP connections'} from this workspace's, by name.`,
      )
    }
    for (const name of available[kind]) {
      const extension = extensionNames[kind](name)
      if (chosen.includes(name)) {
        removed.delete(extension)
      } else {
        removed.add(extension)
      }
    }
  }
  // Stored by name: an object with only a name is all Pi reads.
  await configure(tx, familiar, {
    extensions: { remove: [...removed].map((name) => ({ name })) },
  })
}
