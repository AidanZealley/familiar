import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from '@earendil-works/chord/context'
import type { ToolExecutionApi } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { loadPlugins } from './plugins.ts'

const tool = async (html: string) => {
  const [web] = await loadPlugins('')
  return web
    .extension({
      now: Date.now,
      notify: async () => {},
      fetch: async () =>
        new Response(html, { headers: { 'content-type': 'text/html' } }),
      authorizedFetch: async () => {
        throw new Error('No credentials in this test.')
      },
    })
    .tools!.find((tool) => tool.name === 'web_fetch')!
}
const api = { now: Date.now } as ToolExecutionApi

test('the daemon converts pages in its configured worker pool', async () => {
  const fetch = await tool(
    '<main><h1>Hello</h1><p>See <a href="/more">more</a>.</p></main>',
  )
  const result = await fetch.execute(
    { url: 'https://example.com/' },
    api,
    BACKGROUND_CONTEXT,
  )
  expect(JSON.stringify(result.output)).toContain(
    '[more](https://example.com/more)',
  )
})

test('cancellation interrupts a conversion and a later page can still be read', async () => {
  const fetch = await tool('<p>words</p>'.repeat(200_000))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10)
  try {
    await expect(
      fetch.execute(
        { url: 'https://example.com/' },
        api,
        withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
      ),
    ).rejects.toThrow(/abort/i)
  } finally {
    clearTimeout(timer)
  }
  const next = await tool('<p>Still working</p>')
  expect(
    JSON.stringify(
      (
        await next.execute(
          { url: 'https://example.com/' },
          api,
          BACKGROUND_CONTEXT,
        )
      ).output,
    ),
  ).toContain('Still working')
})
