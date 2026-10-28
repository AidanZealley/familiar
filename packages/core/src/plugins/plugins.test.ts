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

// Lets a test look at a running call, then decide how it ends.
let release = () => {}

// The plugin's context, to call authorizedFetch directly.
let context: PluginContext

// A plugin for a service that echoes its key, as some do in errors.
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
          parameters: Type.Object({ fail: Type.Optional(Type.Boolean()) }),
          execute: async ({ fail }) => {
            const body = await echoed()
            if (fail) {
              throw new Error(`The service said ${body}`)
            }
            return {
              output: [{ type: 'text', text: `The service said ${body}.` }],
              // Keyed by it too, as results indexed by URL would be.
              details: { body, [body]: 'indexed' },
            }
          },
        }),
        defineTool({
          name: 'report_key',
          description:
            'Reports what the service said while it runs, then waits.',
          parameters: Type.Object({}),
          execute: async (_args, api, toolContext) => {
            const body = await echoed()
            // Split, as streamed output may arrive.
            api.output(`Got ${body.slice(0, 6)}`)
            api.output(`${body.slice(6)} so far`)
            api.diagnostic({ severity: 'info', message: `body=${body}` })
            await api.details({ [body]: body }, toolContext)
            await new Promise<void>((resolve) => (release = resolve))
            return {}
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

  // The host's fetch: records each request and echoes the key header, in
  // its body and a header.
  const sent: { url: string; init?: RequestInit }[] = []
  const fetch: PluginFetch = async (input, init) => {
    sent.push({ url: String(input), init })
    const key = new Headers(init?.headers).get('X-Key') ?? ''
    // Everywhere a response can carry text back.
    return new Response(key, {
      statusText: key,
      headers: key ? { 'X-Echo': key, [`X-${key}`]: 'name' } : {},
    })
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
  const callTool = async (args: { fail?: boolean } = {}) => {
    let seen = ''
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('echo_key', args), {
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
  const view = async () => {
    const watch = await familiar.watch()
    await watch.stop()
    return JSON.stringify(watch.value)
  }
  return { faux, familiar, secrets, sent, api, callTool, view }
}

const connection = { kind: 'plugin', name: 'echo' } as const

test('a declared request carries the secret, and nothing reported shows it', async () => {
  const { secrets, sent, callTool, view } = await setup()
  await secrets.set(connection, 'key', KEY)

  const result = await callTool()
  expect(new Headers(sent[0].init?.headers).get('X-Key')).toBe(KEY)
  expect(sent[0].init?.redirect).toBe('manual')
  expect(result).toContain('The service said [secret].')
  expect(result).not.toContain(KEY)

  const failed = await callTool({ fail: true })
  expect(failed).toContain('The service said [secret]')
  expect(failed).not.toContain(KEY)

  // Nor does anything stored, such as the details the UI shows.
  expect(await view()).not.toContain(KEY)
})

test('a service that echoes the key gives plugin code only [secret]', async () => {
  const { secrets, sent } = await setup()
  await secrets.set(connection, 'key', KEY)

  const response = await context.authorizedFetch('key', ENDPOINT)
  expect(new Headers(sent[0].init?.headers).get('X-Key')).toBe(KEY)
  expect(response.headers.get('X-Echo')).toBe('[secret]')
  expect([...response.headers].flat().join(' ')).not.toContain(KEY)
  expect(response.statusText).not.toContain(KEY)
  expect(await response.text()).toBe('[secret]')
})

test('a key is stored as it will be sent, so a pasted space hides nothing', async () => {
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
  expect(await response.text()).toBe('[secret]')

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

test('progress never shows the secret, while running or once aborted', async () => {
  const { faux, familiar, secrets, view } = await setup()
  await secrets.set(connection, 'key', KEY)
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('report_key', {}), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('Stopped.'),
  ])

  await familiar.send({ author: 'owner', text: 'Go', requestId: 'go' })
  await expect.poll(view).toContain('body=[secret]')
  expect(await view()).not.toContain(KEY)

  const aborted = familiar.abort()
  release()
  await aborted
  await familiar.idle()
  expect(await view()).not.toContain(KEY)
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
  expect(await callTool()).toContain('The service said [secret].')

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
