import type { Context } from '@earendil-works/chord'
import type { Message } from '@earendil-works/pi-ai'
import {
  defineTask,
  LiveDoc,
  type EntryId,
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
  SCHEDULED_KIND,
  type MessageData,
  type ScheduledData,
} from '../conversation/message.ts'
import { scheduledInput } from '../schedules/task.ts'
import { familiarRecord, type FamiliarId } from '../workspace/familiars.ts'
import { catchUp } from './catch-up.ts'
import {
  post,
  REPLY_KIND,
  type ReplyData,
  type RoomMessageData,
  type RoomScheduledData,
  type TurnInput,
  type TurnResult,
} from './log.ts'
import { Rooms, Turns, type Room, type RoomId } from './rooms.ts'
import { entriesOf } from '../pi/entries.ts'

/**
 * A turn: one Familiar's handling of one room entry, as a task the room
 * owns. It fixes what the Familiar is shown, delivers that to its chat as a
 * follow-up, waits for the answer and copies the run into the room as a
 * reply. Each step finds what a rerun already did by its request ID.
 */

type TurnStep =
  /** Builds the input from the room log and moves the Familiar's cursor. */
  | { phase: 'prepare' }
  /** Built in `prepare`, so a rerun after a restart delivers the same input. */
  | { phase: 'deliver'; input: string; entry: ChatInput }
  /** Waits for the chat to answer it, then copies the run into the room. */
  | { phase: 'answer'; submission: SubmissionId }

/** The chat entry a turn's input is placed as: what it says, and where from. */
type ChatInput =
  | { kind: typeof MESSAGE_KIND; data: Required<MessageData> }
  | {
      kind: typeof SCHEDULED_KIND
      data: ScheduledData & { room: RoomId; context: string }
    }

/** The entry kind of the write that lets a stopped run's queue move on. */
const WAKE_KIND = 'familiar.wake'

/** A turn's input in its Familiar's chat; the room log entry it answers is unique to it. */
const inputRequest = ({ room, cause, familiar }: TurnInput) =>
  `turn:${room}:${cause}:${familiar}`

/** Whether an entry is an input that starts a run, rather than part of one. */
const isInput = (entry: EntryRecord) =>
  !entry.head && !!entry.model?.some((message) => message.role === 'user')

/**
 * A settled input's run, as its assistant and tool-result messages: the
 * entries after its input, to its answer if it has one, else up to the next
 * input. Other kinds, such as `pi.system`, can sit among them.
 */
async function runMessages(
  tx: Tx,
  chat: FamiliarId,
  settled: SettledSubmissionRecord,
) {
  const messages: Message[] = []
  if (settled.entry === undefined) {
    return messages
  }
  for await (const entry of entriesOf(tx, {
    conversationId: chat,
    minEntryId: (settled.entry + 1) as EntryId,
    maxEntryId: settled.answer,
    order: 'ascending',
  })) {
    if (isInput(entry)) {
      break
    }
    if (entry.kind === 'pi.assistant' || entry.kind === 'pi.tool-result') {
      messages.push(...(entry.model ?? []))
    }
  }
  return messages
}

/** The room entry `cause` as its turn's input, with what it was shown first. */
function chatInput(
  cause: EntryRecord,
  room: RoomId,
  context: string,
  timeZone: string,
): { input: string; entry: ChatInput } {
  if (cause.kind === SCHEDULED_KIND) {
    const { scheduleId, prompt, due, creator } = cause.data as RoomScheduledData
    return {
      input: scheduledInput(cause.data as RoomScheduledData, timeZone),
      entry: {
        kind: SCHEDULED_KIND,
        data: {
          scheduleId,
          prompt,
          due,
          ...(creator && { creator }),
          room,
          context,
        },
      },
    }
  }
  const { author, text } = cause.data as RoomMessageData
  return {
    input: formatMessage({ author, text }),
    entry: { kind: MESSAGE_KIND, data: { author, text, room, context } },
  }
}

