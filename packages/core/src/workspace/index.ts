import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Models } from '@earendil-works/pi-ai'
import {
  AgentDoc,
  createRegistry,
  Harness,
  type HarnessOptions,
  type ModelRef,
  type SessionEnd,
  type Storage,
  type UsageState,
  type Wake,
  type WatchHandle,
} from '@earendil-works/pi-durable'
import {
  createAccount,
  type AccountApi,
  type AccountOptions,
} from '../account/index.ts'
import {
  allConnections,
  type ConnectionsApi,
  type PluginFetch,
  type SecretStore,
} from '../connections/index.ts'
import { conversationExtension } from '../conversation/extension.ts'
import {
  installConversation,
  type ConversationApi,
} from '../conversation/index.ts'
import {
  findChatModel,
  modelKey,
  type ChatModel,
} from '../conversation/models.ts'
import { DEFAULT_CONTEXT_BUDGET, harnessOptions } from './harness.ts'
import { createMcp } from '../mcp/manager.ts'
import type { McpApi, McpStdioFactory } from '../mcp/servers.ts'
import { createMemory, type MemoryApi } from '../memory/index.ts'
import type { Notify } from '../notify.ts'
import { createPersona } from '../persona.ts'
import { createPlugins, type FamiliarPlugin } from '../plugins/index.ts'
import { checkMaxHandoffs, createRooms, type RoomsApi } from '../rooms/index.ts'
import { Rooms } from '../rooms/rooms.ts'
import {
  checkMaxSchedules,
  createSchedules,
  type SchedulesApi,
} from '../schedules/index.ts'
import { checkTimeZone, createTime } from '../time.ts'
import { viewWatch } from '../pi/watch.ts'
import {
  checkIdentity,
  createFamiliar,
  Familiars,
  familiarRecord,
  type FamiliarId,
  type FamiliarIdentity,
  type FamiliarsState as Registry,
} from './familiars.ts'
import { adoptPreWorkspaceFamiliar } from './migrate.ts'
import {
  capabilitiesOf,
  setCapabilities,
  type CapabilitiesChange,
  type FamiliarCapabilities,
} from './capabilities.ts'
import { removeFamiliar } from './remove.ts'

export type { FamiliarId, FamiliarIdentity } from './familiars.ts'
export type {
  CapabilitiesChange,
  FamiliarCapabilities,
} from './capabilities.ts'
export { CapabilityError } from './capabilities.ts'

