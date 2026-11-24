import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, test } from 'vitest'
import { ASLEEP, CONTROL_TOOL, INFO_TOOL, PERSON_USED } from '../tools.ts'
import { activity } from './activity.ts'
import { computerControl } from './control.ts'
import type { Browser } from './browser.ts'
import { computerServer } from './server.ts'

test('the agent sleeps once idle, never during a call or for a look, then runs nothing', async () => {
  let slept = false
  const browser = { tabs: async () => [] } as unknown as Browser
  const [agentSide, hostSide] = InMemoryTransport.createLinkedPair()
  await computerServer(
    browser,
    '/',
    activity(200, () => (slept = true)),
    computerControl(),
    { done: Promise.resolve(), takeNote: () => undefined },
  ).connect(agentSide)
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(hostSide)
  const look = () => client.callTool({ name: INFO_TOOL, arguments: {} })

  // A call longer than the idle time keeps it awake.
  const command = { command: 'sleep 0.4' }
  const running = client.callTool({ name: 'run_command', arguments: command })
  await wait(300)
  expect(slept).toBe(false)
  await running

  // Looks don't keep it awake.
  for (let i = 0; i < 5; i++) {
    await look()
    await wait(60)
  }
  expect(slept).toBe(true)

  // Asleep, it runs nothing, and says so.
  const late = await client.callTool({
    name: 'run_command',
    arguments: command,
  })
  expect(late._meta?.[ASLEEP]).toBe(true)
})

test('a person holds control as long as their call: actions wait and never run, and the Familiar is told', async () => {
  let slept = false
  const home = mkdtempSync(join(tmpdir(), 'familiar-control-'))
  const browser = { tabs: async () => [] } as unknown as Browser
  const [agentSide, hostSide] = InMemoryTransport.createLinkedPair()
  await computerServer(
    browser,
    home,
    activity(200, () => (slept = true)),
    computerControl(),
    { done: Promise.resolve(), takeNote: () => undefined },
  ).connect(agentSide)
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(hostSide)
  const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
    (result.content as { text: string }[]).map((block) => block.text).join()
  const takeOver = () => {
    const person = new AbortController()
    let held!: () => void
    const holding = new Promise<void>((resolve) => (held = resolve))
    const call = client.callTool(
      { name: CONTROL_TOOL, arguments: {} },
      { signal: person.signal, onprogress: () => held() },
    )
    call.catch(() => {})
    return { person, holding, call }
  }
  const write = (path: string) =>
    client.callTool(
      { name: 'write_file', arguments: { path, content: 'x' } },
      { onprogress: () => (waited = true) },
    )
  let waited = false

  const first = takeOver()
  await first.holding
  expect(
    JSON.parse(text(await client.callTool({ name: INFO_TOOL, arguments: {} }))),
  ).toMatchObject({ control: 'person' })
  // A second take-over is refused.
  expect(text(await takeOver().call)).toMatch(/someone else/i)
  // A read runs, with a note; an action waits.
  expect(
    text(
      await client.callTool({ name: 'read_file', arguments: { path: '.' } }),
    ),
  ).toMatch(/taken over/)
  const action = write('during')
  await wait(300)
  expect(waited).toBe(true)
  // Held control keeps the computer awake.
  expect(slept).toBe(false)
  first.person.abort()
  const result = await action
  expect(result.isError).toBe(true)
  expect(result._meta?.[PERSON_USED]).toBe(true)
  expect(text(result)).toMatch(/didn't run/)
  expect(existsSync(join(home, 'during'))).toBe(false)

  // A take-over between calls: the next action doesn't run, and says why;
  // the one after runs.
  const second = takeOver()
  await second.holding
  second.person.abort()
  await wait(10)
  expect(
    JSON.parse(text(await client.callTool({ name: INFO_TOOL, arguments: {} }))),
  ).toMatchObject({ control: 'returned' })
  const after = await write('after')
  expect(text(after)).toMatch(/used your computer/)
  expect(after._meta?.[PERSON_USED]).toBe(true)
  expect(
    JSON.parse(text(await client.callTool({ name: INFO_TOOL, arguments: {} }))),
  ).toMatchObject({ control: 'familiar' })
  expect(existsSync(join(home, 'after'))).toBe(false)
  await write('after')
  expect(existsSync(join(home, 'after'))).toBe(true)
})

test('a take-over waits for calls on the display already running, and no action starts meanwhile', async () => {
  const control = computerControl()
  const never = new AbortController().signal
  let finish!: (value: string) => void
  // A look counts too: a browser read may be starting the browser.
  const looking = control.run(
    { tool: 'browser_snapshot' },
    { reads: true, display: true },
    never,
    () => {},
    () => new Promise<string>((resolve) => (finish = resolve)),
  )
  const person = new AbortController()
  let held = false
  void control.hold(person.signal, () => (held = true))
  await wait(10)
  expect(held).toBe(false)
  // Asked for, so a new action waits rather than running.
  let waiting = false
  const typing = control.run(
    { tool: 'screen_type' },
    { reads: false, display: true },
    never,
    () => (waiting = true),
    async () => 'typed',
  )
  expect(waiting).toBe(true)
  finish('page')
  expect(await looking).toEqual({ ran: true, value: 'page' })
  await wait(0)
  expect(held).toBe(true)
  person.abort()
  expect((await typing).ran).toBe(false)
})
