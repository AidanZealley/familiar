import type { HttpApi } from '@familiar-ai/core/http'
import { hc } from 'hono/client'
import type { FamiliarState } from './store.ts'
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
    signIn: () => succeed(api.account['sign-in'].$post()),
    answerSignIn: (text) =>
      succeed(api.account['sign-in'].answer.$post({ json: { text } })),
    cancelSignIn: () => succeed(api.account['sign-in'].$delete()),
    signOut: () => succeed(api.account['sign-out'].$post()),
    send: (text) =>
      succeed(api.messages.$post({ json: { text, requestId: randomId() } })),
    abort: () => succeed(api.abort.$post()),
    modelOptions: async () => {
      const response = await api.model.options.$get()
      if (!response.ok) {
        throw await failed(response)
      }
      return response.json()
    },
    setModel: (model) => succeed(api.model.$put({ json: model })),
    setThinkingLevel: (level) =>
      succeed(api.model['thinking-level'].$put({ json: { level } })),
    reviseFact: (id, text) =>
      succeed(api.memory[':id'].$put({ param: { id }, json: { text } })),
    retireFact: (id) =>
      succeed(api.memory[':id'].retire.$post({ param: { id } })),
    setFactPinned: (id, pinned) =>
      succeed(api.memory[':id'].pin.$put({ param: { id }, json: { pinned } })),
    cancelSchedule: (id) =>
      succeed(api.schedules[':id'].$delete({ param: { id } })),
    pushKey: async () => {
      const response = await api.push.key.$get()
      if (response.status === 404) {
        return undefined
      }
      if (!response.ok) {
        throw await failed(response)
      }
      return (await response.json()).key
    },
    subscribePush: (subscription) =>
      succeed(api.push.subscriptions.$post({ json: subscription })),
    unsubscribePush: (subscription) =>
      succeed(api.push.subscriptions.$delete({ json: subscription })),
    connections: async () => {
      const response = await api.connections.$get()
      if (!response.ok) {
        throw await failed(response)
      }
      return response.json()
    },
    memoryHealth: async () => {
      const response = await api.memory.health.$get()
      if (!response.ok) {
        throw await failed(response)
      }
      return response.json()
    },
    setSecret: (connection, secret, value) =>
      succeed(
        api.connections[':kind'][':name'].secrets[':secret'].$put({
          param: { ...connection, secret },
          json: { value },
        }),
      ),
    deleteSecret: (connection, secret) =>
      succeed(
        api.connections[':kind'][':name'].secrets[':secret'].$delete({
          param: { ...connection, secret },
        }),
      ),
    addMcpServer: (server) => succeed(api.mcp.$post({ json: server })),
    removeMcpServer: (name) =>
      succeed(api.mcp[':name'].$delete({ param: { name } })),
    reconnectMcpServer: (name) =>
      succeed(api.mcp[':name'].reconnect.$post({ param: { name } })),
  } satisfies Pick<
    FamiliarState,
    | 'signIn'
    | 'answerSignIn'
    | 'cancelSignIn'
    | 'signOut'
    | 'send'
    | 'abort'
    | 'modelOptions'
    | 'setModel'
    | 'setThinkingLevel'
    | 'reviseFact'
    | 'retireFact'
    | 'setFactPinned'
    | 'cancelSchedule'
    | 'pushKey'
    | 'subscribePush'
    | 'unsubscribePush'
    | 'connections'
    | 'memoryHealth'
    | 'setSecret'
    | 'deleteSecret'
    | 'addMcpServer'
    | 'removeMcpServer'
    | 'reconnectMcpServer'
  >
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