export type WorkspaceOptions = {
  storage: Storage
  models: Models
  /**
   * What memory upkeep runs on, at its level in `chatModels`, and what each
   * Familiar's chat starts on until someone picks another.
   */
  model: ModelRef
  /**
   * The owner's IANA time zone, such as `Europe/London`. Familiar reads every
   * calendar in it: dates in memory, the days upkeep files and its 04:00
   * pass, schedules' times and repeats, and current_time's answer. Instants
   * (`now`) don't depend on it. Pass the same zone on every open; changing it
   * affects future calendar calculations, not stored instants or dates.
   */
  timeZone: string
  /**
   * The models a chat may switch between, each with the level it starts on.
   * Must include `model`. Default: only `model`, at medium.
   */
  chatModels?: readonly ChatModel[]
  /**
   * What every Familiar should know about this host, after its own persona,
   * such as how the host's UI renders replies. Core still adds what its own
   * features need: how the conversation, memory, schedules and tools work.
   */
  hostInstructions?: string
  /**
   * Lets the owner sign in and out of `model`'s provider through `models`,
   * and notices when the login stops working. Without it, the host keeps
   * `models`' credentials working itself, and a request they fail fails like
   * any other.
   */
  account?: AccountOptions
  /** Tools beyond core's, grouped with the secrets they share. */
  plugins?: readonly FamiliarPlugin[]
  /** Where plugins' secrets are kept. Without it, every secret is missing. */
  secrets?: SecretStore
  /**
   * How tools reach the network. A model can be talked into fetching any
   * URL, so if this process can reach private, loopback or tailnet addresses,
   * this must refuse them, at connection time and on every redirect. Default:
   * on Node, a fetch that refuses every address that isn't public; elsewhere,
   * such as a Worker or a browser, which can't reach them, the runtime's.
   */
  fetch?: PluginFetch
  /** Owner-configured MCP endpoints, including private networks. Never used by plugins. */
  mcpFetch?: PluginFetch
  /** Optional host factory for owner-configured local MCP commands. */
  mcpStdio?: McpStdioFactory
  /**
   * Roughly how many tokens each request may send, whatever the model's context
   * window; older conversation is compacted into a summary to stay under it.
   * Higher keeps more conversation verbatim, but every request pays for all of
   * it, in money or subscription limits, latency and the model's attention.
   * Default 64,000.
   */
  contextBudget?: number
  /**
   * Delivers a notification: each scheduled run's reply, or its prompt if
   * there was none, and whatever plugins send. Without it, schedules still
   * run in the chat. Scheduled runs pass a `NotificationContext` with the
   * schedule's ID and stored creator; the host chooses who sees it and how,
   * such as Web Push or its own notification system. Familiar never picks
   * recipients, and the creator isn't one by default.
   */
  notify?: Notify
  /**
   * The most schedules each Familiar keeps at once; the schedule tool refuses
   * more until one is cancelled. A positive whole number. Default
   * `DEFAULT_MAX_SCHEDULES`, 50.
   */
  maxSchedules?: number
  /**
   * How many times in a row Familiars may hand a room's conversation on to
   * one another; `hand_off` refuses more, so two can't loop forever. A
   * positive whole number. Default `DEFAULT_MAX_HANDOFFS`, 3.
   */
  maxHandoffs?: number
  now?: HarnessOptions['now']
  setTimer?: HarnessOptions['setTimer']
  /**
   * For hosts whose process can be evicted between requests, such as a
   * Durable Object. With it, Familiar arms no timer for sleeping work
   * (schedules, upkeep, retries); it calls this after opening and whenever
   * `wake()` changes, and the host keeps its own wakeup armed and calls
   * `resume()` when it fires. Called after the commit that changed the value,
   * so arm a recovery wakeup before opening and before each call that can
   * start work. Must not block. Without it, an in-process timer resumes
   * sleeping work, as in the daemon.
   */
  onWake?: (wake: Wake) => void
}

/**
 * One Familiar in a workspace: its chat's model, memory and schedules.
 * People talk to it in rooms (`Workspace.rooms`).
 */
export type WorkspaceFamiliar = ConversationApi & {
  id: FamiliarId
  memory: MemoryApi
  schedules: SchedulesApi
  /**
   * Which of the workspace's plugins and MCP connections it uses. A new
   * Familiar uses all of them, and every Familiar gets one added later,
   * until it's turned off for that Familiar.
   */
  capabilities(): Promise<FamiliarCapabilities>
  /**
   * Changes what it uses, from its next request; each list given replaces
   * that kind's. Throws a CapabilityError for a name the workspace hasn't.
   */
  setCapabilities(change: CapabilitiesChange): Promise<void>
}

export type FamiliarSummary = FamiliarIdentity & { id: FamiliarId }

/** Who each Familiar is, by FamiliarId. */
export type FamiliarsState = { familiars: Record<string, FamiliarIdentity> }

/** The registry as people see it: who each Familiar is, without its workings. */
const identities = (registry: Readonly<Registry> | null): FamiliarsState => ({
  familiars: Object.fromEntries(
    Object.entries(registry?.familiars ?? {}).map(([id, { name, persona }]) => [
      id,
      { name, ...(persona !== undefined && { persona }) },
    ]),
  ),
})

/** A change to who a Familiar is. A `null` persona returns it to the default. */
export type FamiliarChange = {
  name?: string
  persona?: string | null
}

/**
 * Familiars, with what they share: the store, plugins, MCP connections and
 * the model login. Each Familiar has its own chat, memory and schedules.
 */
