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
import { MAX_BYTES } from './fetch-page.ts'
import web from './index.ts'
import { timestamp } from './shared.ts'

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
    count: 10,
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
  expect(url.searchParams.get('count')).toBe('10')
  expect(url.searchParams.get('freshness')).toBe('pw')

  expect(text).toMatch(/^Brave Search results for "cats", \d{4}-\d\d-\d\d /)
  expect(text).toContain(
    '1. Cats & kittens 1\n   https://example.com/cats/1\n   Published 2026-10-01\n   About cats. Whiskers.',
  )
  expect(text).toContain('10. Cats & kittens 10')
  expect(text).not.toContain('11. ')
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

test('web_search asks for five results unless told otherwise', async () => {
  const { sent, callTool, setKey } = await setup(() =>
    Response.json(braveResults(5)),
  )
  await setKey()
  await callTool('web_search', { query: 'cats' })
  expect(sent[0].url.searchParams.get('count')).toBe('5')
  expect(sent[0].url.searchParams.has('freshness')).toBe(false)
})

test('without the key, the model is told to ask the owner', async () => {
  const { sent, callTool } = await setup(() => Response.json(braveResults(1)))
  const { text, isError } = await callTool('web_search', { query: 'cats' })
  expect(isError).toBe(true)
  expect(text).toContain(
    "Web search isn't connected. Ask the owner to add Brave Search API key on the Connections page.",
  )
  expect(sent).toEqual([])
})

const ARTICLE = `<!doctype html>
<html>
  <head>
    <title>How cats purr | Cat Facts</title>
    <script>document.write('ads')</script>
  </head>
  <body>
    <nav><a href="/">Home</a> <a href="/shop">Shop</a></nav>
    <article>
      <h1>How cats purr</h1>
      <p>
        Cats purr by twitching the muscles of the larynx, which makes the
        vocal folds separate and close quickly as they breathe in and out.
        Researchers at the <a href="/about">Cat Institute</a> measured purrs
        between 25 and 150 hertz in domestic cats of every age and size.
      </p>
      <h2>Measuring a purr</h2>
      <p>
        A small microphone held against the throat records the sound, and the
        frequency is read from its spectrum. Most purrs sit near 26 hertz,
        a frequency some studies associate with healing bones and tissue.
      </p>
      <pre><code class="language-python">purr = record(cat)\nprint(purr.frequency)</code></pre>
      <table>
        <thead><tr><th>Cat</th><th>Hertz</th></tr></thead>
        <tbody><tr><td>Tabby</td><td>26</td></tr><tr><td>Siamese</td><td>31</td></tr></tbody>
      </table>
      <p>
        Big cats are different: lions and tigers roar instead, because the
        bones of their throats are only partly turned to bone, which lets the
        larynx stretch further and produce a deeper, longer sound than a purr.
      </p>
    </article>
    <footer>© Cat Facts</footer>
  </body>
</html>`

const page = (body: BodyInit, type: string) => () =>
  new Response(body, { headers: { 'content-type': type } })

test('web_fetch turns an article into Markdown with its links', async () => {
  const { sent, callTool } = await setup(
    page(ARTICLE, 'text/html; charset=utf-8'),
  )
  const { text, isError } = await callTool('web_fetch', {
    url: 'https://cats.example/purring',
  })
  expect(isError).toBe(false)
  // No secret goes with a page read.
  expect(new Headers(sent[0].init?.headers).has('X-Subscription-Token')).toBe(
    false,
  )

  expect(text).toMatch(
    /^Title: How cats purr.*\nURL: https:\/\/cats\.example\/purring\nRetrieved: \d{4}-\d\d-\d\d \d\d:\d\d\n\n/,
  )
  expect(text).toContain('## Measuring a purr')
  expect(text).toContain('[Cat Institute](https://cats.example/about)')
  expect(text).toContain(
    '```python\npurr = record(cat)\nprint(purr.frequency)\n```',
  )
  expect(text).toContain('| Cat | Hertz |\n| - | - |\n| Tabby | 26 |')
  expect(text).not.toContain('document.write')
  expect(text).not.toContain('Shop')
})

