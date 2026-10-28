import { expect, test } from 'vitest'
import { TOO_COSTLY, workerConvert } from './convert.ts'

const ARTICLE = `<!doctype html><title>How cats purr</title>
<nav><a href="/">Home</a></nav>
<article><h1>How cats purr</h1><p>By twitching the <a href="/larynx">larynx</a>.</p></article>`

// parse5 checks each attribute against the tag's others, so a tag with
// 100,000 of them takes about a minute: slow for a reason no budget counts.
const slowPage = () =>
  `<p${Array.from({ length: 100_000 }, (_, i) => ` a${i}`).join('')}>x</p>`

test('a page converts in a worker', async () => {
  const page = await workerConvert()(ARTICLE, 'https://cats.example/purring')
  expect(page.title).toBe('How cats purr')
  expect(page.markdown).toContain(
    'By twitching the [larynx](https://cats.example/larynx).',
  )
  expect(page.markdown).not.toContain('Home')
})

test("the budget's error comes back as it is", async () => {
  await expect(
    workerConvert()('<p>x</p>'.repeat(60_000), 'https://cats.example/'),
  ).rejects.toThrow('This page is too complex to read')
})

test('a slow page is stopped at the time limit, and the daemon keeps running', async () => {
  // The daemon's thread stays free: a timer keeps firing while the page converts.
  let ticks = 0
  const ticker = setInterval(() => ticks++, 50)
  const started = performance.now()
  try {
    await expect(
      workerConvert({ timeoutMs: 1_000 })(slowPage(), 'https://cats.example/'),
    ).rejects.toThrow(TOO_COSTLY)
  } finally {
    clearInterval(ticker)
  }
  const elapsed = performance.now() - started
  expect(elapsed).toBeGreaterThanOrEqual(1_000)
  expect(elapsed).toBeLessThan(2_000)
  expect(ticks).toBeGreaterThanOrEqual(15)
})

test('a page past the memory limit is stopped', async () => {
  const page = `<p>${'purr '.repeat(600_000)}</p>`.repeat(4)
  await expect(
    workerConvert({ maxOldGenerationSizeMb: 16, timeoutMs: 20_000 })(
      page,
      'https://cats.example/',
    ),
  ).rejects.toThrow(TOO_COSTLY)
}, 30_000)
