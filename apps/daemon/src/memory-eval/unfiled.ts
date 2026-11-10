import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Message, TranscriptContext } from '@earendil-works/pi-ai'
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { type EntryRecord, type Storage } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import type { Author, WorkspaceOptions } from '@familiar-ai/core'
import { openDaemonWorkspace } from '../workspace.ts'
import {
  nextUpkeep,
  RECALL_HEADING,
  type FamiliarId,
  type UpkeepState,
} from '@familiar-ai/core/diagnostics'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'
import { createClock, EVAL_TIME_ZONE, noonOf } from './clock.ts'
import { isSkipped, unquoted } from './recall.ts'
import { categories, type Category, type Scenario } from './scenario.ts'
import { replyTo } from '../reply.ts'

/**
 * The unfiled test: how much of what was said, compacted out of the model's
 * view and not yet filed by upkeep, automatic recall puts in front of the
 * model. A scripted model replays the scenario with upkeep held off, so
 * everything compacted stays unfiled, then each question is sent to a fresh
 * copy and its recall note is checked for the required strings. No model or
 * network is involved, so it runs in a minute or two.
 *
 * It isolates retrieval: a year of unfiled conversation competes, where
 * normally only the hours since the last 04:00 pass would, but facts and
 * episodes are empty, so their share of the note costs nothing here.
 */

/** As the memory eval, so compaction happens as often. */
const CONTEXT_BUDGET = 4_000
const CONTEXT_WINDOW = 16_000

export type UnfiledScore = {
  category: Category
  required: number
  /** Required strings the recall note contained. */
  inNote: number
  /** Required strings still verbatim in the rest of the request. */
  inView: number
  /** Required strings the note contained and the rest of the request didn't. */
  onlyInNote: number
}

export type UnfiledResult = {
  scenario: string
  compactions: number
  skipped: { question: string; required: string }[]
  scores: UnfiledScore[]
  /** Estimated tokens of each question's recall note, 0 when there was none. */
  noteTokens: { median: number; max: number }
  questions: { id: string; note: string | null; found: string[] }[]
}

const textOf = (message: Message) =>
  typeof message.content === 'string'
    ? message.content
    : message.content
        .map((part) => ('text' in part ? String(part.text) : ''))
        .join('')

const context = BACKGROUND_CONTEXT

/**
 * Waits for upkeep to schedule its first pass for `until`, firing any
 * earlier timers on the simulated clock while Familiar starts.
 */
async function waitForUpkeep(
  storage: Storage,
  clock: ReturnType<typeof createClock>,
  until: number,
) {
  const deadline = Date.now() + 60_000
  for (;;) {
    const { items } = await storage.scanTasks(
      { kind: 'familiar.upkeep' },
      2,
      undefined,
      context,
    )
    const state = items[0]?.state
    if (state?.status === 'terminal') {
      throw new Error(`Memory upkeep ended: ${JSON.stringify(state.outcome)}`)
    }
    if (
      items.length === 1 &&
      state?.status === 'sleeping' &&
      state.until === until
    ) {
      return
    }
    if (Date.now() > deadline) {
      throw new Error('Memory upkeep never scheduled its first pass.')
    }
    await setTimeout(25)
    const due = clock.nextDue()
    if (due < until && due >= clock.now()) {
      clock.advanceTo(due)
    }
  }
}

/** How far upkeep has filed `chat`, or null if it never has. */
async function upkeepThrough(storage: Storage, chat: FamiliarId) {
  const record = await storage.findDocument(
    { kind: 'familiar.upkeep', scope: { kind: 'session' }, key: String(chat) },
    'current',
    context,
  )
  const document =
    record && (await storage.document(record.id, 'current', context))
  if (!document) {
    throw new Error('Memory upkeep document is missing.')
  }
  return (document.value as UpkeepState).through
}

/** Every entry in `chat`, oldest first. */
async function entriesIn(storage: Storage, chat: FamiliarId) {
  const entries: EntryRecord[] = []
  let cursor: Parameters<Storage['scanEntries']>[2]
  do {
    const page = await storage.scanEntries(
      { conversationId: chat, order: 'ascending' },
      200,
      cursor,
      context,
    )
    entries.push(...page.items)
    cursor = page.next
  } while (cursor)
  return entries
}

/** A scripted model that records every conversation request and replies briefly. */
function recordingModels() {
  const requests: TranscriptContext[] = []
  const models = scriptedModels(
    (request) => {
      if (request.type === 'background') {
        return fauxAssistantMessage("## Goal\nRowan's year.")
      }
      requests.push(request.context)
      return fauxAssistantMessage('Noted.')
    },
    { models: [{ id: 'faux-1', contextWindow: CONTEXT_WINDOW }] },
  )
  return { models, requests }
}

const ROWAN: Author = { id: 'Rowan', name: 'Rowan' }

