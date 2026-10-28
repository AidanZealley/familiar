import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ToolExecutionApi } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { createSecrets, memorySecrets } from './secrets.ts'

const KEY = 'sk-test-0123456789'
const connection = { kind: 'plugin', name: 'echo' } as const

/** A tool wrapped as a plugin's would be, and the output it passes to Pi. */
async function wrapped(write: (output: (chunk: string) => void) => void) {
  const store = memorySecrets()
  await store.set(connection, 'key', KEY)
  const secrets = createSecrets(store, () => [{ connection, secret: 'key' }])

  const passed: string[] = []
  let passedWhileRunning = 0
  const tool = secrets.redactTool(
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
