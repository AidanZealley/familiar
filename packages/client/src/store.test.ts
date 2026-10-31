import type { ConversationView, EntryRecord } from '@earendil-works/pi-durable'
import type { McpServer } from '@familiar/core/http'
import { afterEach, expect, test, vi } from 'vitest'
import { createFamiliarStore } from './store.ts'

const entry = (id: number) =>
  ({ id, conversationId: 1, kind: 'pi.system' }) as unknown as EntryRecord

// Stands in for the server: one event source, and history before entry 3.
function setup() {
  const listeners = new Map<string, (event: MessageEvent) => void>()
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        listeners.set(type, listener)
      }
      close() {}
    },
  )
  const requests: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(url)
    const before = Number(new URL(url, 'http://x').searchParams.get('before'))
    const entries = before > 1 ? [entry(before - 1)] : []
    return Response.json({ entries, more: before - 1 > 1 })
  })
  const store = createFamiliarStore('/api')
  const view = { conversation: {}, entries: [entry(3)], docs: {} }
  listeners.get('view')!({ data: JSON.stringify(view) } as MessageEvent)
  const emit = (type: string, data: unknown) =>
    listeners.get(type)!({ data: JSON.stringify(data) } as MessageEvent)
  return { store, requests, emit }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('account is undefined until the server says, and null when it offers no sign-in', () => {
  const { store, emit } = setup()
  expect(store.getState().account).toBeUndefined()

  emit('account', null)
  expect(store.getState().account).toBeNull()

  emit('account', { status: 'signed-in' })
  expect(store.getState().account).toEqual({ status: 'signed-in' })
})

test('loadOlder pages back to the start, one request per page', async () => {
  const { store, requests } = setup()
  const { loadOlder } = store.getState()

  const first = loadOlder()
  expect(store.getState().history.status).toBe('loading')
  // A second call while loading shares the first's request.
  expect(loadOlder()).toBe(first)
  expect(await first).toBe(true)
  expect(await loadOlder()).toBe(false)
  expect(await loadOlder()).toBe(false)

  expect(requests).toEqual(['/api/history?before=3', '/api/history?before=2'])
  expect(store.getState().history).toEqual({
    entries: [entry(1), entry(2)],
    status: 'start',
  })
  expect((store.getState().view as ConversationView).entries).toEqual([
    entry(3),
  ])
})

test("MCP edits reach their routes and reject with the server's reason", async () => {
  const { store } = setup()
  const sent: string[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push(`${init.method} ${url} ${init.body ?? ''}`.trim())
    return url.endsWith('/reconnect')
      ? new Response(null, { status: 202 })
      : Response.json(
          { error: 'MCP server notes already exists.' },
          { status: 404 },
        )
  })
  const { addMcpServer, reconnectMcpServer } = store.getState()
  const notes: McpServer = {
    name: 'notes',
    transport: { type: 'stdio', command: 'notes-mcp', args: [] },
  }

  await expect(addMcpServer(notes)).rejects.toThrow(
    'MCP server notes already exists.',
  )
  await reconnectMcpServer('notes')

  expect(sent).toEqual([
    `POST /api/mcp ${JSON.stringify(notes)}`,
    'POST /api/mcp/notes/reconnect',
  ])
})
