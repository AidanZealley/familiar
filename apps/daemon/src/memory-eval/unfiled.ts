import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { Message, TranscriptContext } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai/providers/faux'
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { summonFamiliar, type FamiliarOptions } from '@familiar/core'
import { nextUpkeep } from '@familiar/core/diagnostics'
import { createClock } from './clock.ts'
import { unquoted } from './recall.ts'
import { upkeepThrough } from './replay.ts'
import { categories, type Category, type Scenario } from './scenario.ts'
import { entriesAfter } from './storage.ts'
import { waitForUpkeep } from './wait.ts'

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
const RECALL_NOTE = 'Recalled from memory'

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

const isSummaryRequest = (context: TranscriptContext) =>
  JSON.stringify(context.messages[0]).includes('context summarization')

/** Midday local time, as the memory eval sends each day. */
const noonOf = (date: string) => new Date(`${date}T12:00:00`).getTime()

/**
 * A scripted model that records every conversation request and replies
 * briefly. The provider answers from a queue, so each step queues itself
 * again and the script never runs out.
 */
function scriptedModels() {
  const faux = fauxProvider({
    models: [{ id: 'faux-1', contextWindow: CONTEXT_WINDOW }],
  })
  const requests: TranscriptContext[] = []
  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond])
    if (isSummaryRequest(context)) {
      return fauxAssistantMessage("## Goal\nRowan's year.")
    }
    requests.push(context)
    return fauxAssistantMessage('Noted.')
  }
  faux.setResponses([respond])
  const models = createModels()
  models.setProvider(faux.provider)
  return { models, requests }
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
  const { models, requests } = scriptedModels()
  const options = {
    models,
    model: { provider: 'faux', modelId: 'faux-1' },
    contextBudget: CONTEXT_BUDGET,
  } satisfies Partial<FamiliarOptions>
  const replayPath = join(directory, 'replay.sqlite')

  // Questions are asked the morning after the last day. Opening there first
  // schedules upkeep's first pass for the night after, past every question;
  // the replay then starts on the first day, so the pass never comes.
  const asked = noonOf(scenario.days.at(-1)!.date) + 24 * 60 * 60 * 1000
  const holding = createClock(asked)
  const held = await openNodeSqliteStorage(replayPath)
  const holder = await summonFamiliar({
    storage: held,
    ...options,
    now: holding.now,
    setTimer: holding.setTimer,
  })
  try {
    await waitForUpkeep(holder, held, holding, nextUpkeep(asked))
  } finally {
    await holder.dismiss()
  }

  const clock = createClock(noonOf(sent[0].date!))
  const familiar = await summonFamiliar({
    storage: await openNodeSqliteStorage(replayPath),
    ...options,
    now: clock.now,
    setTimer: clock.setTimer,
  })
  try {
    for (const [index, day] of sent.entries()) {
      clock.advanceTo(noonOf(day.date))
      await familiar.send({
        author: 'Rowan',
        text: day.text!,
        requestId: `eval:day:${index}`,
      })
      await familiar.idle()
      if ((index + 1) % 50 === 0) {
        progress(`Replayed ${index + 1}/${sent.length} days`)
      }
    }
  } finally {
    await familiar.dismiss()
  }

  const replay = await openNodeSqliteStorage(replayPath)
  let compactions: number
  try {
    if ((await upkeepThrough(replay)) !== null) {
      throw new Error('Upkeep ran during the replay, so nothing is unfiled.')
    }
    compactions = (await entriesAfter(replay)).filter(
      (entry) => entry.kind === 'pi.compaction',
    ).length
  } finally {
    await replay.close(BACKGROUND_CONTEXT)
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
    const reopened = await summonFamiliar({
      storage: await openNodeSqliteStorage(path),
      ...options,
      now: questionClock.now,
      setTimer: questionClock.setTimer,
    })
    requests.length = 0
    try {
      await reopened.send({
        author: 'Rowan',
        text: question.text,
        requestId: `eval:question:${question.id}`,
      })
      await reopened.idle()
    } finally {
      await reopened.dismiss()
    }

    // Recall is searched once per reply, so the first request shows it.
    const [request] = requests
    if (!request) {
      throw new Error(`No request for ${question.id}.`)
    }
    const last = request.messages.at(-1)
    const note =
      last?.role === 'user' && textOf(last).startsWith(RECALL_NOTE)
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
      if (
        skipped.some(
          (skip) => skip.question === question.id && skip.required === required,
        )
      ) {
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
