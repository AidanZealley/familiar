import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  CompactionEntry,
  createRegistry,
  Harness,
  type EntryId,
} from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import {
  datesIn,
  formatMessage,
  Journal,
  keyOf,
  localDay,
  MESSAGE_KIND,
  Memory,
  memoryViews,
  Pages,
  recallNote,
  renderSection,
  type JournalLine,
  type Note,
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
 * the pages and journal lines filing would have written, and the time memory
 * takes to search it. No model is involved. It measures what grows with the
 * years: the first search after a restart, which loads every page and month
 * and reads the whole transcript into the index, a search once warm, and the
 * memory section the model is shown on every request.
 */

const DAY = 24 * 60 * 60 * 1000

export type SpeedOptions = {
  years: number
  exchangesPerDay: number
  /** Subjects with pages, across the years. */
  subjects: number
  /** Notes on each subject's page. */
  notesPerSubject: number
  /** Journal lines filing would have written a day. */
  linesPerDay: number
}

/** A ten-year store of about 100,000 exchanges, 2,000 notes and 11,000 journal lines. */
export const TEN_YEARS: SpeedOptions = {
  years: 10,
  exchangesPerDay: 27,
  subjects: 200,
  notesPerSubject: 10,
  linesPerDay: 3,
}

const names = [
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

/** A profile of about `length` characters, as consolidation would write it. */
const profileOf = (name: string, length: number) =>
  `${name} ${'keeps a steady routine, cares about the people around them and likes plans made early. '.repeat(Math.ceil(length / 90))}`.slice(
    0,
    length,
  )

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
    const entries: { entry: EntryId; at: number }[] = []
    const chunk = 2_000
    for (let from = 0; from < exchanges.length; from += chunk) {
      await harness.commit(async (tx) => {
        for (const { at, text } of exchanges.slice(from, from + chunk)) {
          const entry = await tx.appendEntry(familiar, {
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
          entries.push({ entry: entry.id, at })
          await tx.appendEntry(familiar, {
            kind: 'pi.assistant',
            model: [{ ...fauxAssistantMessage('Noted.'), timestamp: at + 1 }],
          })
        }
      }, BACKGROUND_CONTEXT)
    }

    await harness.commit(async (tx) => {
      // Compacted but for the last day, as a long chat is.
      const head = entries.at(-options.exchangesPerDay)!.entry
      await tx.appendEntry(familiar, {
        kind: CompactionEntry.kind,
        head,
        model: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Summary.' }],
            timestamp: end,
          },
        ],
        data: { reason: 'threshold' },
      })

      const memory = await tx.doc(Memory, String(familiar), null)
      let note = 1
      for (let index = 0; index < options.subjects; index++) {
        const id = `s${memory.next.subject++}`
        const name = `${names[index % names.length]} ${index}`
        const participant = index < 2
        memory.subjects.push({
          id,
          kind: 'person',
          name,
          line: `someone who came up in year ${Math.floor(index / 20) + 1}`,
          ...(participant && { person: `person-${index}` }),
          changed: start + Math.floor((index / options.subjects) * days) * DAY,
          profiled: end,
        })
        const notes: Note[] = []
        for (let n = 0; n < options.notesPerSubject; n++) {
          const at =
            start +
            Math.floor(
              ((index * options.notesPerSubject + n) /
                (options.subjects * options.notesPerSubject)) *
                days,
            ) *
              DAY
          const source =
            entries[
              Math.min(
                entries.length - 1,
                Math.floor(((at - start) / DAY) * options.exchangesPerDay),
              )
            ]
          notes.push({
            id: `n${note++}`,
            text: statements[n % statements.length](name, n),
            since: dayOf(at),
            quote: 'said so',
            source: source.entry,
            saidBy: USER,
          })
        }
        const page = await tx.doc(Pages, keyOf(familiar, id), null)
        page.notes = notes
        page.profile = profileOf(name, participant ? 800 : 300)
      }
      memory.next.note = note

      const months = new Map<string, JournalLine[]>()
      for (let day = 0; day < days; day++) {
        for (let n = 0; n < options.linesPerDay; n++) {
          const { entry, at } = entries[day * options.exchangesPerDay + n * 7]
          const month = dayOf(at).slice(0, 7)
          months.set(month, [
            ...(months.get(month) ?? []),
            {
              exchange: entry,
              on: dayOf(at - (n === 0 ? DAY : 0)),
              text: `${exchanges[day * options.exchangesPerDay + n * 7].text.slice(0, 120)}`,
              quote: 'said so',
              saidBy: USER,
            },
          ])
        }
      }
      for (const [month, lines] of months) {
        ;(await tx.doc(Journal, keyOf(familiar, month), null)).lines = lines
        memory.months.push(month)
      }
    }, BACKGROUND_CONTEXT)
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
  return {
    familiar,
    end,
    exchanges: exchanges.length,
    journalLines: days * options.linesPerDay,
  }
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

type Spread = { medianMs: number; maxMs: number }

export type SpeedResult = {
  exchanges: number
  notes: number
  /** Opening the store afresh, as after a restart. */
  openMs: number
  /** The first message after a restart: every page and month loaded, the transcript read into the index, then a search. */
  firstSearchMs: number
  /** The first automatic recall after another restart, the same load included. */
  firstRecallMs: number
  warmSearch: Spread
  warmRecall: Spread
  /** Documents read by warm searches and recalls: none, by design. */
  warmDocumentReads: number
  /** The memory section of the prompt, as every request renders it. */
  sectionMs: Spread
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
    let reads = 0
    const observer = {
      snapshot: ((...args: unknown[]) => {
        reads++
        return (harness.snapshot as (...a: unknown[]) => unknown)(...args)
      }) as Harness['snapshot'],
      snapshotAsOf: harness.snapshotAsOf.bind(harness),
      subscribeCommits: harness.subscribeCommits.bind(harness),
    }
    const viewAfterRestart = () =>
      memoryViews(observer, EVAL_TIME_ZONE, BACKGROUND_CONTEXT)(familiar)
    const searchWith =
      (view: ReturnType<typeof viewAfterRestart>) => async (query: string) => {
        await view.ready()
        return harness.commit(async (tx) => {
          await view.catchUp(tx)
          return view
            .search(query, {
              now,
              kind: 'exchange',
              ranges: datesIn(query, localDay(now, EVAL_TIME_ZONE)),
            })
            .slice(0, 10)
        }, BACKGROUND_CONTEXT)
      }
    const recallWith =
      (view: ReturnType<typeof viewAfterRestart>) => async (query: string) => {
        await view.ready()
        return harness.commit(async (tx) => {
          await view.catchUp(tx)
          return recallNote(view, query, now, { rooms: {} }, EVAL_TIME_ZONE)
        }, BACKGROUND_CONTEXT)
      }

    const view = viewAfterRestart()
    const first = await timed(() => searchWith(view)(QUERIES[0]))
    const firstRecall = await timed(() =>
      recallWith(viewAfterRestart())(QUERIES[0]),
    )
    const spread = async (work: (query: string) => Promise<unknown>) => {
      const times: number[] = []
      for (const query of QUERIES) {
        times.push((await timed(() => work(query))).ms)
      }
      return { medianMs: median(times), maxMs: Math.max(...times) }
    }
    const readsBefore = reads
    const warmSearch = await spread(searchWith(view))
    const warmRecall = await spread(recallWith(view))
    const warmDocumentReads = reads - readsBefore

    let sectionChars = 0
    const sections: number[] = []
    for (let run = 0; run < 5; run++) {
      sections.push(
        (
          await timed(async () => {
            sectionChars = renderSection(view).length
          })
        ).ms,
      )
    }
    const pages = view.subjects().map((subject) => view.page(subject.id))
    return {
      exchanges: view.search('', { now, kind: 'exchange' }).length,
      notes: pages.reduce(
        (total, page) => total + (page?.notes.length ?? 0),
        0,
      ),
      openMs: opened.ms,
      firstSearchMs: first.ms,
      firstRecallMs: firstRecall.ms,
      warmSearch,
      warmRecall,
      warmDocumentReads,
      sectionMs: { medianMs: median(sections), maxMs: Math.max(...sections) },
      sectionChars,
    }
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
}