/** The eval's workspace, with Rowan's DM with its Familiar to talk in. */
async function openEval(options: WorkspaceOptions) {
  const { workspace, familiar } = await openDaemonWorkspace(options, 'Familiar')
  const dm = (await workspace.rooms.get(
    await workspace.rooms.dm(familiar, ROWAN.id),
  ))!
  return {
    workspace,
    familiar,
    /** Says `text` in the DM and waits for the reply. */
    say: async (text: string, requestId: string) => {
      await replyTo(dm, await dm.post({ author: ROWAN, text, requestId }))
    },
  }
}

export async function runUnfiledEval(
  scenario: Scenario,
  directory: string,
  progress: (message: string) => void = () => {},
): Promise<UnfiledResult> {
  const sent = scenario.days.filter((day) => day.text)
  if (!sent.length) {
    throw new Error('The unfiled eval needs at least one day with text.')
  }
  const { models, requests } = recordingModels()
  const options = {
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    contextBudget: CONTEXT_BUDGET,
    timeZone: EVAL_TIME_ZONE,
  } satisfies Partial<WorkspaceOptions>
  const replayPath = join(directory, 'replay.sqlite')

  // Questions are asked the morning after the last day. Opening there first
  // schedules upkeep's first pass for the night after, past every question;
  // the replay then starts on the first day, so the pass never comes.
  const asked = noonOf(scenario.days.at(-1)!.date) + 24 * 60 * 60 * 1000
  const holding = createClock(asked)
  const held = await openNodeSqliteStorage(replayPath)
  const { workspace: holder } = await openEval({
    storage: held,
    ...options,
    now: holding.now,
    setTimer: holding.setTimer,
  })
  try {
    await waitForUpkeep(held, holding, nextUpkeep(asked, EVAL_TIME_ZONE))
  } finally {
    await holder.dismiss()
  }

  const clock = createClock(noonOf(sent[0].date!))
  const familiar = await openEval({
    storage: await openNodeSqliteStorage(replayPath),
    ...options,
    now: clock.now,
    setTimer: clock.setTimer,
  })
  const chat = familiar.familiar
  try {
    for (const [index, day] of sent.entries()) {
      clock.advanceTo(noonOf(day.date))
      await familiar.say(day.text!, `eval:day:${index}`)
      if ((index + 1) % 50 === 0) {
        progress(`Replayed ${index + 1}/${sent.length} days`)
      }
    }
  } finally {
    await familiar.workspace.dismiss()
  }

  const replay = await openNodeSqliteStorage(replayPath)
  let compactions: number
  try {
    if ((await upkeepThrough(replay, chat)) !== null) {
      throw new Error('Upkeep ran during the replay, so nothing is unfiled.')
    }
    compactions = (await entriesIn(replay, chat)).filter(
      (entry) => entry.kind === 'pi.compaction',
    ).length
  } finally {
    await replay.close(context)
  }

  const skipped = unquoted(scenario)
  const tallies = new Map<Category, UnfiledScore>(
    categories.map((category) => [
      category,
      { category, required: 0, inNote: 0, inView: 0, onlyInNote: 0 },
    ]),
  )
  const questions: UnfiledResult['questions'] = []
  const noteTokens: number[] = []
  for (const question of scenario.questions) {
    const path = join(directory, `question-${question.id}.sqlite`)
    copyFileSync(replayPath, path)
    const questionClock = createClock(asked)
    const reopened = await openEval({
      storage: await openNodeSqliteStorage(path),
      ...options,
      now: questionClock.now,
      setTimer: questionClock.setTimer,
    })
    requests.length = 0
    try {
      await reopened.say(question.text, `eval:question:${question.id}`)
    } finally {
      await reopened.workspace.dismiss()
    }

    // Recall is searched once per reply, so the first request shows it.
    const [request] = requests
    if (!request) {
      throw new Error(`No request for ${question.id}.`)
    }
    const last = request.messages.at(-1)
    const note =
      last?.role === 'user' && textOf(last).startsWith(RECALL_HEADING)
        ? textOf(last)
        : null
    const view = request.messages
      .slice(0, note === null ? undefined : -1)
      .map(textOf)
      .join('\n')
      .toLowerCase()
    noteTokens.push(note === null ? 0 : estimateTextTokens(note))

    const tally = tallies.get(question.category)!
    const found: string[] = []
    for (const required of question.required) {
      if (isSkipped(skipped, question.id, required)) {
        continue
      }
      const needle = required.toLowerCase()
      tally.required++
      const inNote = Boolean(note?.toLowerCase().includes(needle))
      const inView = view.includes(needle)
      if (inNote) {
        found.push(required)
      }
      tally.inNote += Number(inNote)
      tally.inView += Number(inView)
      tally.onlyInNote += Number(inNote && !inView)
    }
    questions.push({ id: question.id, note, found })
    progress(`${question.id}: ${found.length} found`)
  }

  const sorted = [...noteTokens].sort((a, b) => a - b)
  return {
    scenario: scenario.id,
    compactions,
    skipped,
    scores: [...tallies.values()],
    noteTokens: {
      median: sorted[Math.floor(sorted.length / 2)],
      max: sorted.at(-1)!,
    },
    questions,
  }
}