export type Workspace = {
  familiars: {
    list(): Promise<FamiliarSummary[]>
    /** Who each Familiar is, then every change. */
    watch(): Promise<WatchHandle<FamiliarsState>>
    /** An open Familiar, or undefined if there's no such Familiar. */
    get(id: FamiliarId): WorkspaceFamiliar | undefined
    /** Throws a TypeError for a blank name or persona. */
    create(identity: FamiliarIdentity): Promise<WorkspaceFamiliar>
    /**
     * Changes who it is, from its next request. Throws a TypeError for a
     * blank name or persona.
     */
    update(id: FamiliarId, change: FamiliarChange): Promise<void>
    /**
     * Removes it: stops its work and retires its configuration and memory.
     * It leaves every named room, which opens one it led and archives one
     * it leaves empty; its DMs stay readable but take no new messages.
     * Rooms keep its replies, under its name then. Throws for no such
     * Familiar.
     */
    remove(id: FamiliarId): Promise<void>
  }
  /**
   * Where people talk to Familiars: DMs, one per Familiar and person, and
   * named rooms with one or more Familiars.
   */
  rooms: RoomsApi
  /** Settles on dismissal or a storage failure. Failed instances must be reopened. */
  readonly closed: Promise<SessionEnd>
  /** The owner's login with the models' provider, if the host passed `account`. */
  account?: AccountApi
  connections: ConnectionsApi
  mcp: McpApi
  /**
   * Called after every commit. Listeners run synchronously, so keep them quick
   * and don't call back into the workspace. Returns a function that stops
   * listening.
   */
  onCommit(listener: () => void): () => void
  usage(): Promise<UsageState>
  /**
   * When the workspace next needs a running process: `active` while work can
   * run now or is running, `at` for the earliest sleep. For hosts that pass
   * `onWake`.
   */
  wake(): Wake
  /** Runs work that is due or that a lost process left. A host's wakeup calls it. */
  resume(): void
  dismiss(): Promise<void>
}

/** What a Familiar adopted from a pre-workspace store is called until renamed. */
const ADOPTED_NAME = 'Familiar'

/**
 * Opens a workspace over its storage, adopting a pre-workspace Familiar's
 * store, resuming whatever its Familiars were doing, and starts their
 * background work. One process per storage; `dismiss()` it when done.
 */
