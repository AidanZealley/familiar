import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ToolExecutionApi } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { memorySecrets } from '@familiar/core'
import { maskSecrets } from './index.ts'

const KEY = 'sk-test-0123456789'
const connection = { kind: 'plugin', name: 'echo' } as const

/** A tool wrapped as a plugin's would be, and the output it passes to Pi. */
async function wrapped(write: (output: (chunk: string) => void) => void) {
  const store = memorySecrets()
  await store.set(connection, 'key', KEY)
  const protectedHost = maskSecrets({
    fetch: async () => new Response(),
    secrets: store,
    credentials: [{ connection, secret: 'key' }],
  })

  const passed: string[] = []
  let passedWhileRunning = 0
  const tool = protectedHost.wrapTool(
    defineTool({
      name: 'write',
      description: 'Writes output.',
      parameters: Type.Object({}),
      execute: async (_args, api) => {
        write((chunk) => api.output(chunk))
        passedWhileRunning = passed.length
        return {}
      },
    }),
  )
  const api = {
    output: (chunk: string | Uint8Array) => passed.push(String(chunk)),
  } as unknown as ToolExecutionApi
  await tool.execute({}, api, undefined as never)
  return { text: passed.join(''), passed, passedWhileRunning }
}

test('output split across chunks is redacted as it passes to Pi', async () => {
  const { text } = await wrapped((output) => {
    output(`Calling ?key=${KEY.slice(0, 6)}`)
    output(`${KEY.slice(6)} now`)
  })
  expect(text).toBe('Calling ?key=[secret] now')
})

test('output passes to Pi as it arrives, not held until the end', async () => {
  const chunk = 'x'.repeat(10_000)
  const { text, passedWhileRunning } = await wrapped((output) => {
    for (let i = 0; i < 100; i++) {
      output(chunk)
    }
  })
  expect(text).toBe(chunk.repeat(100))
  // All but the last few bytes, held back in case a key was split.
  expect(passedWhileRunning).toBe(100)
})

test('a value learned while a tool runs is redacted from then on', async () => {
  const store = memorySecrets()
  const protectedHost = maskSecrets({
    fetch: async () => new Response(),
    secrets: store,
    credentials: [{ connection, secret: 'key' }],
  })
  const passed: string[] = []
  const tool = protectedHost.wrapTool(
    defineTool({
      name: 'write',
      description: 'Writes output.',
      parameters: Type.Object({}),
      execute: async (_args, api) => {
        api.output('before ')
        await protectedHost.secrets!.set(connection, 'key', KEY)
        api.output(`${KEY} after`)
        return {}
      },
    }),
  )
  const api = {
    output: (chunk: string | Uint8Array) => passed.push(String(chunk)),
  } as unknown as ToolExecutionApi
  await tool.execute({}, api, undefined as never)
  expect(passed.join('')).toBe('before [secret] after')
})

test('masking observes Connections writes and keeps replaced and deleted values per host', async () => {
  const credentials = [{ connection, secret: 'key' }]
  const fetch = async () => new Response('unused')
  const store = memorySecrets()
  const protectedHost = maskSecrets({ fetch, secrets: store, credentials })
  const otherHost = maskSecrets({
    fetch,
    secrets: memorySecrets(),
    credentials,
  })
  const replacement = 'sk-replacement-9876543210'
  await protectedHost.secrets!.set(connection, 'key', KEY)
  await protectedHost.secrets!.set(connection, 'key', replacement)
  await protectedHost.secrets!.delete(connection, 'key')
  expect(await store.get(connection, 'key')).toBeUndefined()

  const tool = defineTool({
    name: 'echo',
    description: 'Echo text.',
    parameters: Type.Object({}),
    execute: async () => ({
      output: [{ type: 'text', text: `${KEY} ${replacement}` }],
    }),
  })
  const api = { output: () => {} } as unknown as ToolExecutionApi
  const masked = await protectedHost
    .wrapTool(tool)
    .execute({}, api, undefined as never)
  expect(JSON.stringify(masked)).not.toContain(KEY)
  expect(JSON.stringify(masked)).not.toContain(replacement)
  const untouched = await otherHost
    .wrapTool(tool)
    .execute({}, api, undefined as never)
  expect(JSON.stringify(untouched)).toContain(KEY)
  expect(JSON.stringify(untouched)).toContain(replacement)
})

test('the fetch boundary masks a host error before it reaches plugin code', async () => {
  const secrets = memorySecrets()
  await secrets.set(connection, 'key', KEY)
  const protectedHost = maskSecrets({
    fetch: async () => {
      throw new Error(`Request failed with X-Key: ${KEY}`)
    },
    secrets,
    credentials: [{ connection, secret: 'key' }],
  })
  await expect(protectedHost.fetch('https://api.test/echo')).rejects.toThrow(
    'Request failed with X-Key: [secret]',
  )
})