/** Who a DM is with, by name, if `cause` comes from them. */
function dmPerson(room: Room, cause: EntryRecord) {
  const person =
    cause.kind === MESSAGE_KIND
      ? (cause.data as RoomMessageData).author
      : (cause.data as RoomScheduledData).creator
  return room.kind === 'dm' && person?.id === room.person
    ? person.name
    : undefined
}

export function createTurnTask(harness: Harness, timeZone: string) {
  /**
   * Copies a settled input's run into the room as a reply, unless it was
   * stopped before saying anything, and ends the turn's record, in the
   * commit `tx`. Returns the reply.
   */
  async function settle(
    tx: Tx,
    taskId: number,
    { room, familiar, cause }: TurnInput,
    settled: SettledSubmissionRecord | undefined,
  ) {
    // Reads before writes: a transaction cannot read tables after writing.
    const messages = settled ? await runMessages(tx, familiar, settled) : []
    const outcome: ReplyData['outcome'] =
      settled?.status === 'done'
        ? 'answered'
        : !settled || settled.reason === 'aborted'
          ? 'stopped'
          : 'failed'
    const { name } = await familiarRecord(tx, familiar)
    let reply = null
    if (outcome !== 'stopped' || messages.length) {
      const posted = await post(
        tx,
        Turn,
        room,
        {
          kind: REPLY_KIND,
          data: { familiar, name, cause, outcome, messages },
        },
        `reply:${taskId}`,
      )
      reply = posted.entry
    }
    delete (await tx.doc(Turns, room))[taskId]
    return { reply }
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
    name: 'familiar.turn',
    version: 1,
    initial: () => ({ phase: 'prepare' }),
    phases: {
      prepare: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const { room, familiar, cause } = task.input
          const record = (await tx.doc(Rooms)).rooms[room]
          const entry = await tx.entry(cause)
          if (!record || !entry) {
            throw new Error(`No entry ${cause} in room ${room}.`)
          }
          const shown = await catchUp(
            tx,
            familiar,
            room,
            record,
            cause,
            dmPerson(record, entry),
          )
          ;(await tx.doc(Turns, room))[task.id] = { familiar, cause }
          return {
            status: 'running',
            checkpoint: {
              phase: 'deliver',
              ...chatInput(entry, room, shown, timeZone),
            },
          }
        }, context),

      deliver: async (task, runtime, context) => {
        const { room, familiar } = task.input
        const { input, entry } = task.state.checkpoint
        const chat = await runtime.conversation(familiar, context)
        if (!chat) {
          throw new Error(`No chat for Familiar ${familiar}.`)
        }
        // A follow-up, never a steer: a steered input joins the running run
        // and shares its answer, so this turn's reply couldn't be told apart
        // from another room's. What it was shown comes first, so the input
        // itself ends the message, as the model expects.
        const submission = await chat.submit(
          {
            type: 'input',
            content: [
              { type: 'text', text: entry.data.context },
              { type: 'text', text: input },
            ],
            requestId: inputRequest(task.input),
            entry: entry as InputEntry,
          },
          context,
        )
        await runtime.commit(async (tx) => {
          const turn = (await tx.doc(Turns, room))[task.id]
          if (turn) {
            turn.submission = submission.id
          }
          return {
            status: 'running',
            checkpoint: { phase: 'answer', submission: submission.id },
          }
        }, context)
      },

      answer: async (task, runtime, context) => {
        const submission = await harness.submission(
          task.state.checkpoint.submission,
          context,
        )
        const settled = await submission!.wait(context)
        await runtime.commit(
          async (tx) => ({
            status: 'terminal',
            outcome: {
              status: 'completed',
              result: await settle(tx, task.id, task.input, settled),
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
      await runtime.commit(
        async (tx) => ({
          status: 'terminal',
          outcome: {
            status: 'aborted',
            result: await settle(tx, task.id, task.input, settled),
          },
        }),
        context,
      )
    },
  })

  return Turn
}

export type TurnTask = ReturnType<typeof createTurnTask>
