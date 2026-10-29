import { Type } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { defineTool, MemoryStorage } from '@earendil-works/pi-durable'
import { afterEach, expect, test } from 'vitest'
import { summonFamiliar, type Familiar } from '../familiar.ts'
import { createHttpApi } from '../http.ts'
import { authorizedFetch, checkDeclaration } from './authorized-fetch.ts'
import { definePlugin, memorySecrets, type PluginFetch } from './index.ts'

const KEY = 'sk-test-0123456789'
const ENDPOINT = 'https://api.test/echo'

// A plugin that makes an authenticated request.
const echo = definePlugin({
  name: 'echo',
  title: 'Echo',
  secrets: [
    {
      name: 'key',
      label: 'Echo key',
      sendAs: {
        header: 'X-Key',
        origin: 'https://api.test',
        requests: [{ method: 'GET', path: '/echo' }],
      },
    },
  ],
  extension: (pluginContext) => {
    const echoed = async () =>
      (await pluginContext.authorizedFetch('key', ENDPOINT)).text()
    return {
      tools: [
        defineTool({
          name: 'echo_key',
          description: 'Calls the echo service.',
          parameters: Type.Object({}),
          execute: async () => {
            const body = await echoed()
            return {
              output: [{ type: 'text', text: `The service said ${body}.` }],
            }
          },
        }),
      ],
    }
  },
})

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

async function setup() {
  const faux = fauxProvider({ models: [{ id: 'faux-1' }] })
  const models = createModels()
  models.setProvider(faux.provider)
  const secrets = memorySecrets()

  // Records requests without using the network.
  const sent: { url: string; init?: RequestInit }[] = []
  const fetch: PluginFetch = async (input, init) => {
    sent.push({ url: String(input), init })
    return new Response('Connected.')
  }

  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    plugins: [echo],
    secrets,
    fetch,
  })
  opened.push(familiar)
  const api = createHttpApi(familiar, { authenticate: () => 'owner' })

  /** Asks the model to call echo_key, and returns the result it then sees. */
  let calls = 0
  const callTool = async () => {
    let seen = ''
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('echo_key', {}), {
        stopReason: 'toolUse',
      }),
      (context) => {
        seen = JSON.stringify(context.messages.at(-1))
        return fauxAssistantMessage('Done.')
      },
    ])
    const requestId = `go-${++calls}`
    await familiar.send({ author: 'owner', text: 'Go', requestId })
    await familiar.idle()
    return seen
  }
  return { sent, api, callTool }
}

test('authorizedFetch refuses any other request without sending it', async () => {
  const sent: RequestInit[] = []
  const fetch: PluginFetch = async (_input, init) => {
    sent.push(init!)
    return new Response('Connected.')
  }
  const request = (url: string, init?: RequestInit) =>
    authorizedFetch(fetch, echo.secrets![0], async () => KEY, url, init)

  const refused: [string, RequestInit?][] = [
    ['https://evil.test/echo'],
    ['https://sub.api.test/echo'],
    ['http://api.test/echo'],
    ['https://api.test:8443/echo'],
    ['https://user:pass@api.test/echo'],
    ['https://api.test/other'],
    [ENDPOINT, { method: 'POST' }],
    [ENDPOINT, { headers: { 'x-key': 'mine' } }],
    [ENDPOINT, { headers: { host: 'evil.test' } }],
  ]
  for (const [url, init] of refused) {
    await expect(request(url, init)).rejects.toThrow()
  }
  expect(sent).toEqual([])

  // Query strings don't change the path, so they're allowed.
  await request(`${ENDPOINT}?q=cats`)
  expect(sent).toHaveLength(1)
  expect(new Headers(sent[0].headers).get('X-Key')).toBe(KEY)
  expect(sent[0].redirect).toBe('manual')
})

test('the routes set and clear a secret without ever returning it', async () => {
  const { api, sent, callTool } = await setup()
  const list = async () => {
    const response = await api.request('/connections')
    return response.text()
  }

  expect(await list()).toContain('"set":false')
  expect(await list()).toContain('"origin":"https://api.test"')

  const put = await api.request('/connections/plugin/echo/secrets/key', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: `  ${KEY}\n` }),
  })
  expect(put.status).toBe(204)
  expect(await list()).toContain('"set":true')
  expect(await list()).not.toContain(KEY)
  expect(await callTool()).toContain('The service said Connected.')
  expect(new Headers(sent[0].init?.headers).get('X-Key')).toBe(KEY)
  for (const value of ['two\nlines', '   ']) {
    const response = await api.request('/connections/plugin/echo/secrets/key', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    expect(response.status).toBe(400)
  }

  const removed = await api.request('/connections/plugin/echo/secrets/key', {
    method: 'DELETE',
  })
  expect(removed.status).toBe(204)
  expect(await list()).toContain('"set":false')
  sent.length = 0
  expect(await callTool()).toContain(
    "Echo isn't connected. Ask the owner to add Echo key on the Connections page.",
  )
  expect(sent).toEqual([])

  const unknown = await api.request('/connections/plugin/echo/secrets/other', {
    method: 'DELETE',
  })
  expect(unknown.status).toBe(404)
})

test('a secret must declare an exact HTTPS origin', () => {
  const secret = echo.secrets![0]
  for (const origin of ['http://api.test', 'https://api.test/v1']) {
    expect(() =>
      checkDeclaration('echo', {
        ...secret,
        sendAs: { ...secret.sendAs, origin },
      }),
    ).toThrow(/https|exact origin/)
  }
})
