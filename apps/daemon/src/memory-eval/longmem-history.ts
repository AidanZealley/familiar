import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  CompactionEntry,
  createRegistry,
  Harness,
  type EntryDraft,
  type EntryId,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import type { Author, FamiliarId } from '@familiar-ai/core'
import { formatMessage, MESSAGE_KIND } from '@familiar-ai/core/diagnostics'
import { createModels } from '@familiar-ai/core/models'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'
import { openDaemonWorkspace } from '../workspace.ts'
import { createClock, EVAL_TIME_ZONE } from './clock.ts'
import type { Question } from './longmem-data.ts'

/**
 * Writes a question's history straight into a Familiar's conversation as
 * entries carrying their original dates, instead of replaying it through a
 * live chat. Any session can be written however it starts or ends, so every
 * question can run, and it takes a second where a replay takes minutes.
 */

export const USER: Author = { id: 'user', name: 'User' }

/** Tokens each request may send once a real chat is asked the question. */
export const CONTEXT_BUDGET = 12_000

/** A user's messages in one session this far apart. */
const TURN_GAP = 60 * 1000

/**
 * Tokens of the end of the history the model still sees, as it would after
 * compaction. A third of the budget, as Pi keeps it. Without a marker the
 * first request would compact the whole haystack on the reply model.
 */
const KEEP_TOKENS = CONTEXT_BUDGET / 3

/** What compaction says: the history is in memory, not in this summary. */
const SUMMARY =
  'The conversation history before this point was compacted into the following summary:\n\n<summary>\n## Goal\nOngoing conversation with the user.\n</summary>'

/** One written entry, and where in the release it came from. */
export type Written = {
  entry: EntryId
  session: string
  /** A person's message: the entry an exchange starts at. */
  person: boolean
  hasAnswer: boolean
}

export type HistoryStore = {
  path: string
  familiar: FamiliarId
  /** Every entry written, in order. */
  written: Written[]
  /** The first entry the model's view still includes. */
  viewStart: EntryId | undefined
  /** When the history ends: memory's clock next ticks within the hour after. */
  lastAt: number
}

const evalChat = { provider: 'faux', modelId: 'eval-chat' }

/** Models that never answer, for opening a store only to write into it. */
const idleModels = () => {
  const models = scriptedModels(() => fauxAssistantMessage(''), {
    models: [{ id: evalChat.modelId, contextWindow: 200_000 }],
  })
  return models
}

const entryTokens = (draft: EntryDraft) =>
  estimateTextTokens(
    (draft.model ?? [])
      .map((message) =>
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((part) => ('text' in part ? part.text : ''))
              .join(''),
      )
      .join('\n'),
  )

/**
 * Creates the store at `path` with a Familiar, then writes `question`'s whole
 * history into its conversation and marks it compacted but for the latest
 * turns. The workspace is first opened at the history's end, so memory's
 * clock next ticks within the hour after, on the eval clock.
 */
export async function writeHistory(
  path: string,
  question: Question,
  {
    asking = false,
  }: {
    /**
     * Also writes the question as the latest message, as it is when a real
     * chat is asked it. Memory indexes an exchange only once a later message
     * exists, so without it the history's last exchange can't be searched.
     */
    asking?: boolean
  } = {},
): Promise<HistoryStore> {
  const lastAt = Math.max(
    question.asked,
    ...question.sessions.map((session) => session.at),
  )
  const clock = createClock(lastAt)
  const models = idleModels()
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: await openNodeSqliteStorage(path),
      models,
      chatModel: evalChat,
      timeZone: EVAL_TIME_ZONE,
      now: clock.now,
      setTimer: clock.setTimer,
    },
    'Familiar',
  )
  await workspace.dismiss()

  const harness = await Harness.open(
    await openNodeSqliteStorage(path),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  const written: Written[] = []
  let viewStart: EntryId | undefined
  try {
    const drafts: { draft: EntryDraft; meta: Omit<Written, 'entry'> }[] = []
    for (const session of question.sessions) {
      session.turns.forEach((turn, index) => {
        // An empty turn says nothing and can't be searched or filed.
        if (!turn.text.trim()) {
          return
        }
        const timestamp = session.at + index * TURN_GAP
        const person = turn.role === 'user'
        drafts.push({
          draft: person
            ? {
                kind: MESSAGE_KIND,
                model: [
                  {
                    role: 'user',
                    content: formatMessage({ author: USER, text: turn.text }),
                    timestamp,
                  },
                ],
                data: { author: USER, text: turn.text },
              }
            : {
                kind: 'pi.assistant',
                model: [{ ...fauxAssistantMessage(turn.text), timestamp }],
              },
          meta: { session: session.id, person, hasAnswer: turn.hasAnswer },
        })
      })
    }
    if (asking) {
      drafts.push({
        draft: {
          kind: MESSAGE_KIND,
          model: [
            {
              role: 'user',
              content: formatMessage({ author: USER, text: question.question }),
              timestamp: question.asked,
            },
          ],
          data: { author: USER, text: question.question },
        },
        meta: { session: 'question', person: true, hasAnswer: false },
      })
    }
    await harness.commit(async (tx) => {
      for (const { draft, meta } of drafts) {
        written.push({
          ...meta,
          entry: (await tx.appendEntry(familiar, draft)).id,
        })
      }
      // The latest turns stay in view, starting at a person's message.
      let tokens = 0
      let start = drafts.length
      while (start > 0 && tokens < KEEP_TOKENS) {
        start--
        tokens += entryTokens(drafts[start].draft)
      }
      while (start < drafts.length && !drafts[start].meta.person) {
        start++
      }
      viewStart = written[start]?.entry
      if (viewStart !== undefined) {
        await tx.appendEntry(familiar, {
          kind: CompactionEntry.kind,
          head: viewStart,
          model: [
            {
              role: 'user',
              content: [{ type: 'text', text: SUMMARY }],
              timestamp: lastAt,
            },
          ],
          data: { reason: 'threshold' },
        })
      }
    }, BACKGROUND_CONTEXT)
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
  return { path, familiar, written, viewStart, lastAt }
}
