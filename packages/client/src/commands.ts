import { hc } from 'hono/client'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { ModelRef } from '@earendil-works/pi-durable'
import type {
  HttpApi,
  Connection as ConnectionKey,
  ConnectionInfo,
  CapabilitiesChange,
  FamiliarCapabilities,
  FamiliarIdentity,
  FamiliarSummary,
  McpServer,
  Mention,
  ModelOption,
  PushSubscriptionJson,
  RoomSummary,
} from '@familiar-ai/core/http'

/** A named room's setup, by Familiar IDs; open without a `lead`. */
export type RoomSetup = { name: string; familiars: number[]; lead?: number }

/** A change to a named room; a `null` lead opens it. */
export type RoomChange = Partial<Omit<RoomSetup, 'lead'>> & {
  lead?: number | null
}

export type Api = ReturnType<typeof hc<HttpApi>>

/** The typed client for an API at `baseUrl`, through `fetch`. */
export const createApi = (baseUrl: string, fetch: typeof globalThis.fetch) =>
  hc<HttpApi>(baseUrl, { fetch })

/** Rejects on an error status, which fetch doesn't. */
const succeed = async (request: Promise<Response>) => {
  const response = await request
  if (!response.ok) {
    throw await failed(response)
  }
}

/** What a response's success statuses carry. */
type Success<R> = R extends { ok: true; json(): Promise<infer T> } ? T : never

/** The body of a successful response; rejects on an error status. */
const read = async <R extends Response>(request: Promise<R>) => {
  const response = await request
  if (!response.ok) {
    throw await failed(response)
  }
  return (await response.json()) as Success<R>
}

/** What the workspace does: its login, push, connections, Familiars and rooms. */
export const workspaceCommands = (api: Api) => ({
  account: {
    signIn: () => succeed(api.account['sign-in'].$post()),
    answerSignIn: (text: string) =>
      succeed(api.account['sign-in'].answer.$post({ json: { text } })),
    cancelSignIn: () => succeed(api.account['sign-in'].$delete()),
    signOut: () => succeed(api.account['sign-out'].$post()),
  },
  push: {
    /** The VAPID key, or undefined when the host has no push. */
    key: async () => {
      const response = await api.push.key.$get()
      if (response.status === 404) {
        return undefined
      }
      if (!response.ok) {
        throw await failed(response)
      }
      return (await response.json()).key
    },
    subscribe: (subscription: PushSubscriptionJson) =>
      succeed(api.push.subscriptions.$post({ json: subscription })),
    unsubscribe: (subscription: PushSubscriptionJson) =>
      succeed(api.push.subscriptions.$delete({ json: subscription })),
  },
  connections: {
    list: (): Promise<ConnectionInfo[]> => read(api.connections.$get()),
    setSecret: (connection: ConnectionKey, secret: string, value: string) =>
      succeed(
        api.connections[':kind'][':name'].secrets[':secret'].$put({
          param: { ...connection, secret },
          json: { value },
        }),
      ),
    deleteSecret: (connection: ConnectionKey, secret: string) =>
      succeed(
        api.connections[':kind'][':name'].secrets[':secret'].$delete({
          param: { ...connection, secret },
        }),
      ),
  },
  mcp: {
    add: (server: McpServer) => succeed(api.mcp.$post({ json: server })),
    remove: (name: string) =>
      succeed(api.mcp[':name'].$delete({ param: { name } })),
    reconnect: (name: string) =>
      succeed(api.mcp[':name'].reconnect.$post({ param: { name } })),
  },
  familiars: {
    list: (): Promise<FamiliarSummary[]> => read(api.familiars.$get()),
    /**
     * Resolves to the new Familiar's ID. Without `capabilities`, it uses the
     * workspace's default tools.
     */
    create: async (
      identity: FamiliarIdentity & { capabilities?: CapabilitiesChange },
    ): Promise<number> =>
      (
        (await read(api.familiars.$post({ json: identity }))) as {
          id: number
        }
      ).id,
    /** A `null` persona returns it to the default. */
    update: (
      familiar: number,
      change: { name?: string; persona?: string | null },
    ) =>
      succeed(
        api.familiars[':familiar'].$patch({
          param: { familiar: String(familiar) },
          json: change,
        }),
      ),
    /**
     * Removes a Familiar: stops its work and retires its configuration and
     * memory. Rooms keep its history; its DMs close to new messages.
     */
    remove: (familiar: number) =>
      succeed(
        api.familiars[':familiar'].$delete({
          param: { familiar: String(familiar) },
        }),
      ),
    /** The signed-in person's DM with a Familiar, created if new: its room ID. */
    dm: async (familiar: number): Promise<number> =>
      (
        await read(
          api.familiars[':familiar'].dm.$post({
            param: { familiar: String(familiar) },
          }),
        )
      ).room,
  },
  /** The plugins and MCP connections a new Familiar uses by default. */
  defaults: {
    capabilities: (): Promise<FamiliarCapabilities> =>
      read(api.defaults.capabilities.$get()),
    /** Each list given replaces that kind's defaults. */
    setCapabilities: (change: CapabilitiesChange) =>
      succeed(api.defaults.capabilities.$put({ json: change })),
  },
  rooms: {
    /** Every named room and the signed-in person's own DMs. */
    list: (): Promise<RoomSummary[]> => read(api.rooms.$get()),
    /** Resolves to the new room's ID. */
    create: async (setup: RoomSetup): Promise<number> =>
      ((await read(api.rooms.$post({ json: setup }))) as { id: number }).id,
    update: (room: number, change: RoomChange) =>
      succeed(
        api.rooms[':room'].$patch({
          param: { room: String(room) },
          json: change,
        }),
      ),
    /** Hides a named room and closes it, keeping its history. */
    archive: (room: number) =>
      succeed(api.rooms[':room'].$delete({ param: { room: String(room) } })),
  },
})

