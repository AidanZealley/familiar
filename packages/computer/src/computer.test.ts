import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@familiar-ai/core/models'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { chromium } from 'playwright'
import { expect, onTestFinished, test, vi } from 'vitest'
import { startAgent } from './agent/index.ts'
import { openComputers } from './index.ts'
import {
  call,
  greet,
  GREETER,
  lastResult,
  ReopenableStorage,
  serveHost,
  testModel,
} from './testing.ts'

// A paired computer end to end: the host, and the agent dialling in.

async function setup() {
  const dir = await mkdtemp(resolve(tmpdir(), 'familiar-computer-'))
  const { faux, models } = testModel()
  const storage = new ReopenableStorage()
  let port = 0

  /** The host, as the daemon is between restarts. */
  const open = async (waitMs?: number) => {
    const host = await serveHost({
      computers: openComputers({
        path: resolve(dir, 'computers.json'),
        keyPath: resolve(dir, 'vault.key'),
        waitMs,
      }),
      models,
      storage,
      port,
    })
    port = host.port
    return host
  }

  let current = await open(300)
  const agents: ReturnType<typeof startAgent>[] = []
  onTestFinished(async () => {
    await Promise.all(agents.map((agent) => agent.stop()))
    await current.close()
    await rm(dir, { recursive: true, force: true })
  })

  return {
    faux,
    dir,
    /** Stops the host as a restart would, mid-call, and opens it again. */
    restart: async () => {
      await current.close()
      current = await open()
    },
    /** Gives the Familiar a computer: its pairing link. */
    pair: async () =>
      (
        (await (await current.api('', { method: 'POST' })).json()) as {
          link: string
        }
      ).link,
    /** Runs the computer's agent, with `dir` as its home, until it's online. */
    run: async (link: string) => {
      agents.push(
        startAgent({ link, dataDir: resolve(dir, 'agent'), home: dir }),
      )
      await vi.waitFor(
        async () => expect(await current.status()).toBe('online'),
        10_000,
      )
    },
    /** Posts `text`; `reply` waits for the answer, across restarts. */
    ask: async (text: string) => {
      const entry = await current.ask(text)
      return { reply: () => current.reply(entry) }
    },
  }
}

test('an action cut off by a host restart is reported, not run again, and the computer reconnects', async () => {
  const { faux, dir, ask, pair, run, restart } = await setup()
  const results: string[] = []
  const note = (next: ReturnType<typeof call>) => (context: Context) => {
    results.push(lastResult(context))
    return next
  }

  // Paired, but the machine isn't running the agent yet.
  const link = await pair()
  faux.setResponses([
    call('read_file', { path: 'notes.txt' }),
    note(fauxAssistantMessage('Offline.')),
  ])
  await (await ask('Before running')).reply()
  expect(results.splice(0)).toEqual([expect.stringMatching(/offline/)])
  await run(link)

  // An action is under way on the computer when the host stops.
  faux.setResponses([
    call('run_command', { command: 'echo ran >> runs.txt; sleep 60' }),
  ])
  const task = await ask('Run it')
  const runs = resolve(dir, 'runs.txt')
  await vi.waitFor(() => expect(existsSync(runs)).toBe(true), {
    timeout: 10_000,
  })
  faux.setResponses([
    note(call('read_file', { path: 'runs.txt' })),
    note(fauxAssistantMessage('Done.')),
  ])
  await restart()
  await task.reply()

  expect(results[0]).toMatch(/interrupted/)
  // Read through the agent once it reconnected: the action ran once.
  expect(results[1]).toBe('ran\n')
  expect(readFileSync(runs, 'utf8')).toBe('ran\n')
}, 30_000)

test.skipIf(!existsSync(chromium.executablePath()))(
  'a Familiar uses a web page on its computer',
  async () => {
    const page = createServer((_request, response) =>
      response.end(GREETER),
    ).listen(0, '127.0.0.1')
    await once(page, 'listening')
    onTestFinished(() => void page.close())
    const url = `http://127.0.0.1:${(page.address() as AddressInfo).port}/`

    const { faux, ask, pair, run } = await setup()
    await run(await pair())
    let final = ''
    faux.setResponses([
      ...greet(url),
      (context) => {
        final = lastResult(context)
        return fauxAssistantMessage('It says hello.')
      },
    ])
    await (await ask('Greet Ada')).reply()
    expect(final).toContain('Hello, Ada')
  },
  60_000,
)
