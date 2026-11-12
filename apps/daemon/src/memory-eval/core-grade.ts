import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  isPast,
  listFacts,
  rebalanceCore,
  TERMS,
  type Fact,
  type FactsState,
  type MemoryUsageState,
} from '@familiar-ai/core/diagnostics'
import type { CoreFixture } from './core-fixture.ts'
import {
  itemsOf,
  mayaV1,
  transcriptOf,
  type CoreScenario,
  type Item,
  type Label,
} from './core-scenario.ts'

/**
 * Grades an eval:core fixture in plain code. Core is decided again by the
 * current ranking first, so a change to ranking is measured on the saved
 * memory without a model call.
 */

const scenarios: Record<string, CoreScenario> = { [mayaV1.id]: mayaV1 }

/** Decides core over the saved memory; `rebalanceCore` unless comparing another ranking. */
export type Rebalance = (memory: {
  facts: FactsState
  usage: MemoryUsageState
}) => void

export type ItemGrade = {
  id: string
  label: Label
  /** Every fact that matches it, past ones included. */
  stored: string[]
  /** The current facts in core that match it. */
  inCore: string[]
  /** Whether it ended where its label says. */
  placed: boolean
}

export type CoreGrade = {
  scenario: string
  hash: string
  model: string
  /** Share of core facts that match a `core` item. */
  corePrecision: number
  /** Share of `core` items with a matching fact in core. */
  coreRecall: number
  /** Share of `recall` items with a matching fact in core; lower is better. */
  recallInCore: number
  /** Share of `none` items stored at all; lower is better. */
  junkRate: number
  /** Share of `fades` items no longer in core. */
  fadesOut: number
  /** Share of `changes` items whose current facts say the new value and not the old. */
  changesCorrect: number
  core: { facts: number; characters: number; tokens: number }
  /** Characters of every fact, past ones included, and episode, per character people said. */
  memoryRatio: number
  /** Facts saved, past ones included, per day anyone talked. */
  factsPerActiveDay: number
  /** Current facts whose words mostly overlap, by recall's own terms. */
  nearDuplicates: [string, string][]
  items: ItemGrade[]
  tokens: CoreFixture['tokens']
  elapsedMs: number
}

const matches = (fact: Fact, strings: readonly string[]) =>
  strings.some((string) =>
    fact.text.toLowerCase().includes(string.toLowerCase()),
  )

function gradeItem(item: Item, facts: Fact[]): ItemGrade {
  const current = facts.filter((fact) => !isPast(fact))
  const ids = (list: Fact[]) => list.map((fact) => fact.id)
  if (item.label === 'changes') {
    const stored = facts.filter((fact) => matches(fact, [item.from, item.to]))
    const placed =
      current.some((fact) => matches(fact, [item.to])) &&
      !current.some(
        (fact) => matches(fact, [item.from]) && !matches(fact, [item.to]),
      )
    return {
      id: item.id,
      label: item.label,
      stored: ids(stored),
      inCore: ids(stored.filter((fact) => fact.core && !isPast(fact))),
      placed,
    }
  }
  const stored = facts.filter((fact) => matches(fact, item.match))
  const inCore = stored.filter((fact) => fact.core && !isPast(fact))
  const placed = {
    core: inCore.length > 0,
    recall: stored.length > 0 && !inCore.length,
    none: !stored.length,
    fades: !inCore.length,
  }[item.label]
  return {
    id: item.id,
    label: item.label,
    stored: ids(stored),
    inCore: ids(inCore),
    placed,
  }
}

/** A fact's words as recall indexes them, splitting as MiniSearch does. */
const termsOf = (text: string) =>
  new Set(
    text
      .split(/[\n\r\p{Z}\p{P}]+/u)
      .flatMap((word) => TERMS.processTerm(word) ?? []),
  )

/** Two facts are near duplicates when most of their terms are shared. */
const NEAR_DUPLICATE = 0.5

function nearDuplicates(facts: Fact[]) {
  const terms = facts.map((fact) => termsOf(fact.text))
  const pairs: [string, string][] = []
  for (let a = 0; a < facts.length; a++) {
    for (let b = a + 1; b < facts.length; b++) {
      const shared = [...terms[a]].filter((term) => terms[b].has(term)).length
      const union = terms[a].size + terms[b].size - shared
      if (union && shared / union >= NEAR_DUPLICATE) {
        pairs.push([facts[a].id, facts[b].id])
      }
    }
  }
  return pairs
}

const share = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 1000 : 0

export function gradeCore(
  fixture: CoreFixture,
  {
    scenario = scenarios[fixture.scenario],
    rebalance = rebalanceCore,
  }: { scenario?: CoreScenario; rebalance?: Rebalance } = {},
): CoreGrade {
  if (!scenario) {
    throw new Error(`No core scenario ${fixture.scenario}.`)
  }
  const memory = structuredClone({
    facts: fixture.facts,
    usage: fixture.usage,
  })
  rebalance(memory)
  const facts = memory.facts.facts
  const core = facts.filter((fact) => fact.core && !isPast(fact))
  const items = itemsOf(scenario).map((item) => gradeItem(item, facts))
  const of = (label: Label) => items.filter((item) => item.label === label)
  const placedShare = (label: Label) =>
    share(of(label).filter((item) => item.placed).length, of(label).length)
  const coreItems = itemsOf(scenario).flatMap((item) =>
    item.label === 'core' ? [item.match] : [],
  )

  const coreList = listFacts(core)
  const memoryCharacters =
    listFacts(facts).length +
    fixture.episodes.episodes.reduce((sum, { text }) => sum + text.length, 0)
  return {
    scenario: fixture.scenario,
    hash: fixture.hash,
    model: fixture.model,
    corePrecision: share(
      core.filter((fact) => coreItems.some((match) => matches(fact, match)))
        .length,
      core.length,
    ),
    coreRecall: placedShare('core'),
    recallInCore: share(
      of('recall').filter((item) => item.inCore.length).length,
      of('recall').length,
    ),
    junkRate: share(
      of('none').filter((item) => item.stored.length).length,
      of('none').length,
    ),
    fadesOut: placedShare('fades'),
    changesCorrect: placedShare('changes'),
    core: {
      facts: core.length,
      characters: coreList.length,
      tokens: estimateTextTokens(coreList),
    },
    memoryRatio: share(memoryCharacters, transcriptOf(scenario).length),
    factsPerActiveDay: share(facts.length, scenario.days.length),
    nearDuplicates: nearDuplicates(facts.filter((fact) => !isPast(fact))),
    items,
    tokens: fixture.tokens,
    elapsedMs: fixture.elapsedMs,
  }
}
