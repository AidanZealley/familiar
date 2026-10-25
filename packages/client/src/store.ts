import { applyImmutable } from '@earendil-works/chord/delta'
import type {
  ConversationView,
  MemoryState,
  ReviseBody,
  SendBody,
  StreamEvent,
} from '@familiar/core/http'
import { createStore } from 'zustand/vanilla'

export type Connection = 'connecting' | 'open' | 'reconnecting'

export type FamiliarState = {
  connection: Connection
  /** The server's view of the conversation, mirrored exactly. Absent until the first frame. */
  view: ConversationView | undefined
  /** What Familiar remembers, mirrored the same way. */
  memory: Readonly<MemoryState> | null | undefined
  send(text: string): Promise<void>
  abort(): Promise<void>
  reviseFact(id: string, text: string): Promise<void>
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

  const request = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok)
      throw new Error(
        `${path} failed: ${response.status} ${response.statusText}`,
      )
  }

  const store = createStore<FamiliarState>()(() => ({
    connection: 'connecting',
    view: undefined,
    memory: undefined,
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

  on('view', (view) => store.setState({ view, connection: 'open' }))
  on('ops', (ops) =>
    store.setState(({ view }) => ({ view: applyImmutable(view, ops) })),
  )
  on('memory', (memory) => store.setState({ memory }))
  on('memory.ops', (ops) =>
    store.setState(({ memory }) => ({
      memory: applyImmutable(memory ?? undefined, ops),
    })),
  )
  // EventSource reconnects by itself; the server answers with a fresh view.
  events.addEventListener('error', () =>
    store.setState({ connection: 'reconnecting' }),
  )

  return store
}

export type FamiliarStore = ReturnType<typeof createFamiliarStore>

/** 32 hex characters. getRandomValues, unlike randomUUID, works outside
 * secure contexts, such as plain HTTP LAN and tailnet previews. */
const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
