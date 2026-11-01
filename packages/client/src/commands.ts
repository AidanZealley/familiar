import { hc } from 'hono/client'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { ModelRef } from '@earendil-works/pi-durable'
import type {
  HttpApi,
  Connection as ConnectionKey,
  ConnectionInfo,
  MemoryHealth,
  ModelOption,
  McpServer,
  PushSubscriptionJson,
} from '@familiar-ai/core/http'
import type { FetchHistory } from './conversation.ts'

export const createCommands = (
  baseUrl: string,
  fetch: typeof globalThis.fetch,
) => {
  const api = hc<HttpApi>(baseUrl, { fetch })
  /** Rejects on an error status, which fetch doesn't. */
  const succeed = async (request: Promise<Response>) => {
    const response = await request

    if (!response.ok) {
      throw await failed(response)
    }
  }

  const commands = {
    account: {
      signIn: () => succeed(api.account['sign-in'].$post()),
      answerSignIn: (text: string) =>
        succeed(api.account['sign-in'].answer.$post({ json: { text } })),
      cancelSignIn: () => succeed(api.account['sign-in'].$delete()),
      signOut: () => succeed(api.account['sign-out'].$post()),
    },
    conversation: {
      send: (text: string) =>
        succeed(api.messages.$post({ json: { text, requestId: randomId() } })),
      abort: () => succeed(api.abort.$post()),
      modelOptions: async (): Promise<ModelOption[]> => {
        const response = await api.model.options.$get()
        if (!response.ok) {
          throw await failed(response)
        }
        return response.json()
      },
      setModel: (model: ModelRef) => succeed(api.model.$put({ json: model })),
      setThinkingLevel: (level: ModelThinkingLevel) =>
        succeed(api.model['thinking-level'].$put({ json: { level } })),
    },
    memory: {
      revise: (id: string, text: string) =>
        succeed(api.memory[':id'].$put({ param: { id }, json: { text } })),
      retire: (id: string) =>
        succeed(api.memory[':id'].retire.$post({ param: { id } })),
      setPinned: (id: string, pinned: boolean) =>
        succeed(
          api.memory[':id'].pin.$put({ param: { id }, json: { pinned } }),
        ),
      health: async (): Promise<MemoryHealth> => {
        const response = await api.memory.health.$get()
        if (!response.ok) {
          throw await failed(response)
        }
        return response.json()
      },
    },
    schedules: {
      cancel: (id: string) =>
        succeed(api.schedules[':id'].$delete({ param: { id } })),
    },
    push: {
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
      list: async (): Promise<ConnectionInfo[]> => {
        const response = await api.connections.$get()
        if (!response.ok) {
          throw await failed(response)
        }
        return response.json()
      },
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
  }
  const history: FetchHistory = async (before) => {
    const response = await api.history.$get({
      query: { before: String(before) },
    })
    if (!response.ok) {
      throw await failed(response)
    }
    return response.json()
  }
  return { commands, history }
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

export type Commands = ReturnType<typeof createCommands>['commands']
