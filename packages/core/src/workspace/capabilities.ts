import {
  AgentDoc,
  configure,
  defineDoc,
  type AgentState,
  type Tx,
} from '@earendil-works/pi-durable'
import { mcpExtensionName } from '../mcp/connection.ts'
import { pluginExtensionName } from '../plugins/index.ts'
import type { FamiliarId } from './familiars.ts'

/**
 * Which plugins and MCP connections a Familiar uses, by name. Each Familiar
 * opts in: one added to the workspace is used by none until it's turned on
 * for a Familiar, so each keeps the tools its role needs. The one record of
 * it is Pi's own: the extensions its chat selects, exactly, in the chat's
 * `pi.agent`. That selection is always core's own extensions as installed
 * now plus what it chose, so core is always on, whatever version of it runs.
 * Tool search comes with any MCP connection (see mcp/connection.ts).
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

/**
 * What a new Familiar uses unless whoever creates it says otherwise: the
 * workspace's default tools, which a person can change. A host's
 * `defaultCapabilities` fills it in on the first open only, so a change
 * made later is never overwritten.
 */
export const DefaultCapabilities = defineDoc<FamiliarCapabilities>({
  kind: 'familiar.default-capabilities',
  version: 1,
  scope: 'session',
  initial: () => ({ plugins: [], mcp: [] }),
  checkpointWhen: () => true, // small: always store it whole
})

const extensionNames = {
  plugins: pluginExtensionName,
  mcp: mcpExtensionName,
} satisfies Record<keyof FamiliarCapabilities, (name: string) => string>

const kinds = Object.keys(extensionNames) as (keyof FamiliarCapabilities)[]

/**
 * What a workspace has now: its plugins and connections, and every
 * extension a Familiar's chat could select, which is core's and theirs.
 */
export type Available = FamiliarCapabilities & {
  /** Installed extensions a chat may select, by name: all but upkeep's. */
  installed: string[]
}

/** The extension names of what a Familiar can choose. */
const assignable = (available: Available) =>
  new Set(kinds.flatMap((kind) => available[kind].map(extensionNames[kind])))

/** `capabilities` as extension names. */
const asExtensions = (capabilities: FamiliarCapabilities) =>
  kinds.flatMap((kind) => capabilities[kind].map(extensionNames[kind]))

/** Throws a CapabilityError unless every name in `change` is available. */
function checkChange(available: Available, change: CapabilitiesChange) {
  for (const kind of kinds) {
    const chosen = change[kind]
    if (
      chosen !== undefined &&
      (!Array.isArray(chosen) ||
        chosen.some((name) => !available[kind].includes(name)))
    ) {
      throw new CapabilityError(
        `Choose ${kind === 'plugins' ? 'plugins' : 'MCP connections'} from this workspace's, by name.`,
      )
    }
  }
}

/**
 * The extension names a chat with `agent` chose, beyond core's. A chat with
 * no exact selection runs with the host's default, every extension, as one
 * adopted from before workspaces does: it chose everything available.
 */
function chosenBy(
  agent: Readonly<AgentState> | undefined,
  available: Available,
) {
  if (!Array.isArray(agent?.extensions)) {
    return [...assignable(available)]
  }
  const core = new Set(
    available.installed.filter((name) => !assignable(available).has(name)),
  )
  // Names no longer installed, such as a removed connection's, are kept, so
  // it's on again should it come back; Pi selects nothing by them meanwhile.
  return agent.extensions.filter((name) => !core.has(name))
}

/** Selects exactly core's installed extensions and `chosen` for `familiar`'s chat. */
async function select(
  tx: Tx,
  familiar: FamiliarId,
  available: Available,
  chosen: readonly string[],
) {
  const assigned = assignable(available)
  const names = [
    ...available.installed.filter((name) => !assigned.has(name)),
    ...new Set(chosen),
  ]
  // Stored by name: an object with only a name is all Pi reads.
  await configure(tx, familiar, {
    extensions: names.map((name) => ({ name })),
  })
}

/** What of `available` a Familiar's chat, with `agent`, uses. */
export function capabilitiesOf(
  agent: Readonly<AgentState> | undefined,
  available: Available,
): FamiliarCapabilities {
  const chosen = new Set(chosenBy(agent, available))
  const used = (kind: keyof FamiliarCapabilities) =>
    available[kind].filter((name) => chosen.has(extensionNames[kind](name)))
  return { plugins: used('plugins'), mcp: used('mcp') }
}

/**
 * Sets what `familiar` uses, of `available`, from its next request. Throws
 * a CapabilityError for a name that isn't available.
 */
export async function setCapabilities(
  tx: Tx,
  familiar: FamiliarId,
  available: Available,
  change: CapabilitiesChange,
) {
  checkChange(available, change)
  const chosen = chosenBy(await tx.doc(AgentDoc, familiar), available)
  const replaced = new Set(
    kinds
      .filter((kind) => change[kind] !== undefined)
      .flatMap((kind) => available[kind].map(extensionNames[kind])),
  )
  await select(tx, familiar, available, [
    ...chosen.filter((name) => !replaced.has(name)),
    ...kinds.flatMap((kind) => (change[kind] ?? []).map(extensionNames[kind])),
  ])
}

/**
 * Gives a new Familiar `capabilities`, or else the workspace's defaults, as
 * far as the workspace has them. Throws a CapabilityError for a name in
 * `capabilities` that isn't available.
 */
export async function giveCapabilities(
  tx: Tx,
  familiar: FamiliarId,
  available: Available,
  capabilities: CapabilitiesChange | undefined,
) {
  if (capabilities) {
    checkChange(available, capabilities)
  }
  const defaults = await tx.doc(DefaultCapabilities)
  await select(
    tx,
    familiar,
    available,
    asExtensions({
      plugins: capabilities?.plugins ?? defaults.plugins,
      mcp: capabilities?.mcp ?? defaults.mcp,
    }),
  )
}

/**
 * Rebuilds `familiar`'s selection from core's extensions as installed now
 * and what it chose, so a version of core with new extensions has them on.
 */
export async function reselect(
  tx: Tx,
  familiar: FamiliarId,
  available: Available,
) {
  await select(
    tx,
    familiar,
    available,
    chosenBy(await tx.doc(AgentDoc, familiar), available),
  )
}

/**
 * Changes the workspace's defaults for new Familiars; each list given
 * replaces that kind's. Throws a CapabilityError for a name that isn't
 * available.
 */
export async function setDefaultCapabilities(
  tx: Tx,
  available: Available,
  change: CapabilitiesChange,
) {
  checkChange(available, change)
  const defaults = await tx.doc(DefaultCapabilities)
  for (const kind of kinds) {
    if (change[kind] !== undefined) {
      defaults[kind] = [...new Set(change[kind])]
    }
  }
}
