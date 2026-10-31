import { applyImmutable } from '@earendil-works/chord/delta'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type {
  AgentState,
  ConversationView,
  EntryRecord,
  ModelRef,
} from '@earendil-works/pi-durable'
import type {
  AccountState,
  Connection as ConnectionKey,
  ConnectionInfo,
  DocumentName,
  Documents,
  HttpApi,
  McpServer,
  MemoryHealth,
  ModelOption,
  PushSubscriptionJson,
  StreamEvent,
} from '@familiar/core/http'
import { EventSource, type FetchLike } from 'eventsource'
import { hc } from 'hono/client'
import { createStore } from 'zustand/vanilla'

/**
 * The event stream's state. It goes `open` when a full view arrives.
 * `reconnecting` follows a network error, a stream that ended, or a 5xx or
 * 429 answer, and retries after the server's `retry` delay (3 seconds unless
 * it sets one). Two states stop retrying: `unauthorized` when the stream is
 * answered 401 or 403, and `failed` for any other answer it can't use, such
 * as a 404 or a page that isn't an event stream. To recover from either,
 * disconnect and create a new store.
 */
export type Connection =
  'connecting' | 'open' | 'reconnecting' | 'unauthorized' | 'failed'

export type FamiliarStoreOptions = {
  /**
   * Makes every request: each API call, the event stream, and each of the
   * stream's reconnects, so a host can attach a fresh credential each time.
   * It gets the URL and an init with the method, body, headers and abort
   * signal to pass on. Defaults to the platform's `fetch`.
   */
  fetch?: typeof fetch
}

/** The conversation before the view, as far back as it has been loaded. */
export type History = {
  /** Committed entries older than any in the view, oldest first. */
  entries: readonly EntryRecord[]
  /**
   * `start` once `entries` reaches the start of the conversation; `failed`
   * if the last load did, until the next one.
   */
  status: 'more' | 'loading' | 'failed' | 'start'
}

/**
 * Every document the server streams, such as `memory` and `episodes`,
 * mirrored like the view under its own name. Undefined until it arrives.
 */
export type MirroredDocuments = {
  [Name in DocumentName]?: Readonly<Documents[Name]> | null
}

export type FamiliarState = MirroredDocuments & {
  connection: Connection
  /**
   * The owner's login with the models' provider: null when the server offers
   * no sign-in because its host manages credentials, undefined until the
   * first frame.
   */
  account: AccountState | null | undefined
  /** Starts signing in; the page to open, and any code, arrive in `account`. */
  signIn(): Promise<void>
  /** The address the browser ended on, when `account` asks to paste it. */
  answerSignIn(text: string): Promise<void>
  cancelSignIn(): Promise<void>
  signOut(): Promise<void>
  /** The server's view of the conversation, mirrored exactly. Absent until the first frame. */
  view: ConversationView | undefined
  history: History
  /**
   * Load the page of entries before the oldest the store has. Resolves to
   * whether older ones remain; a call while one is loading shares its result.
   */
  loadOlder(): Promise<boolean>
  send(text: string): Promise<void>
  abort(): Promise<void>
  /** The models the conversation may switch to; `agentOf` says which it's on. */
  modelOptions(): Promise<ModelOption[]>
  setModel(model: ModelRef): Promise<void>
  /** Changes the current model's level, remembered for that model. */
  setThinkingLevel(level: ModelThinkingLevel): Promise<void>
  reviseFact(id: string, text: string): Promise<void>
  retireFact(id: string): Promise<void>
  setFactPinned(id: string, pinned: boolean): Promise<void>
  cancelSchedule(id: string): Promise<void>
  /** The key to subscribe to push with, or undefined if the server has no push. */
  pushKey(): Promise<string | undefined>
  subscribePush(subscription: PushSubscriptionJson): Promise<void>
  unsubscribePush(subscription: PushSubscriptionJson): Promise<void>
  /** Every connection and whether each secret is set. Never values. */
  connections(): Promise<ConnectionInfo[]>
  /** Memory's health numbers, measured when asked. */
  memoryHealth(): Promise<MemoryHealth>
  setSecret(
    connection: ConnectionKey,
    secret: string,
    value: string,
  ): Promise<void>
  deleteSecret(connection: ConnectionKey, secret: string): Promise<void>
  /** Saves an MCP server, which then connects in the background. */
  addMcpServer(server: McpServer): Promise<void>
  removeMcpServer(name: string): Promise<void>
  reconnectMcpServer(name: string): Promise<void>
  /**
   * Closes the stream and cancels any reconnect, including one waiting on the
   * host's fetch. The store keeps its last state. Commands already sent still
   * settle with their callers.
   */
  disconnect(): void
}

/**
 * A live mirror of one Familiar's conversation. Framework-free: use it with
 * `useStore` from zustand in React, or `subscribe` anywhere else.
 *
 * A command that fails rejects with the server's reason and is never sent
 * again. Only the stream retries, and only by reconnecting.
 *
 * @param baseUrl Where the HTTP API is mounted: `/api`, or a full URL.
 */