test('web_fetch passes plain text through and cuts long pages with a marker', async () => {
  const long = 'purr '.repeat(10_000)
  const { callTool } = await setup(page(long, 'text/plain'))
  const { text } = await callTool('web_fetch', {
    url: 'https://cats.example/long.txt',
    maxChars: 1_000,
  })
  const total = long.trim().length
  expect(text).toContain(`\n\npurr purr`)
  expect(text).toMatch(
    new RegExp(`\\n\\n\\[cut at 1000 of ${total} characters\\]$`),
  )
  expect(text.length).toBeLessThan(1_200)
})

test('web_fetch stops reading at the size limit', async () => {
  const chunk = new TextEncoder().encode('purr '.repeat(13_107)) // 64 KiB
  let pulled = 0
  let cancelled = false
  const endless = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      pulled += chunk.length
      controller.enqueue(chunk)
    },
    cancel: () => {
      cancelled = true
    },
  })
  const { callTool } = await setup(page(endless, 'text/markdown'))

  const { text, isError } = await callTool('web_fetch', {
    url: 'https://cats.example/endless.md',
  })
  expect(isError).toBe(false)
  expect(text).toContain('Read only the first 3 MB.')
  expect(text).toContain('[cut at 12000 of ')
  expect(cancelled).toBe(true)
  // The stream may read ahead a chunk or two, but no further.
  expect(pulled).toBeLessThan(MAX_BYTES + 4 * chunk.length)
})

test('web_fetch refuses a PDF', async () => {
  const { callTool } = await setup(page('%PDF-1.7', 'application/pdf'))
  const { text, isError } = await callTool('web_fetch', {
    url: 'https://cats.example/purring.pdf',
  })
  expect(isError).toBe(true)
  expect(text).toContain("application/pdf isn't supported")
})

test('web_fetch reads a page that leaves out its optional tags', async () => {
  const { callTool } = await setup(
    page(
      '<!doctype html><title>Purrs</title><p>See <a href="/more">more</a>.</p>',
      'text/html',
    ),
  )
  const { text } = await callTool('web_fetch', {
    url: 'https://cats.example/short',
  })
  expect(text).toContain('Title: Purrs')
  expect(text).toContain('See [more](https://cats.example/more).')
})

test('web_fetch keeps a table on a page that leaves out its optional tags', async () => {
  const { callTool } = await setup(
    page(
      '<title>Purrs</title><table><tr><td>Tabby<td>26<tr><td>Siamese<td>31</table>',
      'text/html',
    ),
  )
  const { text } = await callTool('web_fetch', {
    url: 'https://cats.example/table',
  })
  expect(text).toContain(
    // Without <th> cells, the header row stays empty rather than claim a
    // row of data.
    '| | |\n| - | - |\n| Tabby | 26 |\n| Siamese | 31 |',
  )
})

test.each([
  [
    '300,000 paragraphs',
    '<p>x</p>'.repeat(300_000),
    'more than 50,000 elements',
  ],
  [
    '10,000 nested elements',
    `${'<div>'.repeat(10_000)}x`,
    'more than 256 levels',
  ],
  [
    'formatting the parser re-creates',
    Array.from({ length: 3000 }, (_, i) => `<p><b class=c${i}>x</p>`).join(''),
    'more than 256 levels',
  ],
])('web_fetch refuses a page with %s', async (_, html, reason) => {
  // The budget counts what the parser builds, so refusal doesn't depend on
  // how fast the machine is; bounding time is the host's isolation's job.
  const { callTool } = await setup(page(html, 'text/html'))
  const { text, isError } = await callTool('web_fetch', {
    url: 'https://cats.example/hostile',
  })
  expect(isError).toBe(true)
  expect(text).toContain('This page is too complex to read')
  expect(text).toContain(reason)
})

const windows1252 = (html: string) =>
  Uint8Array.from(html, (char) => (char === 'é' ? 0xe9 : char.charCodeAt(0)))

test('web_fetch reads the charset a page declares only in <meta>', async () => {
  for (const meta of [
    '<meta charset="windows-1252">',
    '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">',
  ]) {
    const { callTool } = await setup(
      page(
        windows1252(`${meta}<title>Café</title><p>Café au lait</p>`),
        'text/html',
      ),
    )
    const { text } = await callTool('web_fetch', {
      url: 'https://cats.example/cafe',
    })
    expect(text).toContain('Title: Café')
    expect(text).toContain('Café au lait')
  }
})

