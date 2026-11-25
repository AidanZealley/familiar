// Scripted model, in-memory storage and a pretend login, so nothing here
// reads the installation's config or data.
import { MemoryStorage } from '@earendil-works/pi-durable'
import {
  definePlugin,
  memorySecrets,
  type Notify,
  type FamiliarPlugin,
} from '@familiar-ai/core'
import { createNodePhotonImages } from '@familiar-ai/core/node'
import { WEB_RENDERING } from '../rendering.ts'
import { cardsPlugin } from '../cards/plugin.ts'
import { OWNER_ID } from '../serve.ts'
import { openDaemonWorkspace } from '../workspace.ts'
import { demoClock } from './clock.ts'
import { seedMemory } from './household/memory.ts'
import { scriptOf, seedHousehold, startOf } from './household/seed.ts'
import { household } from './household/story.ts'
import { workshopPlugin } from './household/workshop.ts'
import { createDemoModels, demoModelChoices } from './model.ts'
import { demoForecast } from './scenarios/chat.ts'
import { fillContext } from './scenarios/compaction.ts'
import { checkDemoKey, demoFetch, demoSecret } from './scenarios/connections.ts'
import { demoMcpFetch, demoMcpStdio } from './scenarios/mcp.ts'
import { DEMO_TIME_ZONE } from './scenarios/scenario.ts'

const demoPlugin = definePlugin({
  name: 'demo',
  title: 'Demo',
  secrets: [demoSecret],
  tools: [fillContext, seedMemory, checkDemoKey, demoForecast],
})

/**
 * The demo's workspace: Rowan's household, a few days in. The clock starts
 * back when its story does, and catches up to real time as the seed plays it.
 * `plugins` join the demo's own, such as ones that reach this machine.
 */
export async function openDemo(
  notify?: Notify,
  plugins: FamiliarPlugin[] = [],
) {
  const story = household(Date.now())
  const clock = demoClock(startOf(story))
  const models = createDemoModels(scriptOf(story), clock)
  // Signed in already, as an owner of a real daemon would be.
  await models.login(demoModelChoices[0].model.provider, 'oauth', {
    prompt: async () => '',
    notify: () => {},
  })
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: new MemoryStorage(),
      models,
      chatModel: demoModelChoices[0].model,
      modelChoices: demoModelChoices,
      timeZone: DEMO_TIME_ZONE,
      now: clock.now,
      hostInstructions: WEB_RENDERING,
      // The owner signs in and out from the web UI, as on a real daemon.
      account: {},
      notify,
      plugins: [demoPlugin, workshopPlugin, cardsPlugin, ...plugins],
      people: [{ id: OWNER_ID, name: 'demo' }],
      secrets: memorySecrets(),
      fetch: demoFetch,
      mcpFetch: demoMcpFetch,
      mcpStdio: demoMcpStdio,
      images: { processor: await createNodePhotonImages() },
    },
    story.familiars[0].name,
  )
  await seedHousehold(workspace, familiar, story, clock)
  return workspace
}