/** What one Familiar does: its memory, schedules, model and capabilities. */
export const familiarCommands = (api: Api, id: number) => {
  const familiar = api.familiars[':familiar']
  const param = { familiar: String(id) }
  return {
    memory: {
      revise: (fact: string, text: string) =>
        succeed(
          familiar.memory[':id'].$put({
            param: { ...param, id: fact },
            json: { text },
          }),
        ),
      retire: (fact: string) =>
        succeed(
          familiar.memory[':id'].retire.$post({
            param: { ...param, id: fact },
          }),
        ),
      setPinned: (fact: string, pinned: boolean) =>
        succeed(
          familiar.memory[':id'].pin.$put({
            param: { ...param, id: fact },
            json: { pinned },
          }),
        ),
    },
    schedules: {
      cancel: (schedule: string) =>
        succeed(
          familiar.schedules[':id'].$delete({
            param: { ...param, id: schedule },
          }),
        ),
    },
    model: {
      options: (): Promise<ModelOption[]> =>
        read(familiar.model.options.$get({ param })),
      set: (model: ModelRef) =>
        succeed(familiar.model.$put({ param, json: model })),
      setThinkingLevel: (level: ModelThinkingLevel) =>
        succeed(
          familiar.model['thinking-level'].$put({ param, json: { level } }),
        ),
    },
    /** Which of the workspace's plugins and MCP connections it uses. */
    capabilities: {
      get: (): Promise<FamiliarCapabilities> =>
        read(familiar.capabilities.$get({ param })),
      /** Each list given replaces what it uses of that kind. */
      set: (change: CapabilitiesChange) =>
        succeed(familiar.capabilities.$put({ param, json: change })),
    },
  }
}

/** What one room does: posting, Stop and paging back. */
export const roomCommands = (api: Api, id: number) => {
  const room = api.rooms[':room']
  const param = { room: String(id) }
  return {
    /**
     * Posts a message as the signed-in person, addressing whoever
     * `mentions` picks (see `composeMessage`).
     */
    send: (text: string, mentions?: Mention[]) =>
      succeed(
        room.messages.$post({
          param,
          json: {
            text,
            requestId: randomId(),
            ...(mentions?.length && { mentions }),
          },
        }),
      ),
    /** Stops every turn in the room. */
    stop: () => succeed(room.stop.$post({ param })),
    history: async (before: number) =>
      read(room.history.$get({ param, query: { before: String(before) } })),
  }
}

/** The server's own message when it sends one, such as why a server was refused. */
const failed = async (response: Response) => {
  const body = await response.json().catch(() => undefined)
  return new Error(
    typeof body?.error === 'string'
      ? body.error
      : `${response.url} failed: ${response.status} ${response.statusText}`,
  )
}

/** 32 hex characters. getRandomValues, unlike randomUUID, works outside
 * secure contexts, such as plain HTTP LAN and tailnet previews. */
const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

export type FetchHistory = ReturnType<typeof roomCommands>['history']
