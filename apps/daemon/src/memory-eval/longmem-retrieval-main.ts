import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  ensureDataset,
  idsOf,
  questionOf,
  readDataset,
  STRATA,
  type QuestionSet,
} from './longmem-data.ts'
import { writeHistory } from './longmem-history.ts'
import {
  KS,
  openMemorySearch,
  rateOf,
  scoreSearch,
  type RetrievalScore,
} from './longmem-retrieval.ts'
import { readSets } from './longmem-sets.ts'
import { percent, row, saveResult } from './results.ts'

const { values } = parseArgs({
  options: {
    set: { type: 'string', default: 'full' },
    'small-haystack': { type: 'boolean', default: false },
  },
})
const set = values.set as QuestionSet
if (!['dev', 'holdout', 'milestone', 'full'].includes(set)) {
  throw new Error('--set must be dev, holdout, milestone or full.')
}

const entries = await readDataset(await ensureDataset(undefined, console.log))
const ids = idsOf(set, readSets(entries), entries)
const byId = new Map(entries.map((entry) => [entry.question_id, entry]))
const directory = mkdtempSync(join(tmpdir(), 'familiar-longmem-retrieval-'))
const scores: RetrievalScore[] = []
const started = Date.now()

try {
  for (const [index, id] of ids.entries()) {
    const question = questionOf(byId.get(id)!, {
      small: values['small-haystack'] ? 10 : undefined,
    })
    const path = join(directory, `${id}.sqlite`)
    const store = await writeHistory(path, question, { asking: true })
    const memory = await openMemorySearch(store)
    try {
      const searching = performance.now()
      const ranked = await memory.search(question, Math.max(...KS))
      scores.push(
        scoreSearch(
          question,
          store.written,
          ranked,
          performance.now() - searching,
        ),
      )
    } finally {
      await memory.close()
    }
    rmSync(path, { force: true })
    if ((index + 1) % 50 === 0 || index + 1 === ids.length) {
      console.log(`${index + 1}/${ids.length} questions`)
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}

const unreachable = scores.filter((score) => score.unreachable)
const groups = [
  ...STRATA.map(
    (type) => [type, scores.filter((s) => s.type === type)] as const,
  ),
  ['answerable', scores.filter((s) => s.type !== 'abstention')] as const,
  ['all', scores] as const,
]
const table = (title: string, pick: Parameters<typeof rateOf>[1]) => {
  console.log(`\n${title}`)
  console.log(
    row([
      'Type',
      'Questions',
      ...KS.map((k) => `any@${k}`),
      ...KS.map((k) => `all@${k}`),
    ]),
  )
  const rows = groups.map(([name, of]) => {
    const rate = rateOf(of, pick)
    const cells = [
      name,
      String(rate.questions),
      ...KS.map((k) => percent(rate.any[k] * rate.questions, rate.questions)),
      ...KS.map((k) => percent(rate.all[k] * rate.questions, rate.questions)),
    ]
    console.log(row(cells))
    return { type: name, ...rate }
  })
  return rows
}

console.log(
  `\nRetrieval recall on ${set} (${scores.length} questions, ${values['small-haystack'] ? 'small' : 'full'} haystacks), memory's search over exchanges and their journal lines, as automatic recall ranks them. any: some evidence in the top k; all: every piece is.`,
)
const sessions = table('By answer session', (score) => score.sessions)
const turns = table(
  'By answer turn (questions the release labels turns for)',
  (score) => score.turns,
)
console.log(
  `\n${unreachable.length} questions have evidence in an opening assistant turn that no exchange holds, which counts as never found.`,
)
const times = scores.map((score) => score.searchMs).sort((a, b) => a - b)
console.log(
  `Build and first search per question: median ${times[Math.floor(times.length / 2)].toFixed(0)} ms, max ${times.at(-1)!.toFixed(0)} ms; ${((Date.now() - started) / 1000).toFixed(0)} s in all.`,
)
console.log(
  `\nSaved ${saveResult('longmem-retrieval', { set, small: values['small-haystack'], sessions, turns, unreachable: unreachable.map((s) => s.question), scores })}`,
)
