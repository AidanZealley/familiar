import { Type, type Message } from '@earendil-works/pi-ai'
import type { ToolRegistration } from '@earendil-works/pi-durable'
import {
  HANDOFF_KIND,
  MESSAGE_LIMITS,
  type InRoom,
} from '../conversation/message.ts'
import { callInput, defineTool } from '../tools.ts'
import {
  Familiars,
  familiarFor,
  type FamiliarId,
} from '../workspace/familiars.ts'
import type { HandoffData } from './log.ts'
import { membersOf, Rooms } from './rooms.ts'

/** The tool a Familiar ends a turn with when it has nothing to say. */
export const STAY_QUIET = 'stay_quiet'

/** The tool a Familiar asks another in its room to take a turn with. */
const HAND_OFF = 'hand_off'

/** A handoff `hand_off` accepted, as its result's details: the turn posts it. */
export type HandedOff = Pick<HandoffData, 'to' | 'note' | 'hops'>

/**
 * The handoffs a run made, in order: each `hand_off` call that succeeded.
 * The turn posts them after its reply, so each follows the reply it came
 * from in the room, and the one asked is shown that reply.
 */
export const handoffsIn = (messages: readonly Message[]) =>
  messages.flatMap((message) =>
    message.role === 'toolResult' &&
    message.toolName === HAND_OFF &&
    !message.isError &&
    message.details
      ? [message.details as HandedOff]
      : [],
  )

/** How many handoffs in a row a room allows, unless the workspace says. */
export const DEFAULT_MAX_HANDOFFS = 3

/** `maxHandoffs`, defaulted, or throws if it isn't a positive whole number. */
export function checkMaxHandoffs(maxHandoffs = DEFAULT_MAX_HANDOFFS) {
  if (!Number.isSafeInteger(maxHandoffs) || maxHandoffs < 1) {
    throw new Error('maxHandoffs must be a positive whole number.')
  }
  return maxHandoffs
}

const text = (value: string) => ({
  output: [{ type: 'text' as const, text: value }],
})

/** stay_quiet and hand_off: how a Familiar takes part in a room's conversation. */
export function roomTools(maxHandoffs: number): ToolRegistration[] {
  const stayQuiet = defineTool({
    name: STAY_QUIET,
    description:
      "Say nothing this turn, when you weren't addressed directly and have nothing distinct to add. Ends your turn.",
    parameters: Type.Object({
      reason: Type.Optional(
        Type.String({ description: 'Why; nobody is shown it' }),
      ),
    }),
    replay: 'safe',
    // Ends the run, as the turn's quiet outcome records (see turn.ts).
    execute: async () => ({
      ...text('You stayed quiet.'),
      control: { terminate: true },
    }),
  })

  const handOff = defineTool({
    name: HAND_OFF,
    description:
      'Ask another assistant in this room to take a turn once you finish; they answer in the room themselves.',
    parameters: Type.Object({
      to: Type.String({ description: 'Their name' }),
      note: Type.String({ description: 'What you want from them' }),
    }),
    // Only checks the handoff: the turn posts it, from this call's result.
    replay: 'safe',
    execute: async ({ to, note }, api, context) => {
      const { name, details } = await api.commit(async (tx) => {
        const from = await familiarFor(tx, api.conversationId)
        // The room is the one this call's input came from, never the model's.
        const { room, entry } = ((await callInput(tx, api.taskId))?.data ??
          {}) as InRoom
        const record =
          room !== undefined ? (await tx.doc(Rooms)).rooms[room] : undefined
        if (room === undefined || entry === undefined || !record) {
          throw new Error('You can hand off only in a room.')
        }
        if (!note.trim() || note.length > MESSAGE_LIMITS.text) {
          throw new Error(
            `A handoff needs a note, of at most ${MESSAGE_LIMITS.text} characters.`,
          )
        }
        const { familiars } = await tx.doc(Familiars)
        const named = membersOf(record).filter(
          (id) =>
            familiars[id]?.name.trim().toLowerCase() ===
            to.trim().toLowerCase(),
        )
        if (named.length !== 1) {
          throw new Error(
            `${named.length ? 'More than one' : 'No'} assistant in this room is called ${to}.`,
          )
        }
        const [target] = named
        if (target === from) {
          throw new Error("You can't hand off to yourself.")
        }
        const cause = await tx.entry(entry)
        const hops =
          (cause?.kind === HANDOFF_KIND
            ? (cause.data as HandoffData).hops
            : 0) + 1
        if (hops > maxHandoffs) {
          throw new Error(
            `This has been handed on ${maxHandoffs} times already, the most allowed. Answer it yourself.`,
          )
        }
        const details: HandedOff = { to: target as FamiliarId, note, hops }
        return { name: familiars[target].name, details }
      }, context)
      return {
        ...text(
          `${name} will take a turn once you finish, and answer in the room.`,
        ),
        details,
      }
    },
  })

  return [stayQuiet, handOff]
}
