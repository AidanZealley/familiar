import { Type } from '@earendil-works/pi-ai'
import { defineTool, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { markRecalled, MemoryUsage, Facts } from './facts.ts'
import { Episodes } from './episodes.ts'
import { searchMemory } from './recall.ts'

const recall = defineTool({
  name: 'recall',
  description:
    "Search everything you remember beyond what you always see: facts, including ones no longer current, each with when it was true, and episodes, summaries of what happened each day, week and month. Use it when you need something you don't see, such as an earlier address, a detail of an old project or what was going on at a time.",
  parameters: Type.Object({ query: Type.String() }),
  execute: (args, api, context) =>
    api
      .commit(async (tx) => {
        const facts = await tx.doc(Facts)
        const usage = await tx.doc(MemoryUsage)
        const episodes = await tx.doc(Episodes)
        const { found, used } = searchMemory(
          facts,
          episodes,
          args.query,
          api.now(),
          {
            limit: 12,
            tokens: 3_000,
          },
        )
        // Only conversation counts as use; upkeep's searches are housekeeping.
        if (api.conversationId === ROOT_CONVERSATION_ID) {
          markRecalled(usage, used, api.now())
        }
        return found.length
          ? found.map(({ line }) => line).join('\n')
          : 'Nothing found.'
      }, context)
      .then((text) => ({ output: [{ type: 'text' as const, text }] })),
})

/** The conversation's memory tools: it reads memory; nightly upkeep writes it. */
export const memoryTools = [recall]
