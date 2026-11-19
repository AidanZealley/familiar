import type { Context } from '@earendil-works/chord/context'
import {
  defineTask,
  LiveDoc,
  type EntryRecord,
  type Harness,
  type InputEntry,
  type SettledSubmissionRecord,
  type SubmissionId,
  type Tx,
} from '@earendil-works/pi-durable'
import {
  formatMessage,
  MESSAGE_KIND,
  RELAY_KIND,
  SCHEDULED_KIND,
  type InRoom,
  type MessageData,
  type RelayData,
  type ScheduledData,
} from '../conversation/message.ts'
import { scheduledInput } from '../schedules/task.ts'
import { Familiars, type FamiliarId } from '../workspace/familiars.ts'
import { catchUp } from './catch-up.ts'
import {
  formatRelay,
  mentionTokens,
  post,
  REPLY_KIND,
  replyText,
  type ReplyData,
  type RoomMessageData,
  type RoomScheduledData,
  type TurnInput,
  type TurnResult,
} from './log.ts'
import { membersOf, RoomError, Rooms, type Room } from './rooms.ts'
import { replyingIn } from './status.ts'

/**
 * A turn: delivering one room entry to one Familiar, as a task the room
 * owns. It fixes what the Familiar is shown, submits that to its chat as a
 * follow-up and waits for it to settle. Pi takes one follow-up per run, so
 * each run answers one room entry, and the run's answer is posted to the
 * room when the run ends (see answer.ts). A turn posts only a note that its
 * input was stopped or failed. Each step finds what a rerun already did by
 * its request ID.
 */

type TurnStep =
  /** Builds the input from the room log and moves the Familiar's cursor. */
  | { phase: 'prepare' }
  /** Built in `prepare`, so a rerun after a restart delivers the same input. */
  | {
      phase: 'deliver'
      name: string
      input: string
      entry: ChatInput
      mentionHint?: string
    }
  /** Waits for the chat to settle it, then notes it if it went unanswered. */
  | { phase: 'answer'; name: string; submission: SubmissionId }

/** The chat entry a turn's input is placed as: what it says, and where from. */
type ChatInput =
  | { kind: typeof MESSAGE_KIND; data: Required<MessageData> }
  | { kind: typeof SCHEDULED_KIND; data: ScheduledData & Required<InRoom> }
  | { kind: typeof RELAY_KIND; data: RelayData & Required<InRoom> }

/** The turn task's name, by which removing a Familiar finds its turns. */
export const TURN_TASK = 'familiar.turn'

/** How a turn ends whose Familiar was removed after it was posted. */
const removed = {
  status: 'terminal',
  outcome: { status: 'completed', result: { answer: null } },
} as const

/** The entry kind of the write that lets a stopped run's queue move on. */
const WAKE_KIND = 'familiar.wake'

/**
 * A turn's input in its Familiar's chat; the room log entry it answers is
 * unique to it, and a retry's failed reply to each retry.
 */
const inputRequest = ({ room, cause, familiar, retries }: TurnInput) =>
  `turn:${room}:${cause}:${familiar}${retries === undefined ? '' : `:retry:${retries}`}`

/**
 * The room entry `cause` as its turn's input, with `where` it came from and
 * what it was shown first. `names` gives Familiars' names now.
 */
type PrepareInput = (
  cause: EntryRecord,
  where: Required<InRoom>,
  names: (familiar: FamiliarId) => string,
  timeZone: string,
) => { input: string; entry: ChatInput }

const deliveryHandlers = new Map<string, PrepareInput>([
  [
    SCHEDULED_KIND,
    (cause, where, _names, timeZone) => {
      const { scheduleId, prompt, due, creator } =
        cause.data as RoomScheduledData
      return {
        input: scheduledInput(cause.data as RoomScheduledData, timeZone),
        entry: {
          kind: SCHEDULED_KIND,
          data: {
            scheduleId,
            prompt,
            due,
            ...(creator && { creator }),
            ...where,
          },
        },
      }
    },
  ],
  [
    REPLY_KIND,
    (cause, where, names) => {
      const reply = cause.data as unknown as ReplyData
      const name = names(reply.familiar)
      const text = replyText(reply)
      return {
        input: formatRelay(name, text),
        entry: {
          kind: RELAY_KIND,
          data: { familiar: reply.familiar, name, text, ...where },
        },
      }
    },
  ],
  [
    MESSAGE_KIND,
    (cause, where) => {
      const { author, text } = cause.data as RoomMessageData
      return {
        input: formatMessage({ author, text }),
        entry: { kind: MESSAGE_KIND, data: { author, text, ...where } },
      }
    },
  ],
])

