import * as schema from '@earendil-works/pi-schema'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import type { Allow, Operation, Resource } from '../access.ts'
import {
  MESSAGE_LIMITS,
  type Author,
  type InRoom,
} from '../conversation/message.ts'
import { callInput, defineTool, toolAuthor } from '../tools.ts'
import {
  Familiars,
  familiarFor,
  type FamiliarId,
  type FamiliarRecord,
} from '../workspace/familiars.ts'
import {
  appendPosting,
  mentionTokens,
  REPLY_KIND,
  textMessages,
  type ReplyData,
} from './log.ts'
import { createRoom, Rooms, RoomError, updateRoom } from './rooms.ts'
import type { TurnTask } from './turn.ts'

/** The tool a Familiar ends a turn with when it has nothing to say. */
export const STAY_QUIET = 'stay_quiet'

const text = (value: string) => ({
  output: [{ type: 'text' as const, text: value }],
})

function resolveNames(
  registry: Readonly<Record<string, FamiliarRecord>>,
  names: readonly string[],
  caller: FamiliarId,
) {
  const ids = names.map((name) => {
    const key = name.trim().toLowerCase()
    const matches = Object.keys(registry).filter(
      (id) => registry[id].name.trim().toLowerCase() === key,
    )
    if (matches.length !== 1) {
      throw new RoomError(
        matches.length
          ? `More than one Familiar is named "${name}".`
          : `No Familiar is named "${name}".`,
      )
    }
    return Number(matches[0]) as FamiliarId
  })
  const others = [...new Set(ids)].filter((id) => id !== caller)
  if (!others.length) {
    throw new RoomError('Name at least one other Familiar.')
  }
  return others
}

const namesParameter = () =>
  schema.arr(schema.str({ description: 'A Familiar’s full workspace name' }))

export function roomTools(turn: TurnTask, allow?: Allow): ToolRegistration[] {
  const stayQuiet = defineTool({
    name: STAY_QUIET,
    description:
      "Say nothing this time, when you weren't addressed directly and have nothing distinct to add, or someone else is better placed to answer. Ends your turn.",
    parameters: schema.obj({
      reason: schema.opt(
        schema.str({ description: 'Why; nobody is shown it' }),
      ),
    }),
    replay: 'safe',
    // Ends the run without posting a room reply.
    execute: async () => ({
      ...text('You stayed quiet.'),
      control: { terminate: true },
    }),
  })

  if (!allow) {
    return [stayQuiet]
  }

  /** Whether the person a call acts for may name Familiars and do `operation`. */
  const mayInvite = async (
    author: Author | undefined,
    operation: Operation,
    resource?: Resource,
  ) =>
    !!author &&
    (await allow(author, 'familiars.list')) === true &&
    (await allow(author, operation, resource)) === true

  const create = defineTool({
    name: 'create_room',
    description:
      'Request approval to create a named room with other Familiars and start a discussion. You join the room automatically.',
    annotations: { destructiveHint: true },
    parameters: schema.obj({
      name: schema.str({ description: 'Name for the new room' }),
      familiars: namesParameter(),
      brief: schema.str({
        minLength: 1,
        maxLength: MESSAGE_LIMITS.text,
        description:
          'Opening message explaining what to work on and including any context the invitees need',
      }),
    }),
    execute: async ({ name, familiars, brief }, api, context) => {
      const author = await api.commit(
        (tx) => toolAuthor(tx, api.taskId),
        context,
      )
      if (!(await mayInvite(author, 'rooms.create'))) {
        throw new RoomError('The requester cannot create rooms with Familiars.')
      }
      const at = api.now()
      const room = await api.commit(async (tx) => {
        const input = await callInput(tx, api.taskId)
        const cause = (input?.data as InRoom | undefined)?.entry
        if (cause === undefined) {
          throw new RoomError('Start the discussion from a room conversation.')
        }
        const caller = await familiarFor(tx, api.conversationId)
        const registry = (await tx.doc(Familiars)).familiars
        const others = resolveNames(registry, familiars, caller)
        const id = await createRoom(tx, {
          name,
          familiars: [caller, ...others],
        })
        const data: ReplyData = {
          familiar: caller,
          name: registry[caller].name,
          cause,
          outcome: 'answered',
          depth: 0,
          at,
          messages: textMessages(brief, at),
        }
        await appendPosting(
          tx,
          turn,
          id,
          {
            requestId: `create-room:${api.taskId}`,
            entry: { kind: REPLY_KIND, data },
          },
          others.map((familiar) => ({ familiar, addressed: 'mention' })),
        )
        return id
      }, context)
      return {
        ...text(
          `Created room "${name}" (room ID ${room}) and sent the opening message.`,
        ),
        details: { room },
      }
    },
  })

  const add = defineTool({
    name: 'add_to_room',
    description:
      'Request approval to add Familiars to the named room you are replying in. After they join, mention them in your reply to ask them to contribute.',
    annotations: { destructiveHint: true },
    parameters: schema.obj({ familiars: namesParameter() }),
    execute: async ({ familiars }, api, context) => {
      const { author, room } = await api.commit(
        async (tx) => ({
          author: await toolAuthor(tx, api.taskId),
          room: ((await callInput(tx, api.taskId))?.data as InRoom | undefined)
            ?.room,
        }),
        context,
      )
      if (
        room === undefined ||
        !(await mayInvite(author, 'rooms.update', { room }))
      ) {
        throw new RoomError('The requester cannot add Familiars to this room.')
      }
      const added = await api.commit(async (tx) => {
        const record = (await tx.doc(Rooms)).rooms[room]
        const caller = await familiarFor(tx, api.conversationId)
        if (
          record?.kind !== 'room' ||
          record.archived ||
          !record.familiars.includes(caller)
        ) {
          throw new RoomError(
            'You can only add Familiars to an open named room you are in.',
          )
        }
        const registry = (await tx.doc(Familiars)).familiars
        const others = resolveNames(registry, familiars, caller)
        await updateRoom(tx, room, {
          familiars: [...new Set([...record.familiars, ...others])],
        })
        return others.map((id) => ({ id, name: registry[id].name }))
      }, context)
      const mentions = [...mentionTokens(added).keys()]
      return text(
        `In the room: ${added.map(({ name }) => name).join(', ')}.` +
          (mentions.length
            ? ` To ask for their help, use these exact mentions in your reply: ${mentions.join(', ')}.`
            : ''),
      )
    },
  })

  return [stayQuiet, create, add]
}
