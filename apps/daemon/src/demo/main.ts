// Scripted model, in-memory storage and no login. Never import config.ts:
// importing it creates the real data directory.
import { MemoryStorage } from '@earendil-works/pi-durable'
import { definePlugin, memorySecrets, summonFamiliar } from '@familiar-ai/core'
import { webPersona } from '../persona.ts'
import { openPush } from '../push.ts'
import { serveFamiliar } from '../serve.ts'
import { createDemoModels, demoChatModels } from './model.ts'
import { seedMemory, seedEpisodes, prepareDemoMemory } from './seed.ts'
import { fillContext } from './scenarios/compaction.ts'
import { checkDemoKey, demoFetch, demoSecret } from './scenarios/connections.ts'
import { demoMcpFetch, demoMcpStdio, seedMcp } from './scenarios/mcp.ts'
import { seedDemo } from './scenarios/memory.ts'
import { DEMO_TIME_ZONE } from './zone.ts'

const demoPlugin = definePlugin({
  name: 'demo',
  title: 'Demo',
  secrets: [demoSecret],
  extension: (context) => ({
    tools: [fillContext, seedMemory, seedEpisodes, checkDemoKey(context)],
  }),
})

// Keys and subscriptions last only until the demo restarts.
const push = openPush({ contact: 'mailto:familiar@example.com' })
const name = 'Familiar'
// Seeding and the demo reopen the same in-memory state.
class DemoStorage extends MemoryStorage {
  override async close() {}
}
const storage = new DemoStorage()
await prepareDemoMemory(storage)
const familiar = await summonFamiliar({
  storage,
  models: createDemoModels(),
  model: demoChatModels[0].model,
  chatModels: demoChatModels,
  timeZone: DEMO_TIME_ZONE,
  name,
  persona: webPersona(name),
  notify: async (notification) => {
    console.log('Notification:', JSON.stringify(notification))
    await push.notify(notification)
  },
  plugins: [demoPlugin],
  secrets: memorySecrets(),
  fetch: demoFetch,
  mcpFetch: demoMcpFetch,
  mcpStdio: demoMcpStdio,
})
await seedDemo(familiar)
await seedMcp(familiar)
serveFamiliar(familiar, {
  host: '127.0.0.1',
  port: Number(process.env.FAMILIAR_DEMO_PORT ?? 4318),
  owner: 'demo',
  label: 'Familiar demo',
  push: push.host,
})
