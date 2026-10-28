import type { Page } from '@familiar/plugin-web'
import { expect, test } from 'vitest'
import {
  createConverter,
  runInWorker,
  TOO_BUSY,
  TOO_COSTLY,
  type Run,
} from './convert.ts'

const options = { maxChars: 12_000 }
const PAGE_URL = 'https://cats.example/purring'

const ARTICLE = `<!doctype html><title>How cats purr</title>
<nav><a href="/">Home</a></nav>
<article><h1>How cats purr</h1><p>By twitching the <a href="/larynx">larynx</a>.</p></article>`

// parse5 checks each attribute against the tag's others, so a tag with
// 100,000 of them takes about a minute: slow for a reason no budget counts.
const slowPage = () =>
  `<p${Array.from({ length: 100_000 }, (_, i) => ` a${i}`).join('')}>x</p>`

// The worker itself, with limits generous enough for a busy machine.

test('a page converts in a worker', async () => {
  const page = await runInWorker()(ARTICLE, PAGE_URL, options)
  expect(page.title).toBe('How cats purr')
  expect(page.markdown).toContain(
    'By twitching the [larynx](https://cats.example/larynx).',
  )
  expect(page.markdown).not.toContain('Home')
})

test("the budget's error comes back as it is", async () => {
  await expect(
    runInWorker()('<p>x</p>'.repeat(60_000), PAGE_URL, options),
  ).rejects.toThrow('This page is too complex to read')
})

test('a slow page is stopped at the time limit, and the daemon keeps running', async () => {
  // The daemon's thread stays free: a timer keeps firing while the page converts.
  let ticks = 0
  const ticker = setInterval(() => ticks++, 50)
  const started = performance.now()
  try {
    await expect(
      runInWorker({ timeoutMs: 1_000 })(slowPage(), PAGE_URL, options),
    ).rejects.toThrow(TOO_COSTLY)
  } finally {
    clearInterval(ticker)
  }
  // Well short of the minute it would take unstopped.
  expect(performance.now() - started).toBeLessThan(20_000)
  expect(ticks).toBeGreaterThanOrEqual(10)
}, 30_000)

test('a page past the memory limit is stopped', async () => {
  const page = `<p>${'purr '.repeat(600_000)}</p>`.repeat(4)
  await expect(
    runInWorker({ maxOldGenerationSizeMb: 16, timeoutMs: 20_000 })(
      page,
      PAGE_URL,
      options,
    ),
  ).rejects.toThrow(TOO_COSTLY)
}, 30_000)

test('only the Markdown asked for leaves the worker', async () => {
  // A long <base> repeats in every link: 100 KB of HTML makes 20 MB of
  // Markdown.
  const html = `<base href="https://cats.example/${'a'.repeat(100_000)}/">${Array.from(
    { length: 200 },
    (_, i) => `<a href="${i}">${i}</a>`,
  ).join(' ')}`
  const page = await runInWorker({ timeoutMs: 20_000 })(html, PAGE_URL, options)
  expect(page.markdown.length).toBe(12_000)
  expect(page.total).toBeGreaterThan(20_000_000)
}, 30_000)

// The limit on how many run, with a `run` the test finishes by hand.

function fakeRun() {
  const calls: {
    html: string
    resolve: (page: Page) => void
    reject: (error: Error) => void
  }[] = []
  const run: Run = (html) =>
    new Promise((resolve, reject) => calls.push({ html, resolve, reject }))
  const started = () => calls.map((call) => call.html)
  const call = (html: string) => calls.find((c) => c.html === html)!
  return { run, started, call }
}

const page = (markdown: string): Page => ({ markdown, total: markdown.length })

// Lets the converter's awaits run.
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('at most `concurrency` run at once, and a queued one starts when one ends', async () => {
  const { run, started, call } = fakeRun()
  const convert = createConverter({ run, concurrency: 2, queue: 8 })
  const results = ['a', 'b', 'c', 'd'].map((html) =>
    convert(html, PAGE_URL, options),
  )
  await settle()
  expect(started()).toEqual(['a', 'b'])

  call('a').resolve(page('A'))
  await expect(results[0]).resolves.toEqual(page('A'))
  await settle()
  expect(started()).toEqual(['a', 'b', 'c'])

  // A failure frees its place too.
  call('b').reject(new Error(TOO_COSTLY))
  await expect(results[1]).rejects.toThrow(TOO_COSTLY)
  await settle()
  expect(started()).toEqual(['a', 'b', 'c', 'd'])

  call('c').resolve(page('C'))
  call('d').resolve(page('D'))
  await expect(Promise.all(results.slice(2))).resolves.toEqual([
    page('C'),
    page('D'),
  ])
})

test('past the queue, a conversion is refused, and once it drains there is room again', async () => {
  const { run, started, call } = fakeRun()
  const convert = createConverter({ run, concurrency: 1, queue: 2 })
  const results = ['a', 'b', 'c'].map((html) =>
    convert(html, PAGE_URL, options),
  )
  await expect(convert('d', PAGE_URL, options)).rejects.toThrow(TOO_BUSY)
  await settle()
  expect(started()).toEqual(['a'])

  for (const html of ['a', 'b', 'c']) {
    await settle()
    call(html).resolve(page(html))
  }
  await Promise.all(results)

  // All three places free: one runs at once and two can wait.
  const again = ['e', 'f', 'g'].map((html) => convert(html, PAGE_URL, options))
  await settle()
  expect(started()).toEqual(['a', 'b', 'c', 'e'])
  for (const html of ['e', 'f', 'g']) {
    await settle()
    call(html).resolve(page(html))
  }
  await expect(Promise.all(again)).resolves.toHaveLength(3)
})
