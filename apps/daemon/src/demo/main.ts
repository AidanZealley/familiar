// Scripted model, in-memory storage and no login. Never import config.ts:
// importing it creates the real data directory.
import { MemoryStorage } from '@earendil-works/pi-durable'
import { definePlugin, memorySecrets, summonFamiliar } from '@familiar/core'
import { openPush } from '../push.ts'
import { serveFamiliar } from '../serve.ts'
import { createDemoModels, demoChatModels } from './model.ts'
import { seedMemory, seedEpisodes } from './seed.ts'
import { fillContext } from './scenarios/compaction.ts'
import { checkDemoKey, demoFetch, demoSecret } from './scenarios/connections.ts'
import { demoMcpFetch, demoMcpStdio, seedMcp } from './scenarios/mcp.ts'
import { seedDemo } from './scenarios/memory.ts'

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
const familiar = await summonFamiliar({
  storage: new MemoryStorage(),
  models: createDemoModels(),
  model: demoChatModels[0].model,
  chatModels: demoChatModels,
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
