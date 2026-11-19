import type { FamiliarSummary, TranscriptItem } from '@familiar-ai/client'

/**
 * Prototype fixtures for stage 3 of natural rooms: one scripted moment in a
 * room, replayed step by step. A person asks the room a question that
 * mentions no one, so it reaches all three Familiars at once:
 *
 * - the first replies straight away, thinking then streaming;
 * - the second is busy in another room, then picks the message up, recalls
 *   something and replies;
 * - the third thinks, then stays quiet, which posts nothing.
 */

export type Member = Pick<FamiliarSummary, 'id' | 'name' | 'avatar'>

type Reply = Extract<TranscriptItem, { type: 'reply' }>

/** One Familiar's work on the room at a step, as `RoomActivity` gives it. */
export type Turn =
  | { member: Member; status: 'running'; reply: Reply }
  | { member: Member; status: 'queued' }
  /** `room` isn't in `RoomActivity` today; see the hand-off note. */
  | { member: Member; status: 'elsewhere'; room: string }

export type Frame = {
  /** The room's log: what has landed. */
  log: TranscriptItem[]
  /** Work in progress, one per Familiar. */
  turns: Turn[]
  /** The person's message the turns are answering. */
  asked: string
}

export const STEPS = 26
const MINUTE = 60_000

const QUESTION = 'What should we plant along the north fence this spring?'
const FIRST_THINKING =
  'The north fence gets afternoon shade. Hardy, shade-tolerant climbers or a hedge would suit.'
const FIRST_ANSWER =
  'The fence is shaded after lunch, so I would skip sun lovers. **Climbing hydrangea** clings on its own and flowers in partial shade, and a row of **hellebores** at its foot gives you colour from February. If you want something to eat, **redcurrants** fruit happily against a north wall.'
const SECOND_ANSWER =
  'Adding to that: last autumn you said the soil by the fence stays wet into May. Hellebores will cope, but give the redcurrants a raised strip, or try **rhubarb**, which loves the damp.'

/** The first `share` of `text`, by words, so it streams as a model would. */
const partOf = (text: string, share: number) => {
  const words = text.split(' ')
  return words.slice(0, Math.ceil(words.length * share)).join(' ')
}

/** How far through `from`..`to` step `step` is, from 0 to 1. */
const progress = (step: number, from: number, to: number) =>
  Math.min(1, Math.max(0, (step - from + 1) / (to - from + 1)))

const reply = (member: Member, id: string, fields: Partial<Reply>): Reply => ({
  type: 'reply',
  id,
  familiar: member.id,
  name: member.name,
  text: '',
  thinking: '',
  toolCalls: [],
  streaming: true,
  stopped: false,
  ...fields,
})

/** The room at `step`, for the room's first three `members`. */
export const frameAt = (
  step: number,
  [first, second, third]: readonly Member[],
  now: number,
): Frame => {
  const asked = now - 2 * MINUTE
  const log: TranscriptItem[] = [
    {
      type: 'message',
      id: 'm0',
      author: { id: 'p', name: 'You' },
      text: 'Morning! The frost has finally lifted.',
      at: now - 40 * MINUTE,
    },
    reply(first, 'r0', {
      text: 'Good timing, the soil should be workable by the weekend.',
      streaming: false,
      at: now - 39 * MINUTE,
    }),
    {
      type: 'message',
      id: 'm1',
      author: { id: 'p', name: 'You' },
      text: QUESTION,
      at: asked,
    },
  ]
  const turns: Turn[] = []

  // The first: thinks for three steps, streams until step 13, then lands.
  if (step < 14) {
    turns.push({
      member: first,
      status: 'running',
      reply: reply(first, 'live:first', {
        thinking: partOf(FIRST_THINKING, progress(step, 1, 3)),
        text: partOf(FIRST_ANSWER, progress(step, 5, 13)),
      }),
    })
  } else {
    log.push(
      reply(first, 'r1', {
        thinking: FIRST_THINKING,
        text: FIRST_ANSWER,
        streaming: false,
        at: asked + MINUTE,
      }),
    )
  }

  // The second: busy elsewhere until step 7, then recalls and streams.
  if (step < 7) {
    turns.push({ member: second, status: 'elsewhere', room: 'Workshop' })
  } else if (step < 23) {
    const recalled = step >= 11
    turns.push({
      member: second,
      status: 'running',
      reply: reply(second, 'live:second', {
        toolCalls:
          step >= 9
            ? [
                {
                  id: 'recall',
                  name: 'recall',
                  arguments: { query: 'north fence soil' },
                  status: recalled ? 'done' : 'running',
                  output: recalled
                    ? 'Last October: "the bed by the north fence is still soggy in May".'
                    : '',
                },
              ]
            : [],
        text: partOf(SECOND_ANSWER, progress(step, 14, 22)),
      }),
    })
  } else {
    log.push(
      reply(second, 'r2', {
        toolCalls: [
          {
            id: 'recall',
            name: 'recall',
            arguments: { query: 'north fence soil' },
            status: 'done',
            output:
              'Last October: "the bed by the north fence is still soggy in May".',
          },
        ],
        text: SECOND_ANSWER,
        streaming: false,
        at: asked + 2 * MINUTE,
      }),
    )
  }

  // The third: thinks, then stays quiet, which posts nothing.
  if (third && step < 5) {
    turns.push({
      member: third,
      status: 'running',
      reply: reply(third, 'live:third', {}),
    })
  }

  return { log, turns, asked: 'm1' }
}
