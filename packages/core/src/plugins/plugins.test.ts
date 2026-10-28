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
import { definePlugin, memorySecrets } from './index.ts'

const KEY = 'sk-test-0123456789'

// A plugin whose tool echoes its key, as a careless plugin might in an error.
const echo = definePlugin({
  name: 'echo',
  title: 'Echo',
  secrets: [{ name: 'key', label: 'Echo key' }],
  extension: (context) =>
    defineExtension({
      name: 'echo',
      tools: [
        defineTool({
          name: 'echo_key',
          description: 'Echoes the key.',
          parameters: Type.Object({ fail: Type.Optional(Type.Boolean()) }),
          execute: async ({ fail }) => {
            const key = await context.secret('key')
            if (fail) {
              throw new Error(`Request to https://api.test/?key=${key} failed`)
            }
            return {
              output: [{ type: 'text', text: `The key is ${key}.` }],
              details: { key },
            }
          },
        }),
      ],
    }),
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
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    plugins: [echo],
    secrets,
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
  return { faux, familiar, secrets, api, callTool }
}

const connection = { kind: 'plugin', name: 'echo' } as const

test('a tool reads its secret, and its result never shows the value', async () => {
  const { familiar, secrets, callTool } = await setup()
  await secrets.set(connection, 'key', KEY)

  const result = await callTool()
  expect(result).toContain('The key is [secret].')
  expect(result).not.toContain(KEY)

  const failed = await callTool({ fail: true })
  expect(failed).toContain('key=[secret]')
  expect(failed).not.toContain(KEY)

  // Nor does anything stored, such as the details the UI shows.
  const watch = await familiar.watch()
  await watch.stop()
  expect(JSON.stringify(watch.value)).not.toContain(KEY)
})

test('without its secret, the model is told to ask the owner', async () => {
  const { callTool } = await setup()
  expect(await callTool()).toContain(
    "Echo isn't connected. Ask the owner to add Echo key on the Connections page.",
  )
})

test('the routes set and clear a secret without ever returning it', async () => {
  const { api, callTool } = await setup()
  const list = async () => {
    const response = await api.request('/connections')
    return response.text()
  }

  expect(await list()).toContain('"set":false')

  const put = await api.request('/connections/plugin/echo/secrets/key', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: KEY }),
  })
  expect(put.status).toBe(204)
  expect(await list()).toContain('"set":true')
  expect(await list()).not.toContain(KEY)
  expect(await callTool()).toContain('The key is [secret].')

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