export const canDeliver = (kind: string) => deliveryHandlers.has(kind)

const chatInput: PrepareInput = (cause, where, names, timeZone) => {
  const prepare = deliveryHandlers.get(cause.kind)
  if (!prepare) {
    throw new RoomError(`A turn can't deliver a ${cause.kind} entry.`)
  }
  return prepare(cause, where, names, timeZone)
}

/** Who a DM is with, by name, if `cause` comes from them. */
function dmPerson(room: Room, cause: EntryRecord) {
  const person =
    cause.kind === MESSAGE_KIND
      ? (cause.data as RoomMessageData).author
      : cause.kind === SCHEDULED_KIND
        ? (cause.data as RoomScheduledData).creator
        : undefined
  return room.kind === 'dm' && person?.id === room.person
    ? person.name
    : undefined
}

export function createTurnTask(harness: Harness, timeZone: string) {
  /**
   * Ends a turn whose input `settled`, in the commit `tx`: an answered one
   * with its answer, as the run's end posts its reply; one that went
   * unanswered with a note in the room that it was stopped or failed. An
   * input withdrawn before it ran, or never delivered, notes nothing.
   */
  async function settle(
    tx: Tx,
    input: TurnInput,
    name: string | undefined,
    settled: SettledSubmissionRecord | undefined,
    at: number,
  ): Promise<TurnResult> {
    if (settled?.status === 'done') {
      return {
        answer: settled.answer ?? null,
        ...(settled.entry !== undefined && { input: settled.entry }),
      }
    }
    const stopped = !settled || settled.reason === 'aborted'
    if (
      name === undefined ||
      !settled ||
      (stopped && settled.entry === undefined)
    ) {
      return { answer: null }
    }
    const { room, familiar, cause } = input
    const data: ReplyData = {
      familiar,
      name,
      cause,
      outcome: stopped ? 'stopped' : 'failed',
      ...(!stopped && {
        failure: {
          reason: settled.reason,
          ...(typeof settled.detail === 'string' && { detail: settled.detail }),
        },
      }),
      messages: [],
      at,
    }
    await post(
      tx,
      Turn,
      room,
      { kind: REPLY_KIND, data },
      `note:${inputRequest(input)}`,
    )
    return { answer: null }
  }

  /**
   * Withdraws a turn's input if it's still queued, or stops the run that's
   * answering it, and returns it settled; undefined if it was never
   * delivered. Only this input: never the chat's `abort()`, which would
   * withdraw every room's queued inputs.
   */
  async function stop(taskId: number, turn: TurnInput, context: Context) {
    const { familiar } = turn
    const found = await harness.commit(
      (tx) => tx.submissionByRequest(familiar, inputRequest(turn)),
      context,
    )
    const submission = found && (await harness.submission(found.id, context))
    if (!found || !submission) {
      return undefined
    }
    const withdrawn =
      found.status === 'queued' ? await submission.abort(context) : undefined
    if (found.status === 'placed' || withdrawn === 'already_placed') {
      const { run } = (await harness.snapshot(LiveDoc, familiar, context)) ?? {}
      if (run?.inputs.includes(found.id)) {
        await harness.abortTask(run.taskId, context)
      }
    }
    const settled = await submission.wait(context)

    // A stopped run, unlike a failed one, leaves the inputs queued behind it
    // waiting for something to pass the inbox through a boundary. A write
    // that changes the model's context does, even an empty one. Decided from
    // the settled input, so a rerun after a crash still sends it, once.
    if (settled.status === 'unanswered' && settled.entry !== undefined) {
      const chat = await harness.conversation(familiar, context)
      await chat?.submit(
        {
          type: 'write',
          requestId: `wake:${taskId}`,
          entry: { kind: WAKE_KIND, model: [] },
        },
        context,
      )
    }
    return settled
  }

  const Turn = defineTask<TurnInput, TurnStep, TurnResult>({
    name: TURN_TASK,
    // 2: no `wait` phase, and a turn no longer posts its answer.
    version: 2,
    initial: () => ({ phase: 'prepare' }),
    phases: {
      prepare: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { room, familiar, cause, addressed } = task.input
          const record = (await tx.doc(Rooms)).rooms[room]
          const entry = await tx.entry(cause)
          if (!record || !entry) {
            throw new Error(`No entry ${cause} in room ${room}.`)
          }
          const { familiars } = await tx.doc(Familiars)
          if (!familiars[familiar]) {
            return removed
          }
          // Reads before writes: a transaction cannot read tables after writing.
          const others = membersOf(record)
            .filter((id) => id !== familiar && familiars[id])
            .map((id) => ({ id, name: familiars[id].name }))
          const replying = await replyingIn(
            tx,
            room,
            others.map(({ id }) => id),
          )
          const tokens = [...mentionTokens(others)]
            .filter(([, id]) => id !== null)
            .map(([token]) => token)
          const shown = await catchUp(
            tx,
            familiar,
            room,
            record,
            cause,
            dmPerson(record, entry),
            addressed,
            replying.map((other) => familiars[other].name),
          )
          const name = familiars[familiar].name
          return {
            status: 'running',
            checkpoint: {
              phase: 'deliver',
              name,
              ...(tokens.length && {
                mentionHint: `To address another Familiar in your reply, use its exact mention: ${tokens.join(', ')}.`,
              }),
              ...chatInput(
                entry,
                { room, entry: cause, context: shown, addressed },
                (id) => familiars[id]?.name ?? 'another assistant',
                timeZone,
              ),
            },
          }
        }, context),

      deliver: async (task, runtime, context) => {
        const { familiar } = task.input
        const { name, input, entry, mentionHint } = task.state.checkpoint
        const chat = await runtime.conversation(familiar, context)
        if (!chat) {
          throw new Error(`No chat for Familiar ${familiar}.`)
        }
        // A follow-up, never a steer: Pi places one follow-up per run, so
        // each run answers one room entry and its reply has one room. What
        // it was shown comes first, so the input itself ends the message,
        // as the model expects.
        const submission = await chat.submit(
          {
            type: 'input',
            content: [
              {
                type: 'text',
                text: mentionHint
                  ? `${entry.data.context}\n${mentionHint}`
                  : entry.data.context,
              },
              { type: 'text', text: input },
            ],
            requestId: inputRequest(task.input),
            entry: entry as InputEntry,
          },
          context,
        )
        await runtime.commit(
          async () => ({
            status: 'running',
            checkpoint: { phase: 'answer', name, submission: submission.id },
          }),
          context,
        )
      },

      answer: async (task, runtime, context) => {
        const { name, submission: id } = task.state.checkpoint
        const submission = await harness.submission(id, context)
        const settled = await submission!.wait(context)
        await runtime.commit(
          async (tx) => ({
            status: 'terminal',
            outcome: {
              status: 'completed',
              result: await settle(
                tx,
                task.input,
                name,
                settled,
                runtime.now(),
              ),
            },
          }),
          context,
        )
      },
    },
    // A room's Stop. Whatever phase it stopped in, its input is found by
    // request ID, as a crash can leave it delivered but unrecorded.
    abort: async (task, runtime, context) => {
      const settled = await stop(task.id, task.input, context)
      const { checkpoint } = task.state
      await runtime.commit(
        async (tx) => ({
          status: 'terminal',
          outcome: {
            status: 'aborted',
            result: await settle(
              tx,
              task.input,
              'name' in checkpoint
                ? checkpoint.name
                : (await tx.doc(Familiars)).familiars[task.input.familiar]
                    ?.name,
              settled,
              runtime.now(),
            ),
          },
        }),
        context,
      )
    },
  })

  return Turn
}

export type TurnTask = ReturnType<typeof createTurnTask>
