import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createRegistry, Harness } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import {
  datesIn,
  Episodes,
  Facts,
  familiarDoc,
  formatMessage,
  localDay,
  MESSAGE_KIND,
  recallNote,
  renderMemorySection,
  transcriptExchanges,
  type Fact,
} from '@familiar-ai/core/diagnostics'
import { createModels } from '@familiar-ai/core/models'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { EVAL_TIME_ZONE } from './clock.ts'
import { USER } from './longmem-history.ts'
import { fillerExchanges } from './recall.ts'
import type { FamiliarId } from '@familiar-ai/core'
import { createClock } from './clock.ts'
import { openDaemonWorkspace } from '../workspace.ts'
import { scriptedModels } from '@familiar-ai/core/models/scripted'

/**
 * The speed check: a generated store of years of ordinary conversation, with
 * the facts and day, week and month episodes upkeep would have written, and
 * the time memory takes to search it. No model is involved. It measures what
 * grows with the years: the first search after a restart, which rebuilds the
 * exchange index from the whole transcript, a search once warm, and the
 * memory section the model is shown on every request.
 */

const DAY = 24 * 60 * 60 * 1000

export type SpeedOptions = {
  years: number
  exchangesPerDay: number
  /** Facts upkeep would have filed, across the years. */
  facts: number
}

/** A ten-year store of about 100,000 exchanges. */
export const TEN_YEARS: SpeedOptions = {
  years: 10,
  exchangesPerDay: 27,
  facts: 2000,
}

const subjects = [
  'Saffron',
  'Ellis',
  'June',
  'Noor',
  'Mae',
  'Petra',
  'Pip',
  'Tilda',
  'Wren',
]
const statements = [
  (s: string, n: number) => `${s} prefers tea number ${n} in the afternoon`,
  (s: string, n: number) =>
    `${s} is working through book ${n} on the reading list`,
  (s: string, n: number) => `${s} has a standing appointment on day ${n % 28}`,
  (s: string, n: number) => `${s}'s project ${n} is waiting on a delivery`,
  (s: string, n: number) => `${s} lives near stop ${n} on the river path`,
]

const dayOf = (at: number) => localDay(at, EVAL_TIME_ZONE)

function syntheticFacts(count: number, start: number, years: number) {
  const facts: Fact[] = []
  let coreChars = 0
  for (let index = 0; index < count; index++) {
    const text = statements[index % statements.length](
      subjects[index % subjects.length],
      index,
    )
    const at = start + Math.floor((index / count) * years * 365) * DAY
    // Core as upkeep keeps it: the important ones, to the budget.
    const importance = 1 + (index % 5)
    const core = importance >= 4 && coreChars + text.length < 6_000
    if (core) {
      coreChars += text.length
    }
    facts.push({
      id: `f${index + 1}`,
      text,
      importance,
      since: dayOf(at),
      sources: [],
      saved: at,
      core,
    })
  }
  return facts
}

