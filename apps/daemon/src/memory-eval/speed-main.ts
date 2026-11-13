import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { saveResult } from './results.ts'
import { generateStore, measureSpeed, TEN_YEARS } from './speed.ts'

const { values } = parseArgs({
  options: { years: { type: 'string', default: String(TEN_YEARS.years) } },
})
const options = { ...TEN_YEARS, years: Number(values.years) }
const directory = mkdtempSync(join(tmpdir(), 'familiar-speed-'))
const path = join(directory, 'store.sqlite')
try {
  const started = performance.now()
  const store = await generateStore(path, options)
  console.log(
    `Generated ${options.years} years, ${store.exchanges.toLocaleString()} exchanges, in ${((performance.now() - started) / 1000).toFixed(0)} s: ${(statSync(path).size / 1e6).toFixed(0)} MB on disk.`,
  )
  const result = await measureSpeed(path, store.familiar, store.end)
  const ms = (value: number) => `${value.toFixed(1)} ms`
  const spread = (s: { medianMs: number; maxMs: number }) =>
    `median ${ms(s.medianMs)}, max ${ms(s.maxMs)}`
  console.log(`
Store: ${result.exchanges.toLocaleString()} exchanges, ${result.facts} facts, ${result.episodes} episodes.
Opening the store afresh:             ${ms(result.openMs)}
First search after restart:           ${ms(result.firstSearchMs)} (index rebuilt from the whole transcript)
First automatic recall after restart: ${ms(result.firstRecallMs)} (index rebuilt, then facts and episodes searched)
Warm search (exchanges only):         ${spread(result.warmSearch)}
Warm automatic recall:                ${spread(result.warmRecall)}
  of which reading the documents ${ms(result.warmRecallSplit.readMs)}, searching them ${ms(result.warmRecallSplit.searchMs)}; the same search over plain copies ${ms(result.warmRecallSplit.plainSearchMs)}
Memory prompt section (${result.sectionChars} chars): ${spread(result.sectionMs)}`)
  console.log(`\nSaved ${saveResult('speed', { options, ...result })}`)
} finally {
  rmSync(directory, { recursive: true, force: true })
}