export async function openWorkspace(
  options: WorkspaceOptions,
): Promise<Workspace> {
  const context = BACKGROUND_CONTEXT
  const budget = options.contextBudget ?? DEFAULT_CONTEXT_BUDGET
  const chatModels = options.chatModels ?? [
    { model: options.model, thinkingLevel: 'medium' },
  ]
  checkTimeZone(options.timeZone)
  const model = findChatModel(chatModels, options.model)
  if (!model) {
    throw new Error(`${modelKey(options.model)} must be one of chatModels.`)
  }
  // Checked before storage opens, like the zone.
  const maxSchedules = checkMaxSchedules(options.maxSchedules)
  const maxHandoffs = checkMaxHandoffs(options.maxHandoffs)
  const account =
    options.account &&
    (await createAccount(
      options.models,
      options.model.provider,
      options.account,
    ))

  try {
    // Extensions can be installed after opening: nothing runs until resume().
    const registry = createRegistry()

    const harness = await Harness.open(
      options.storage,
      harnessOptions({ ...options, chatModels }, registry, budget),
      context,
    )

    const rooms = createRooms(harness, {
      timeZone: options.timeZone,
      now: options.now ?? Date.now,
      maxHandoffs,
    })
    const schedules = createSchedules({
      notify: options.notify,
      timeZone: options.timeZone,
      maxSchedules,
      post: rooms.postScheduled,
    })

    // Half the budget leaves room for the prompt, memory and the pass's tool calls.
    const memory = createMemory(harness, {
      now: options.now ?? Date.now,
      model: options.model,
      thinkingLevel: model.thinkingLevel,
      transcriptTokens: Math.floor(budget / 2),
      timeZone: options.timeZone,
    })

    const plugins = createPlugins({
      plugins: options.plugins ?? [],
      secrets: options.secrets,
      fetch: options.fetch,
      notify: options.notify,
      timeZone: options.timeZone,
    })

    // Every Familiar shares these; each tool, hook and section finds whose
    // conversation it runs in with familiarOf. Plugins last, so core's
    // tools and sections come first.
    const extensions = [
      ...[
        createPersona(options.hostInstructions),
        conversationExtension,
        ...(account ? [account.extension] : []),
        createTime(options.timeZone),
        ...memory.extensions,
        schedules.extension,
        rooms.extension,
      ].map(plugins.provide),
      ...plugins.extensions,
    ]

    for (const extension of extensions) {
      registry.install(extension)
    }

    const mcp = await createMcp(harness, registry, {
      fetch: options.mcpFetch,
      stdio: options.mcpStdio,
      secrets: options.secrets,
    })

    await harness.commit(
      (tx) => adoptPreWorkspaceFamiliar(tx, ADOPTED_NAME),
      context,
    )
    // The registries exist from the first open, so watches attach to them.
    await harness.commit(async (tx) => {
      await tx.doc(Familiars)
      await tx.doc(Rooms)
    }, context)

    // What a Familiar can be given: the workspace's now.
    const available = (): FamiliarCapabilities => ({
      plugins: (options.plugins ?? []).map((plugin) => plugin.name),
      mcp: mcp.names(),
    })

    const opened = new Map<FamiliarId, WorkspaceFamiliar>()
    const open = async (id: FamiliarId) => {
      const familiar: WorkspaceFamiliar = {
        id,
        ...(await installConversation(harness, id, {
          models: options.models,
          model: options.model,
          chatModels,
        })),
        memory: await memory.open(id),
        schedules: await schedules.open(harness, id),
        capabilities: async () =>
          capabilitiesOf(
            await harness.snapshot(AgentDoc, id, context),
            available(),
          ),
        setCapabilities: (change) =>
          harness.commit(
            (tx) => setCapabilities(tx, id, available(), change),
            context,
          ),
      }
      opened.set(id, familiar)
      return familiar
    }

    const list = async () =>
      Object.entries(
        identities((await harness.snapshot(Familiars, context)) ?? null)
          .familiars,
      ).map(([id, identity]) => ({ id: Number(id) as FamiliarId, ...identity }))

    for (const { id } of await list()) {
      await open(id)
    }

    // finish whatever the last process left unfinished
    harness.resume()

    return {
      familiars: {
        list,
        watch: async () =>
          viewWatch((await harness.watchDoc(Familiars, context))!, identities),
        get: (id) => opened.get(id),
        create: async (identity) =>
          open(
            await harness.commit((tx) => createFamiliar(tx, identity), context),
          ),
        update: async (id, { name, persona }) => {
          checkIdentity({ name, persona: persona ?? undefined })
          await harness.commit(async (tx) => {
            const record = await familiarRecord(tx, id)
            if (name !== undefined) {
              record.name = name
            }
            if (persona === null) {
              delete record.persona
            } else if (persona !== undefined) {
              record.persona = persona
            }
          }, context)
        },
        remove: async (id) => {
          await removeFamiliar(harness, id, context)
          opened.delete(id)
        },
      },
      rooms: rooms.api,
      account: account?.api,
      mcp: mcp.api,
      connections: allConnections(
        plugins.api,
        mcp.connections,
        options.secrets,
      ),
      onCommit: (listener) => harness.subscribeCommits(() => listener()),
      usage: () => harness.usage(context),
      closed: harness.closed,
      wake: () => harness.wake(),
      resume: () => harness.resume(),
      dismiss: async () => {
        account?.close()
        try {
          await harness.close(context)
        } finally {
          await mcp.close()
        }
      },
    }
  } catch (error) {
    account?.close()
    throw error
  }
}