/** Writes the store at `path` and returns the Familiar and when it ends. */
export async function generateStore(path: string, options: SpeedOptions) {
  const days = options.years * 365
  const end = new Date(2026, 10, 13, 12).getTime()
  const start = end - days * DAY
  const clock = createClock(end)
  const { workspace, familiar } = await openDaemonWorkspace(
    {
      storage: await openNodeSqliteStorage(path),
      models: scriptedModels(() => fauxAssistantMessage(''), {
        models: [{ id: 'eval-chat', contextWindow: 200_000 }],
      }),
      chatModel: { provider: 'faux', modelId: 'eval-chat' },
      timeZone: EVAL_TIME_ZONE,
      now: clock.now,
      setTimer: clock.setTimer,
    },
    'Familiar',
  )
  await workspace.dismiss()

  const exchanges = fillerExchanges(start, days, 1, options.exchangesPerDay)
  const harness = await Harness.open(
    await openNodeSqliteStorage(path),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  )
  try {
    const chunk = 2_000
    for (let from = 0; from < exchanges.length; from += chunk) {
      await harness.commit(async (tx) => {
        for (const { at, text } of exchanges.slice(from, from + chunk)) {
          await tx.appendEntry(familiar, {
            kind: MESSAGE_KIND,
            model: [
              {
                role: 'user',
                content: formatMessage({ author: USER, text }),
                timestamp: at,
              },
            ],
            data: { author: USER, text },
          })
          await tx.appendEntry(familiar, {
            kind: 'pi.assistant',
            model: [{ ...fauxAssistantMessage('Noted.'), timestamp: at + 1 }],
          })
        }
      }, BACKGROUND_CONTEXT)
    }
    await harness.commit(async (tx) => {
      const memory = await familiarDoc(tx, Facts, familiar)
      memory.facts = syntheticFacts(options.facts, start, options.years)
      memory.next = memory.facts.length + 1
      const state = await familiarDoc(tx, Episodes, familiar)
      const episode = (
        span: 'day' | 'week' | 'month',
        first: number,
        last: number,
      ) => {
        state.episodes.push({
          id: `e${state.next++}`,
          span,
          start: dayOf(start + first * DAY),
          end: dayOf(start + last * DAY),
          text: `The ${span} of ${first}: ${exchanges[first % exchanges.length].text}`,
          at: start + last * DAY,
        })
      }
      for (let day = 0; day < days; day++) {
        episode('day', day, day)
        if (day % 7 === 6) {
          episode('week', day - 6, day)
        }
        if (day % 30 === 29) {
          episode('month', day - 29, day)
        }
      }
    }, BACKGROUND_CONTEXT)
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
  return { familiar, end, exchanges: exchanges.length }
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

const timed = async <T>(work: () => Promise<T>) => {
  const started = performance.now()
  const result = await work()
  return { ms: performance.now() - started, result }
}

/** Queries of ordinary kinds, some that name a date. */
const QUERIES = [
  'what did Saffron say about the allotment',
  'when is the appointment with Noor',
  'what was going on in March',
  'is there anything new on Tidal Rooms',
  'what did I cook last week',
]

export type SpeedResult = {
  exchanges: number
  facts: number
  episodes: number
  /** Opening the store afresh, as after a restart. */
  openMs: number
  /** The first message after a restart: the index rebuilt from the whole transcript, then searched. */
  firstSearchMs: number
  /** The first automatic recall, which also searches facts and episodes. */
  firstRecallMs: number
  warmSearch: { medianMs: number; maxMs: number }
  warmRecall: { medianMs: number; maxMs: number }
  /**
   * Of a warm recall, the median spent reading the documents, the median
   * spent searching them as the documents are, and the median of the same
   * search over plain copies.
   */
  warmRecallSplit: { readMs: number; searchMs: number; plainSearchMs: number }
  /** Reading the facts and rendering the memory section, as every request does. */
  sectionMs: { medianMs: number; maxMs: number }
  sectionChars: number
}

/** Opens the store afresh and times what a restart and the next messages cost. */
export async function measureSpeed(
  path: string,
  familiar: FamiliarId,
  now: number,
): Promise<SpeedResult> {
  const opened = await timed(async () =>
    Harness.open(
      await openNodeSqliteStorage(path),
      { models: createModels(), registry: createRegistry() },
      BACKGROUND_CONTEXT,
    ),
  )
  const harness = opened.result
  try {
    const exchanges = transcriptExchanges(familiar, EVAL_TIME_ZONE)
    const search = (query: string) =>
      harness.commit(async (tx) => {
        const index = await exchanges.catchUp(tx)
        return index.search(query, now, {
          limit: 10,
          ranges: datesIn(query, localDay(now, EVAL_TIME_ZONE)),
        })
      }, BACKGROUND_CONTEXT)
    // Reading the facts and episodes documents, apart from searching them.
    const split = {
      reads: [] as number[],
      searches: [] as number[],
      plain: [] as number[],
    }
    const recallWith = (rebuilt: typeof exchanges) => (query: string) =>
      harness.commit(async (tx) => {
        const reading = performance.now()
        const facts = await familiarDoc(tx, Facts, familiar)
        const episodes = await familiarDoc(tx, Episodes, familiar)
        await rebuilt.catchUp(tx)
        const searching = performance.now()
        const note = recallNote(facts, episodes, [], query, now, EVAL_TIME_ZONE)
        split.reads.push(searching - reading)
        split.searches.push(performance.now() - searching)
        // The same search over plain copies, to tell the search from reading through the document.
        const copies = JSON.parse(JSON.stringify([facts, episodes]))
        const plain = performance.now()
        recallNote(copies[0], copies[1], [], query, now, EVAL_TIME_ZONE)
        split.plain.push(performance.now() - plain)
        return note
      }, BACKGROUND_CONTEXT)
    const recall = recallWith(exchanges)

    const first = await timed(() => search(QUERIES[0]))
    // A second restart: the first message's whole recall, index rebuilt included.
    const firstRecall = await timed(() =>
      recallWith(transcriptExchanges(familiar, EVAL_TIME_ZONE))(QUERIES[0]),
    )
    const spread = async (work: (query: string) => Promise<unknown>) => {
      const times: number[] = []
      for (const query of QUERIES) {
        times.push((await timed(() => work(query))).ms)
      }
      return { medianMs: median(times), maxMs: Math.max(...times) }
    }
    const warmSearch = await spread(search)
    split.reads.length = split.searches.length = split.plain.length = 0
    const warmRecall = await spread(recall)

    let sectionChars = 0
    const sections: number[] = []
    for (let run = 0; run < 5; run++) {
      sections.push(
        (
          await timed(() =>
            harness.commit(async (tx) => {
              const text = renderMemorySection(
                await familiarDoc(tx, Facts, familiar),
              )
              sectionChars = text.length
            }, BACKGROUND_CONTEXT),
          )
        ).ms,
      )
    }
    const [facts, episodes] = await harness.commit(
      async (tx) =>
        [
          (await familiarDoc(tx, Facts, familiar)).facts.length,
          (await familiarDoc(tx, Episodes, familiar)).episodes.length,
        ] as const,
      BACKGROUND_CONTEXT,
    )
    return {
      exchanges: (
        await harness.commit((tx) => exchanges.catchUp(tx), BACKGROUND_CONTEXT)
      ).size,
      facts,
      episodes,
      openMs: opened.ms,
      firstSearchMs: first.ms,
      firstRecallMs: firstRecall.ms,
      warmSearch,
      warmRecall,
      warmRecallSplit: {
        readMs: median(split.reads),
        searchMs: median(split.searches),
        plainSearchMs: median(split.plain),
      },
      sectionMs: { medianMs: median(sections), maxMs: Math.max(...sections) },
      sectionChars,
    }
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
}
