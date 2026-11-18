import { setTimeout as wait } from 'node:timers/promises'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, test } from 'vitest'
import { ASLEEP, INFO_TOOL } from '../tools.ts'
import { activity } from './activity.ts'
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
