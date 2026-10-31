import type { EntryId } from '@earendil-works/pi-durable'
import {
  createExchangeIndex,
  datesIn,
  localDay,
  type Exchange,
} from '@familiar/core/diagnostics'
import { EVAL_TIME_ZONE } from './clock.ts'
import { categories, type Category, type Scenario } from './scenario.ts'

/**
 * The rot test: the scenario's questions asked of exchange search alone, with
 * years of ordinary conversation added after the scenario. No model is
 * involved, so it shows in seconds whether more history makes old details
 * harder to find.
 */

const DAY = 24 * 60 * 60 * 1000

/** Years of filler added after the scenario, cumulatively. */
export const PADDING_YEARS = [0, 1, 5, 10] as const
const EXCHANGES_PER_DAY = 10

/** Midday local time, so a day never shifts with the time zone. */
const middayOf = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, 12).getTime()
}

/** One exchange per scenario day that has text, as the person said it. */
export const scenarioExchanges = (scenario: Scenario): Exchange[] =>
  scenario.days
    .filter((day) => day.text)
    .map((day, index) => ({
      id: `x${index + 1}`,
      at: middayOf(day.date),
      text: day.text!,
      last: (index + 1) as EntryId,
    }))

// The scenario's people, projects and places with everyday activity, so the
// filler competes for the same words without saying anything a question asks.
const people = ['Saffron', 'Ellis', 'June', 'Noor', 'Mae', 'Petra', 'Pip']
const projects = [
  'Tidal Rooms',
  'Reed Shelter',
  'Seed Ledger',
  'Night Orchard',
  'Folded Atlas',
  'Canal Voices',
  'Paper Moon',
]
const places = [
  'the library',
  'the allotment',
  'the archive',
  'the workshop',
  'the market',
  'the river path',
  'the museum café',
]
const activities = [
  'cooked a pan of lentil soup',
  'fixed a squeaky cupboard hinge',
  'sorted the recycling',
  'read on the sofa for an hour',
  'watered the tomatoes',
  'bought bread, milk and apples',
  'cleaned the bike chain',
  'wrote a shopping list',
  'swept the yard',
  'answered a pile of emails',
  'repotted a spider plant',
  'ironed some shirts',
]
const parts = ['morning', 'afternoon', 'evening', 'lunchtime']
const templates = [
  (p: Picks) =>
    `Spent the ${p.part} with ${p.person} at ${p.place}; we ${p.activity} and chatted about nothing much.`,
  (p: Picks) =>
    `${p.person} asked how ${p.project} was going. I said I'd look at it again soon, then ${p.activity}.`,
  (p: Picks) =>
    `A quiet ${p.part}. I ${p.activity} and thought a little about ${p.project}.`,
  (p: Picks) =>
    `Went to ${p.place} in the ${p.part}. ${p.person} was there too, so we ${p.activity} together.`,
  (p: Picks) =>
    `Nothing new on ${p.project} today. I ${p.activity}, then ${p.activity2}.`,
]
type Picks = {
  person: string
  project: string
  place: string
  activity: string
  activity2: string
  part: string
}

/** The same numbers every run, so results compare across commits. */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

/** `days` days of filler from `start`, `EXCHANGES_PER_DAY` a day. */
export function fillerExchanges(start: number, days: number, firstId: number) {
  const next = random(firstId)
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(next() * items.length)]
  const exchanges: Exchange[] = []
  for (let day = 0; day < days; day++) {
    for (let index = 0; index < EXCHANGES_PER_DAY; index++) {
      const picks: Picks = {
        person: pick(people),
        project: pick(projects),
        place: pick(places),
        activity: pick(activities),
        activity2: pick(activities),
        part: pick(parts),
      }
      exchanges.push({
        id: `x${firstId + exchanges.length}`,
        at: start + day * DAY + index * 60 * 60 * 1000,
        text: pick(templates)(picks),
        last: (firstId + exchanges.length) as EntryId,
      })
    }
  }
  return exchanges
}

/**
 * Required strings that appear nowhere in what the person said, such as
 * "Says no salary was ever mentioned". Only a judge can grade those, so
 * string-matching evals skip them.
 */
export function unquoted(scenario: Scenario) {
  const everything = scenarioExchanges(scenario)
    .map((exchange) => exchange.text)
    .join('\n')
    .toLowerCase()
  return scenario.questions.flatMap((question) =>
    question.required
      .filter((required) => !everything.includes(required.toLowerCase()))
      .map((required) => ({ question: question.id, required })),
  )
}

export type RecallScore = {
  category: Category
  years: number
  required: number
  at5: number
  at10: number
}

export type RecallResult = {
  scenario: string
  skipped: { question: string; required: string }[]
  scores: RecallScore[]
  exchanges: Record<number, number>
  buildMs: Record<number, number>
  search: Record<number, { medianMs: number; maxMs: number }>
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Builds the index once, adding each padding level's filler on top of the
 * last, and searches every question at each level. A required string counts
 * only when a scenario exchange in the top 5 or 10 contains it: filler names
 * projects, so its hits would flatter the score.
 */
export function runRecallEval(scenario: Scenario): RecallResult {
  const real = scenarioExchanges(scenario)
  const evidence = new Map(real.map((exchange) => [exchange.id, exchange]))
  const skipped = unquoted(scenario)
  const isSkipped = (question: string, required: string) =>
    skipped.some(
      (skip) => skip.question === question && skip.required === required,
    )

  const index = createExchangeIndex(EVAL_TIME_ZONE)
  const end = middayOf(scenario.days.at(-1)!.date)
  const result: RecallResult = {
    scenario: scenario.id,
    skipped,
    scores: [],
    exchanges: {},
    buildMs: {},
    search: {},
  }
  // Build time is cumulative: what indexing the whole history would take.
  let buildMs = 0
  let added = 0
  let pending = [...real]
  for (const years of PADDING_YEARS) {
    const days = years * 365 - added
    pending.push(
      ...fillerExchanges(
        end + (added + 1) * DAY,
        days,
        index.size + pending.length + 1,
      ),
    )
    added += days

    const started = performance.now()
    for (const exchange of pending) {
      index.add(exchange)
    }
    buildMs += performance.now() - started
    result.buildMs[years] = buildMs
    result.exchanges[years] = index.size
    pending = []

    // The evening of the last padded day.
    const now = end + added * DAY + 9 * 60 * 60 * 1000
    const times: number[] = []
    const tallies = new Map<Category, RecallScore>(
      categories.map((category) => [
        category,
        { category, years, required: 0, at5: 0, at10: 0 },
      ]),
    )
    for (const question of scenario.questions) {
      const searchStarted = performance.now()
      const found = index.search(question.text, now, {
        limit: 10,
        ranges: datesIn(question.text, localDay(now, EVAL_TIME_ZONE)),
      })
      times.push(performance.now() - searchStarted)
      const texts = found.map((exchange) =>
        (evidence.get(exchange.id)?.text ?? '').toLowerCase(),
      )
      const tally = tallies.get(question.category)!
      for (const required of question.required) {
        if (isSkipped(question.id, required)) {
          continue
        }
        const needle = required.toLowerCase()
        tally.required++
        tally.at5 += Number(texts.slice(0, 5).some((t) => t.includes(needle)))
        tally.at10 += Number(texts.some((t) => t.includes(needle)))
      }
    }
    result.scores.push(...tallies.values())
    result.search[years] = {
      medianMs: median(times),
      maxMs: Math.max(...times),
    }
  }
  return result
}
