import type { Message } from '@earendil-works/pi-ai'
import {
  defineTask,
  GenerationTask,
  hook,
  runEndTask,
  type EntryId,
  type EntryRecord,
} from '@earendil-works/pi-durable'
import {
  MCP_COMPLETION_KIND,
  type InRoom,
  type McpCompletionData,
} from '../conversation/message.ts'
import { entriesOf } from '../pi/entries.ts'
import { Familiars, familiarIn } from '../workspace/familiars.ts'
import {
  mentionsIn,
  postAll,
  REPLY_KIND,
  replyText,
  type ReplyData,
} from './log.ts'
import { membersOf, Rooms, seenBy } from './rooms.ts'
import type { TurnTask } from './turn.ts'

/**
 * A run's answer, posted to the room its input came from when the run ends.
 * Pi asks the `afterRun` hook after a final answer, and keeps the chat busy
 * until the task it returns ends, so the next input waits for the reply.
 * The hook only asks for the task, as Pi may ask it again; the task posts
 * the reply keyed by the answer, with the deliveries it causes, in one
 * commit, so a rerun posts nothing twice. A run that stayed quiet ends with
 * `terminate` and posts nothing.
 */

/** A run's range in its chat, as `afterRun` gave it. */
type AnswerInput = { first: number; answer: number; last: number }

export const ANSWER_TASK = 'familiar.answer'

/** Whether an entry is an input that starts a run, rather than part of one. */
const isInput = (entry: EntryRecord) =>
  !entry.head && !!entry.model?.some((message) => message.role === 'user')

export function createAnswer(turn: TurnTask) {
  const Answer = defineTask<AnswerInput, { phase: 'post' }, null>({
    name: ANSWER_TASK,
    version: 1,
    initial: () => ({ phase: 'post' }),
    phases: {
      post: (task, runtime, context) =>
        runtime.commit(async (tx) => {
          const done = {
            status: 'terminal',
            outcome: { status: 'completed', result: null },
          } as const
          const { first, answer, last } = task.input
          const chat = runtime.conversationId
          const { familiars } = await tx.doc(Familiars)
          const familiar = familiarIn({ familiars }, chat)
          // The run's one input, and what it said and did. A boundary can
          // place writes before the input.
          let input: InRoom | undefined
          let completion: McpCompletionData | undefined
          const messages: Message[] = []
          for await (const entry of entriesOf(tx, {
            conversationId: chat,
            minEntryId: first as EntryId,
            maxEntryId: last as EntryId,
            order: 'ascending',
          })) {
            if (!input && isInput(entry)) {
              input = (entry.data ?? {}) as InRoom
              if (entry.kind === MCP_COMPLETION_KIND) {
                completion = input as McpCompletionData
              }
            } else if (
              entry.kind === 'pi.assistant' ||
              entry.kind === 'pi.tool-result'
            ) {
              messages.push(...(entry.model ?? []))
            }
          }
          const { room, entry: cause } = input ?? {}
          const record =
            room === undefined ? undefined : (await tx.doc(Rooms)).rooms[room]
          if (
            familiar === undefined ||
            familiar !== chat ||
            !record ||
            cause === undefined ||
            (completion &&
              ((record.kind === 'room' && record.archived) ||
                !membersOf(record).includes(familiar) ||
                !seenBy(record, completion.author?.id)))
          ) {
            return done
          }
          const caused = await tx.entry(cause)
          const depth =
            (caused?.kind === REPLY_KIND
              ? ((caused.data as unknown as ReplyData).depth ?? 0)
              : 0) + 1
          const data: ReplyData = {
            familiar,
            name: familiars[familiar].name,
            cause,
            outcome: 'answered',
            depth,
            messages,
            at: runtime.now(),
          }
          const others = membersOf(record)
            .filter((other) => other !== familiar && familiars[other])
            .map((id) => ({ id, name: familiars[id].name }))
          const mentions = mentionsIn(replyText(data), others)
          await postAll(tx, turn, room!, [
            {
              entry: {
                kind: REPLY_KIND,
                data: { ...data, ...(mentions.length && { mentions }) },
              },
              requestId: `reply:${answer}`,
            },
          ])
          return done
        }, context),
    },
    abort: (_task, runtime, context) =>
      runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
        context,
      ),
  })

  return {
    task: Answer,
    hook: hook(GenerationTask, {
      afterRun: ({ reason, first, answer, last }) =>
        reason === 'answer'
          ? { tasks: [runEndTask(Answer, { first, answer, last })] }
          : undefined,
    }),
  }
}
