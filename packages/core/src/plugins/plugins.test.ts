import { Type, type TranscriptContext } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import {
  defineExtension,
  defineTool,
  MemoryStorage,
} from '@earendil-works/pi-durable'
import { afterEach, expect, test } from 'vitest'
import { summonFamiliar, type Familiar } from '../familiar.ts'
import { createHttpApi } from '../http.ts'
import {
  definePlugin,
  memorySecrets,
  type FamiliarPlugin,
  type PluginContext,
  type PluginFetch,
} from './index.ts'

const KEY = 'sk-test-0123456789'
const ENDPOINT = 'https://api.test/echo'

// The plugin's context, to call authorizedFetch directly.
let context: PluginContext

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
    context = pluginContext
    const echoed = async () =>
      (await context.authorizedFetch('key', ENDPOINT)).text()
    return defineExtension({
      name: 'echo',
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
    })
  },
})

const opened: Familiar[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((familiar) => familiar.dismiss()))
})

async function setup(plugins: FamiliarPlugin[] = [echo]) {
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
    plugins,
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
  return { faux, familiar, secrets, sent, api, callTool }
}

const connection = { kind: 'plugin', name: 'echo' } as const

test('Connections normalizes pasted keys and rejects invalid header values', async () => {
  const { api, sent } = await setup()
  const put = (value: string) =>
    api.request('/connections/plugin/echo/secrets/key', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    })

  expect((await put(`  ${KEY}\n`)).status).toBe(204)
  const response = await context.authorizedFetch('key', ENDPOINT)
  expect(new Headers(sent[0].init?.headers).get('X-Key')).toBe(KEY)
  expect(await response.text()).toBe('Connected.')

  expect((await put('two\nlines')).status).toBe(400)
  expect((await put('   ')).status).toBe(400)
})

test('authorizedFetch refuses any other request without sending it', async () => {
  const { secrets, sent } = await setup()
  await secrets.set(connection, 'key', KEY)

  const refused: [string, string, RequestInit?][] = [
    ['key', 'https://evil.test/echo'],
    ['key', 'https://sub.api.test/echo'],
    ['key', 'http://api.test/echo'],
    ['key', 'https://api.test:8443/echo'],
    ['key', 'https://user:pass@api.test/echo'],
    ['key', 'https://api.test/other'],
    ['key', ENDPOINT, { method: 'POST' }],
    ['key', ENDPOINT, { headers: { 'x-key': 'mine' } }],
    ['key', ENDPOINT, { headers: { host: 'evil.test' } }],
    ['other', ENDPOINT],
  ]
  for (const [secret, url, init] of refused) {
    await expect(context.authorizedFetch(secret, url, init)).rejects.toThrow()
  }
  expect(sent).toEqual([])

  // Query strings don't change the path, so they're allowed.
  await context.authorizedFetch('key', `${ENDPOINT}?q=cats`)
  expect(sent).toHaveLength(1)
})

test('without its secret, the model is told to ask the owner', async () => {
  const { sent, callTool } = await setup()
  expect(await callTool()).toContain(
    "Echo isn't connected. Ask the owner to add Echo key on the Connections page.",
  )
  expect(sent).toEqual([])
})

test('the routes set and clear a secret without ever returning it', async () => {
  const { api, callTool } = await setup()
  const list = async () => {
    const response = await api.request('/connections')
    return response.text()
  }

  expect(await list()).toContain('"set":false')
  expect(await list()).toContain('"origin":"https://api.test"')

  const put = await api.request('/connections/plugin/echo/secrets/key', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: KEY }),
  })
  expect(put.status).toBe(204)
  expect(await list()).toContain('"set":true')
  expect(await list()).not.toContain(KEY)
  expect(await callTool()).toContain('The service said')

  const removed = await api.request('/connections/plugin/echo/secrets/key', {
    method: 'DELETE',
  })
  expect(removed.status).toBe(204)
  expect(await list()).toContain('"set":false')
  expect(await callTool()).toContain("Echo isn't connected.")

  const unknown = await api.request('/connections/plugin/echo/secrets/other', {
    method: 'DELETE',
  })
  expect(unknown.status).toBe(404)
})

test('a secret must be sent to an exact https origin', async () => {
  const [declared] = echo.secrets!
  const sendTo = (origin: string) =>
    setup([
      {
        ...echo,
        secrets: [{ ...declared, sendAs: { ...declared.sendAs, origin } }],
      },
    ])
  await expect(sendTo('http://api.test')).rejects.toThrow(/https/)
  await expect(sendTo('https://api.test/v1')).rejects.toThrow(/exact origin/)
})

test("a plugin's tools follow core's on the first request", async () => {
  const { faux, familiar } = await setup()
  let request = ''
  faux.setResponses([
    (context: TranscriptContext) => {
      request = JSON.stringify(context.messages)
      return fauxAssistantMessage('Hi.')
    },
  ])
  await familiar.send({ author: 'owner', text: 'Hi', requestId: 'hi' })
  await familiar.idle()

  expect(request).toContain('echo_key')
  expect(request.indexOf('current_time')).toBeLessThan(
    request.indexOf('echo_key'),
  )
})
