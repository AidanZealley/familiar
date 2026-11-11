// Scripted model, in-memory storage and a pretend login, so nothing here
// reads the installation's config or data.
import { MemoryStorage } from '@earendil-works/pi-durable'
import { definePlugin, memorySecrets, type Notify } from '@familiar-ai/core'
import { WEB_RENDERING } from '../rendering.ts'
import { OWNER_ID } from '../serve.ts'
import { openDaemonWorkspace } from '../workspace.ts'
import { demoClock } from './clock.ts'
import { seedMemory, seedEpisodes } from './household/memory.ts'
import { scriptOf, seedHousehold, startOf } from './household/seed.ts'
import { household } from './household/story.ts'
import { workshopPlugin } from './household/workshop.ts'
import { createDemoModels, demoChatModels } from './model.ts'
import { fillContext } from './scenarios/compaction.ts'
import { checkDemoKey, demoFetch, demoSecret } from './scenarios/connections.ts'
import { demoMcpFetch, demoMcpStdio } from './scenarios/mcp.ts'
import { DEMO_TIME_ZONE } from './scenarios/scenario.ts'

const demoPlugin = definePlugin({
  name: 'demo',
  title: 'Demo',
  secrets: [demoSecret],
  tools: [fillContext, seedMemory, seedEpisodes, checkDemoKey],
})

/**
 * The demo's workspace: Rowan's household, a few days in. The clock starts
 * back when its story does, and catches up to real time as the seed plays it.
 */
export async function openDemo(notify?: Notify) {
  const story = household(Date.now())
  const clock = demoClock(startOf(story))
  const models = createDemoModels(scriptOf(story), clock)
  // Signed in already, as an owner of a real daemon would be.
  await models.login(demoChatModels[0].model.provider, 'oauth', {
    prompt: async () => '',
    notify: () => {},
  })
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: new MemoryStorage(),
      models,
      model: demoChatModels[0].model,
      chatModels: demoChatModels,
      timeZone: DEMO_TIME_ZONE,
      now: clock.now,
      hostInstructions: WEB_RENDERING,
      // The owner signs in and out from the web UI, as on a real daemon.
      account: {},
      notify,
      plugins: [demoPlugin, workshopPlugin],
      people: [{ id: OWNER_ID, name: 'demo' }],
      secrets: memorySecrets(),
      fetch: demoFetch,
      mcpFetch: demoMcpFetch,
      mcpStdio: demoMcpStdio,
    },
    story.familiars[0].name,
  )
  await seedHousehold(workspace, familiar, story, clock)
  return workspace
}
