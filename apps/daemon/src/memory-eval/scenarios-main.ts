import { parseArgs } from 'node:util'
import {
  createMeter,
  evalAccess,
  MEMORY_MODEL,
  REPLY_MODEL,
  UsageLimitError,
} from './model.ts'
import { saveResult } from './results.ts'
import { scenarios } from './scenarios.ts'
import { runScenario, type ScenarioResult } from './scenarios-run.ts'

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: REPLY_MODEL },
    'memory-model': { type: 'string', default: MEMORY_MODEL },
    only: { type: 'string' },
    'max-tokens': { type: 'string', default: '20000000' },
  },
})

let access: ReturnType<typeof evalAccess>
try {
  access = evalAccess({
    model: values.model,
    memoryModel: values['memory-model'],
  })
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}

const chosen = scenarios.filter(
  (scenario) => !values.only || scenario.id === values.only,
)
if (!chosen.length) {
  throw new Error(`No scenario ${values.only}.`)
}
const root = createMeter(Number(values['max-tokens']))
const results: ScenarioResult[] = []

try {
  for (const scenario of chosen) {
    console.log(`\n${scenario.id}: ${scenario.tests}`)
    results.push(await runScenario(scenario, access, root, console.log))
  }
} catch (error) {
  const left = chosen.filter((s) => !results.some((r) => r.id === s.id))
  console.error(error instanceof Error ? error.message : error)
  console.error(
    `${results.length} of ${chosen.length} scenarios finished; left: ${left.map((s) => s.id).join(', ')}. A scenario cut short is not a failure: run the command again${error instanceof UsageLimitError && error.resetAt ? ` after ${new Date(error.resetAt).toLocaleString()}` : ''}.`,
  )
  process.exitCode = 2
}

const failed = results.filter((result) => !result.passed)
console.log(
  `\n${results.length - failed.length} of ${results.length} scenarios passed; ${root.totals().total.toLocaleString()} tokens.`,
)
for (const result of failed) {
  for (const probe of result.probes.filter((p) => p.failures.length)) {
    console.log(`  ${result.id} (${probe.who}): ${probe.failures.join('; ')}`)
  }
}
console.log(
  `\nSaved ${saveResult('scenarios', { models: access.names, results })}`,
)
if (failed.length) {
  process.exitCode ||= 1
}