export function createFamiliarStore(
  baseUrl: string,
  options: FamiliarStoreOptions = {},
) {
  // Looks the global up on each call, so a later polyfill or stub counts.
  const fetch: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const listeners = new AbortController()
  const api = hc<HttpApi>(baseUrl, { fetch })
  const events = new EventSource(`${baseUrl}/events`, {
    fetch: (url, init) => connect(fetch, url, init),
  })

  /** Rejects on an error status, which fetch doesn't. */
  const succeed = async (request: Promise<Response>) => {
    const response = await request

    if (!response.ok) {
      throw await failed(response)
    }
  }

  let loading: Promise<boolean> | undefined
  const loadOlder = async () => {
    const state = store.getState()
    const { history } = state
    if (history.status === 'start') {
      return false
    }
    const before = oldestOf(state)
    if (before === undefined) {
      return true
    }
    store.setState({ history: { ...history, status: 'loading' } })
    try {
      const response = await api.history.$get({
        query: { before: String(before) },
      })

      if (!response.ok) {
        throw await failed(response)
      }

      const page = await response.json()
      const current = store.getState()
      // A reconnect left a gap, so history starts again from the new view.
      if (oldestOf(current) !== before) {
        store.setState({ history: { ...current.history, status: 'more' } })
        return true
      }
      store.setState({
        history: {
          entries: [...page.entries.toReversed(), ...current.history.entries],
          status: page.more ? 'more' : 'start',
        },
      })
      return page.more
    } catch (error) {
      store.setState(({ history }) => ({
        history: { ...history, status: 'failed' },
      }))
      throw error
    }
  }

  const store = createStore<FamiliarState>()(() => ({
    connection: 'connecting',
    account: undefined,
    signIn: () => succeed(api.account['sign-in'].$post()),
    answerSignIn: (text) =>
      succeed(api.account['sign-in'].answer.$post({ json: { text } })),
    cancelSignIn: () => succeed(api.account['sign-in'].$delete()),
    signOut: () => succeed(api.account['sign-out'].$post()),
    view: undefined,
    history: { entries: [], status: 'more' },
    loadOlder: () =>
      (loading ??= loadOlder().finally(() => (loading = undefined))),
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
    disconnect: () => {
      listeners.abort()
      events.close()
    },
  }))

  const on = <E extends StreamEvent['event']>(
    event: E,
    handle: (data: Extract<StreamEvent, { event: E }>['data']) => void,
  ) =>
    events.addEventListener(
      event,
      (message) => handle(JSON.parse(message.data)),
      { signal: listeners.signal },
    )

  on('view', (view) =>
    store.setState((state) => ({
      view,
      history: carryOver(state.history, state.view, view),
      connection: 'open',
    })),
  )
  on('ops', (ops) =>
    store.setState((state) => {
      const view = applyImmutable(state.view, ops)
      return { view, history: carryOver(state.history, state.view, view) }
    }),
  )
  on('account', (account) => store.setState({ account }))
  on('document', ({ name, value }) => store.setState({ [name]: value }))
  on('document.ops', ({ name, ops }) =>
    store.setState((state) => ({
      [name]: applyImmutable(state[name] ?? undefined, ops),
    })),
  )
  // EventSource reconnects by itself unless it has closed, and the server
  // answers each reconnect with a fresh view and documents.
  events.addEventListener(
    'error',
    ({ code }) =>
      store.setState({
        connection:
          events.readyState !== EventSource.CLOSED
            ? 'reconnecting'
            : code === 401 || code === 403
              ? 'unauthorized'
              : 'failed',
      }),
    { signal: listeners.signal },
  )

  return store
}

export type FamiliarStore = ReturnType<typeof createFamiliarStore>

/**
 * Opens the event stream through the host's fetch. EventSource gives up on
 * any status but 200, as the spec says, so server errors and rate limits
 * throw here and it retries them like a dropped connection instead.
 *
 * A response that arrives after `disconnect` is dropped here, in case the
 * host's fetch didn't pass the abort signal on. Piping the returned body
 * with that signal also cancels its producer if disconnect happens during
 * the handoff to EventSource or while it is reading.
 */
const connect = async (
  fetch: typeof globalThis.fetch,
  ...[url, init]: Parameters<FetchLike>
) => {
  const response = await fetch(url, init)

  if (init.signal?.aborted) {
    void response.body?.cancel().catch(() => {})
    throw init.signal.reason
  }

  if (response.status >= 500 || response.status === 429) {
    void response.body?.cancel().catch(() => {})
    throw new Error(`${url} failed: ${response.status}`)
  }

  // FetchLike needs only these fields. Preserve redirect metadata while the
  // platform pipe owns cancellation, even after EventSource locks its reader.
  return {
    url: response.url,
    status: response.status,
    redirected: response.redirected,
    headers: response.headers,
    body:
      response.body?.pipeThrough(new TransformStream(), {
        signal: init.signal,
      }) ?? null,
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

/** The conversation's model and reasoning level, as Pi stores them. */
export const agentOf = (view: ConversationView | undefined) =>
  view?.docs['pi.agent'] as AgentState | undefined

/**
 * The oldest entry in a view. A view opens with its head marker, such as a
 * compaction summary, which is newer than the entry it heads.
 */
export const startOf = (view: ConversationView) =>
  view.entries[0] && (view.entries[0].head ?? view.entries[0].id)

const oldestOf = ({ view, history }: Pick<FamiliarState, 'view' | 'history'>) =>
  history.entries[0]?.id ?? (view && startOf(view))

/**
 * History after the view moves from `before` to `after`. Compaction moves the
 * view's start forward, and what leaves the view joins history, so loaded
 * history stays contiguous with it. If the new view starts somewhere the old
 * one never reached, as after a long disconnect, history starts over.
 */
export function carryOver(
  history: History,
  before: ConversationView | undefined,
  after: ConversationView | undefined,
): History {
  const from = before && startOf(before)
  const to = after && startOf(after)
  if (from === undefined || to === undefined || to <= from) {
    return history
  }
  if (!before!.entries.some((entry) => entry.id === to)) {
    return { entries: [], status: 'more' }
  }
  const left = before!.entries.filter((entry) => entry.id < to)
  return {
    ...history,
    entries: [...history.entries, ...left].toSorted((a, b) => a.id - b.id),
  }
}

/** 32 hex characters. getRandomValues, unlike randomUUID, works outside
 * secure contexts, such as plain HTTP LAN and tailnet previews. */
const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