test('web_fetch prefers the header to <meta>, and a byte order mark to both', async () => {
  const html = '<meta charset="utf-8"><p>Café</p>'
  const header = await setup(
    page(windows1252(html), 'text/html; charset=windows-1252'),
  )
  expect(
    (await header.callTool('web_fetch', { url: 'https://cats.example/a' }))
      .text,
  ).toContain('Café')

  const utf8 = new TextEncoder().encode(html)
  const bom = await setup(
    page(
      new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]),
      'text/html; charset=windows-1252',
    ),
  )
  const { text } = await bom.callTool('web_fetch', {
    url: 'https://cats.example/b',
  })
  expect(text).toContain('Café')
  expect(text).not.toContain('\ufeff')
})

test("web_fetch falls back to UTF-8 for a charset it can't decode", async () => {
  const { callTool } = await setup(
    page(new TextEncoder().encode('<p>Café</p>'), 'text/html; charset=klingon'),
  )
  const { text } = await callTool('web_fetch', { url: 'https://cats.example/' })
  expect(text).toContain('Café')
})

test('web_fetch keeps only web links and images', async () => {
  const { callTool } = await setup(
    page(
      `<base href="javascript:alert(1)//">
      <p><a href="javascript:alert(1)">Run me</a>, <a href="data:text/html,hi">see data</a>,
      <a href="mailto:cat@cats.example">mail</a>, <a>anchor</a> and <a href="/next">next</a>.</p>
      <p><img src="data:image/png;base64,AAAA" alt="Inline"><img src="/cat.png" alt="Cat"></p>`,
      'text/html',
    ),
  )
  const { text } = await callTool('web_fetch', {
    url: 'https://cats.example/links',
  })
  expect(text).toContain(
    'Run me, see data, mail, anchor and [next](https://cats.example/next).',
  )
  expect(text).toContain('![Cat](https://cats.example/cat.png)')
  expect(text).not.toMatch(/javascript:|data:|mailto:|Inline/)
})

test('web_fetch resolves links against a web <base>', async () => {
  const { callTool } = await setup(
    page(
      '<base href="https://cdn.example/docs/"><p><a href="guide">Guide</a></p>',
      'text/html',
    ),
  )
  const { text } = await callTool('web_fetch', {
    url: 'https://cats.example/links',
  })
  expect(text).toContain('[Guide](https://cdn.example/docs/guide)')
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

test('the charset prescan reads tags as the HTML spec does', async () => {
  for (const [html, expected] of [
    // A `>` in a quoted value doesn't end the tag.
    ['<meta data-x=">" charset=windows-1252><p>Café</p>', 'Café'],
    // A <meta> inside another tag's attribute isn't one.
    ['<div title="<meta charset=windows-1252>"></div><p>Café</p>', 'Caf�'],
    // Nor is one in a comment.
    ['<!-- <meta charset=windows-1252> --><p>Café</p>', 'Caf�'],
    // content= counts only with http-equiv="Content-Type".
    ['<meta content="text/html; charset=windows-1252"><p>Café</p>', 'Caf�'],
    [
      "<meta content='text/html; charset=windows-1252' http-equiv=Content-Type><p>Café</p>",
      'Café',
    ],
  ]) {
    const { callTool } = await setup(page(windows1252(html), 'text/html'))
    const { text } = await callTool('web_fetch', {
      url: 'https://cats.example/cafe',
    })
    expect(text).toContain(expected)
  }
})

test('web_fetch cuts the Markdown as it converts, and says how long it was', async () => {
  // A long <base> repeats in every link: 100 KB of HTML makes 20 MB of
  // Markdown.
  const html = `<base href="https://cats.example/${'a'.repeat(100_000)}/">${Array.from(
    { length: 200 },
    (_, i) => `<a href="${i}">${i}</a>`,
  ).join(' ')}`
  const { callTool } = await setup(page(html, 'text/html'))
  const { text } = await callTool('web_fetch', {
    url: 'https://cats.example/',
    maxChars: 1_000,
  })
  expect(text).toMatch(/\n\n\[cut at 1000 of \d{8} characters\]$/)
  expect(text.length).toBeLessThan(1_200)
})

test('web_fetch cuts a long title', async () => {
  const { callTool } = await setup(
    page(`<title>${'Purr '.repeat(200_000)}</title><p>Hi</p>`, 'text/html'),
  )
  const { text } = await callTool('web_fetch', { url: 'https://cats.example/' })
  const [title] = text.split('\n')
  expect(title.length).toBeLessThanOrEqual('Title: '.length + 300)
  expect(title).toMatch(/…$/)
  expect(text.length).toBeLessThan(13_000)
})
