import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'
import { MESSAGE_KIND } from '../conversation/message.ts'
import { Rooms } from '../rooms/rooms.ts'
import { callInput } from '../tools.ts'
import { familiarDoc, familiarFor } from '../workspace/familiars.ts'
import type { FilingApi } from './filing/task.ts'
import { Filing } from './filing/task.ts'
import { readMemory } from './read.ts'
import { recallAll } from './recall.ts'
import type { ViewOf } from './view.ts'

const text = (text: string) => ({
  output: [{ type: 'text' as const, text }],
})

/**
 * The chat's memory tools. The two that read catch the view up with the
 * transcript first; `remember` takes no content, only marks the message
 * it answers as asked-for and has it filed now.
 */
export function createMemoryTools(
  viewOf: ViewOf,
  filing: Pick<FilingApi, 'startPass'>,
  timeZone: string,
) {
  const recall = defineTool({
    name: 'recall',
    description:
      "Search everything you've been told beyond what you always see: notes about people and things, including ones no longer true, and the conversations themselves, with the dated journal lines that make them findable. Use it when you need something you don't see. from and to keep only what happened on those days; about keeps only what concerns one person or thing. It says how many match and whether you've seen them all; read_memory opens any result.",
    parameters: Type.Object({
      query: Type.String({
        description:
          'Words to search for; empty to list everything in from–to or about.',
      }),
      from: Type.Optional(
        Type.String({ description: 'First day, YYYY-MM-DD.' }),
      ),
      to: Type.Optional(Type.String({ description: 'Last day, YYYY-MM-DD.' })),
      about: Type.Optional(
        Type.String({ description: 'A subject: its ID (s…) or name.' }),
      ),
      offset: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: 'Matches to skip, for the next page.',
        }),
      ),
    }),
    execute: async (args, api, context) => {
      const familiar = await api.commit(
        (tx) => familiarFor(tx, api.conversationId),
        context,
      )
      const view = viewOf(familiar)
      await view.ready()
      return api
        .commit(async (tx) => {
          await view.catchUp(tx)
          return recallAll(view, args, api.now(), await tx.doc(Rooms), timeZone)
        }, context)
        .then(text)
    },
  })

  const read = defineTool({
    name: 'read_memory',
    description:
      'Open what lies behind an ID: a person or thing (s…), with its profile and notes; a note (n…), with the messages it rests on; or a conversation (x…), with the exchanges either side.',
    parameters: Type.Object({ id: Type.String() }),
    execute: async (args, api, context) => {
      const familiar = await api.commit(
        (tx) => familiarFor(tx, api.conversationId),
        context,
      )
      const view = viewOf(familiar)
      await view.ready()
      return api
        .commit(async (tx) => {
          await view.catchUp(tx)
          return readMemory(view, args.id.trim(), await tx.doc(Rooms), timeZone)
        }, context)
        .then(text)
    },
  })

  const remember = defineTool({
    name: 'remember',
    description:
      "Call this when someone asks you to remember what they've just said. It takes nothing: their message is kept in memory as asked for, from now on.",
    parameters: Type.Object({}),
    // Marking twice changes nothing.
    replay: 'safe',
    execute: (_args, api, context) =>
      api
        .commit(async (tx) => {
          const familiar = await familiarFor(tx, api.conversationId)
          const input = await callInput(tx, api.taskId)
          if (
            input?.kind !== MESSAGE_KIND ||
            input.conversationId !== familiar
          ) {
            return "Only a person's own message can be remembered, and this isn't one."
          }
          await filing.startPass(tx, familiar)
          const progress = await familiarDoc(tx, Filing, familiar)
          if (progress.through !== null && input.id <= progress.through) {
            return 'That message is already in memory.'
          }
          if (!progress.asked.includes(input.id)) {
            progress.asked.push(input.id)
          }
          return 'Kept: it is being filed now.'
        }, context)
        .then(text),
  })

  return [recall, read, remember]
}
