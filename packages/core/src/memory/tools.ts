import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import type { ExchangesOf } from './exchanges.ts'
import { Episodes } from './episodes.ts'
import { Facts, markRecalled, MemoryUsage } from './facts.ts'
import { readMemory } from './read.ts'
import { recallAll } from './recall.ts'
import { familiarDoc, familiarFor } from '../workspace/familiars.ts'

const text = (text: string) => ({
  output: [{ type: 'text' as const, text }],
})

/**
 * The tools that read memory, for the chat and for upkeep. Both search the
 * exchanges too, so each catches the index up with the transcript first.
 * Reads come before the one write, since a transaction can't read after
 * writing.
 */
export function createMemoryTools(exchangesOf: ExchangesOf, timeZone: string) {
  const recall = defineTool({
    name: 'recall',
    description:
      "Search everything you remember beyond what you always see: facts, including ones no longer true, each with when it was true; episodes, summaries of each day, week and month; and exchanges, the original messages with their replies. Use it when you need something you don't see, such as an earlier address, a detail of an old project or what was going on at a time. Results are grouped by kind; read_memory opens any of them.",
    parameters: Type.Object({ query: Type.String() }),
    execute: (args, api, context) =>
      api
        .commit(async (tx) => {
          const familiar = await familiarFor(tx, api.conversationId)
          const index = await exchangesOf(familiar).catchUp(tx)
          const facts = await familiarDoc(tx, Facts, familiar)
          const usage = await familiarDoc(tx, MemoryUsage, familiar)
          const episodes = await familiarDoc(tx, Episodes, familiar)
          const found = recallAll(
            facts,
            episodes,
            index,
            args.query,
            api.now(),
            timeZone,
          )
          // Only the chat counts as use; upkeep's searches are housekeeping.
          if (api.conversationId === familiar) {
            markRecalled(usage, found.used, api.now())
          }
          return found.text
        }, context)
        .then(text),
  })

  const read = defineTool({
    name: 'read_memory',
    description:
      'Open what lies behind an ID from recall: for an exchange (x…), it and the messages either side; for a fact (f…), how it changed and the messages it came from; for a day episode (e…), its exchanges; for a week or month, the episodes it was rolled up from.',
    parameters: Type.Object({ id: Type.String() }),
    execute: (args, api, context) =>
      api
        .commit(async (tx) => {
          const familiar = await familiarFor(tx, api.conversationId)
          const index = await exchangesOf(familiar).catchUp(tx)
          return readMemory(
            args.id.trim(),
            await familiarDoc(tx, Facts, familiar),
            await familiarDoc(tx, Episodes, familiar),
            index,
            timeZone,
          )
        }, context)
        .then(text),
  })

  return [recall, read]
}
