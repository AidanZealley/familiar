import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { MemoryStorage } from '@earendil-works/pi-durable'
import {
  memorySecrets,
  summonFamiliar,
  type Familiar,
  type PluginFetch,
} from '@familiar/core'
import { afterEach, expect, test } from 'vitest'
import web from './index.ts'
import { timestamp } from './format.ts'

const KEY = 'BSA-test-0123456789'

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

/** Answers each request with whatever `respond` returns for it. */
async function setup(respond: (url: URL, init?: RequestInit) => Response) {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const secrets = memorySecrets()

  const sent: { url: URL; init?: RequestInit }[] = []
  const fetch: PluginFetch = async (input, init) => {
    const url = new URL(input)
    sent.push({ url, init })
    return respond(url, init)
  }

  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    plugins: [web],
    secrets,
    fetch,
  })
  opened.push(familiar)

  /** Asks the model to call a tool, and returns the text of its result. */
  let calls = 0
  const callTool = async (
    name: string,
    args: Parameters<typeof fauxToolCall>[1],
  ) => {
    let result: { content: { text?: string }[]; isError: boolean } | undefined
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' }),
      (context) => {
        result = context.messages.at(-1) as typeof result
        return fauxAssistantMessage('Done.')
      },
    ])
    await familiar.send({
      author: 'owner',
      text: 'Go',
      requestId: `go-${++calls}`,
    })
    await familiar.idle()
    return {
      text: result!.content.map((part) => part.text ?? '').join(''),
      isError: result!.isError,
    }
  }
  const setKey = () =>
    secrets.set({ kind: 'plugin', name: 'web' }, 'braveApiKey', KEY)
  return { sent, callTool, setKey }
}

const braveResults = (count: number) => ({
  type: 'search',
  query: { original: 'cats' },
  web: {
    type: 'search',
    results: Array.from({ length: count }, (_, i) => ({
      title: `Cats &amp; kittens ${i + 1}`,
      url: `https://example.com/cats/${i + 1}`,
      description: `About <strong>cats</strong>. ${'Whiskers. '.repeat(100)}`,
      page_age: '2026-10-01T09:30:00',
      age: 'October 1, 2026',
    })),
  },
})

test('web_search sends the key in Brave header and returns compact, numbered results', async () => {
  const { sent, callTool, setKey } = await setup(() =>
    Response.json(braveResults(20)),
  )
  await setKey()

  const { text, isError } = await callTool('web_search', {
    query: 'cats',
    freshness: 'week',
    domains: ['https://Example.com/'],
  })
  expect(isError).toBe(false)

  const [{ url, init }] = sent
  expect(url.origin + url.pathname).toBe(
    'https://api.search.brave.com/res/v1/web/search',
  )
  expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe(KEY)
  expect(url.searchParams.get('q')).toBe('cats site:example.com')
  expect(url.searchParams.get('count')).toBe('5')
  expect(url.searchParams.get('freshness')).toBe('pw')

  expect(text).toMatch(/^Brave Search results for "cats", \d{4}-\d\d-\d\d /)
  expect(text).toContain(
    '1. Cats & kittens 1\n   https://example.com/cats/1\n   Published 2026-10-01\n   About cats. Whiskers.',
  )
  expect(text).toContain('5. Cats & kittens 5')
  expect(text).not.toContain('6. ')
  expect(text).not.toContain('<strong>')
  expect(text.length).toBeLessThanOrEqual(8_000)
  // Each snippet is cut to 500 characters.
  for (const line of text.split('\n')) {
    expect(line.length).toBeLessThanOrEqual(503)
  }
  expect(text).not.toContain(KEY)
})

test('web_search keeps the whole output to 8,000 characters', async () => {
  const { callTool, setKey } = await setup(() => {
    const body = braveResults(10)
    for (const result of body.web.results) {
      result.title = `${result.title} ${'long '.repeat(80)}`
    }
    return Response.json(body)
  })
  await setKey()

  const { text } = await callTool('web_search', { query: 'cats', count: 10 })
  expect(text.length).toBeLessThanOrEqual(8_000)
  expect(text).toContain('1. Cats')
  expect(text).not.toContain('10. Cats')
})

test('times are written in local time', () => {
  const zone = process.env.TZ
  process.env.TZ = 'Asia/Kolkata'
  try {
    expect(timestamp(Date.UTC(2026, 9, 28, 14, 5))).toBe('2026-10-28 19:35')
  } finally {
    if (zone === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = zone
    }
  }
})

const article =
  '<nav>Menu</nav><main><h1>Purrs</h1><p>Read <a href="/more">more</a>.</p><pre><code>cat()</code></pre><table><tr><th>Cat</th></tr><tr><td>Tabby</td></tr></table></main><footer>Footer</footer>'

test('web_fetch reads an article without sending the search key', async () => {
  const { sent, callTool, setKey } = await setup(
    () => new Response(article, { headers: { 'content-type': 'text/html' } }),
  )
  await setKey()
  const { text, isError } = await callTool('web_fetch', {
    url: 'https://cats.example/purrs',
  })
  expect(isError).toBe(false)
  expect(text).toContain('# Purrs')
  expect(text).toContain('[more](https://cats.example/more)')
  expect(text).toContain('cat()')
  expect(text).toContain('Tabby')
  expect(text).not.toMatch(/Menu|Footer/)
  expect(new Headers(sent[0].init?.headers).has('X-Subscription-Token')).toBe(
    false,
  )
})

test.each(['text/html', 'text/markdown', 'text/plain'])(
  'web_fetch bounds %s output and marks truncation',
  async (type) => {
    const { callTool } = await setup(
      () =>
        new Response('a'.repeat(100), { headers: { 'content-type': type } }),
    )
    const { text, isError } = await callTool('web_fetch', {
      url: 'https://cats.example',
      maxChars: 12,
    })
    expect(isError).toBe(false)
    expect(text).toContain('aaaaaaaaaaaa\n\n[Content truncated]')
    expect(text).not.toContain('a'.repeat(13))
  },
)

test('web_fetch refuses oversized bodies and cancels the stream', async () => {
  let cancelled = false
  const body = new ReadableStream({
    pull: (controller) => controller.enqueue(new Uint8Array(1024 * 1024)),
    cancel: () => {
      cancelled = true
    },
  })
  const { callTool } = await setup(
    () => new Response(body, { headers: { 'content-type': 'text/plain' } }),
  )
  const { text, isError } = await callTool('web_fetch', {
    url: 'https://cats.example/large',
  })
  expect(isError).toBe(true)
  expect(text).toContain('larger than 3 MB')
  expect(cancelled).toBe(true)
})

test('web_fetch refuses unsupported documents and non-web URLs', async () => {
  const { sent, callTool } = await setup(
    () =>
      new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
  )
  expect(
    (await callTool('web_fetch', { url: 'file:///etc/passwd' })).isError,
  ).toBe(true)
  expect(sent).toHaveLength(0)
  expect(
    (await callTool('web_fetch', { url: 'https://cats.example/cat.pdf' })).text,
  ).toContain('Unsupported page type')
})
