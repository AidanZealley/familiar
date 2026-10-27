import { applyImmutable } from '@earendil-works/chord/delta'
import type {
  ConversationView,
  EntryRecord,
  HistoryPage,
  DocumentName,
  Documents,
  PinBody,
  ReviseBody,
  SendBody,
  StreamEvent,
} from '@familiar/core/http'
import { createStore } from 'zustand/vanilla'

export type Connection = 'connecting' | 'open' | 'reconnecting'

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
  reviseFact(id: string, text: string): Promise<void>
  retireFact(id: string): Promise<void>
  setFactPinned(id: string, pinned: boolean): Promise<void>
  forgetFact(id: string): Promise<void>
  /** Stop streaming. The store keeps its last view. */
  disconnect(): void
}

/**
 * A live mirror of one Familiar's conversation. Framework-free: use it with
 * `useStore` from zustand in React, or `subscribe` anywhere else.
 *
 * @param baseUrl Where the HTTP API is mounted, e.g. `/api`.
 */
export function createFamiliarStore(baseUrl: string) {
  const events = new EventSource(`${baseUrl}/events`)

  const fetchOk = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${baseUrl}${path}`, init)
    if (!response.ok)
      throw new Error(
        `${path} failed: ${response.status} ${response.statusText}`,
      )
    return response
  }
  const request = async (method: string, path: string, body?: unknown) => {
    await fetchOk(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  let loading: Promise<boolean> | undefined
  const loadOlder = async () => {
    const state = store.getState()
    const { history } = state
    if (history.status === 'start') return false
    const before = oldestOf(state)
    if (before === undefined) return true
    store.setState({ history: { ...history, status: 'loading' } })
    try {
      const response = await fetchOk(
        `/history?before=${before}&limit=${HISTORY_PAGE}`,
      )
      const page = (await response.json()) as HistoryPage
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
    view: undefined,
    history: { entries: [], status: 'more' },
    loadOlder: () =>
      (loading ??= loadOlder().finally(() => (loading = undefined))),
    send: (text) =>
      request('POST', '/messages', {
        text,
        requestId: randomId(),
      } satisfies SendBody),
    abort: () => request('POST', '/abort'),
    reviseFact: (id, text) =>
      request('PUT', `/memory/${encodeURIComponent(id)}`, {
        text,
      } satisfies ReviseBody),
    retireFact: (id) =>
      request('POST', `/memory/${encodeURIComponent(id)}/retire`),
    setFactPinned: (id, pinned) =>
      request('PUT', `/memory/${encodeURIComponent(id)}/pin`, {
        pinned,
      } satisfies PinBody),
    forgetFact: (id) => request('DELETE', `/memory/${encodeURIComponent(id)}`),
    disconnect: () => events.close(),
  }))

  const on = <E extends StreamEvent['event']>(
    event: E,
    handle: (data: Extract<StreamEvent, { event: E }>['data']) => void,
  ) =>
    events.addEventListener(event, (message) =>
      handle(JSON.parse((message as MessageEvent<string>).data)),
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
  on('document', ({ name, value }) => store.setState({ [name]: value }))
  on('document.ops', ({ name, ops }) =>
    store.setState((state) => ({
      [name]: applyImmutable(state[name] ?? undefined, ops),
    })),
  )
  // EventSource reconnects by itself; the server answers with a fresh view.
  events.addEventListener('error', () =>
    store.setState({ connection: 'reconnecting' }),
  )

  return store
}

export type FamiliarStore = ReturnType<typeof createFamiliarStore>

const HISTORY_PAGE = 50

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
  if (from === undefined || to === undefined || to <= from) return history
  if (!before!.entries.some((entry) => entry.id === to))
    return { entries: [], status: 'more' }
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
