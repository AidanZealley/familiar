/**
 * Writes `store.sqlite`: a Familiar's storage as it was before workspaces,
 * and `expected.json`: what that storage holds, read back through the
 * Familiar API of the same version. The workspace migration test opens the
 * store with newer code and checks it against `expected.json`.
 *
 * The fixture is only meaningful from pre-workspace code. Running this after
 * the workspace change writes a store in the new format, which proves
 * nothing about migrating old ones, so don't regenerate it; add a new fixture
 * for a new format instead. `expected.json` records the commit it came from.
 *
 * Run from the repo root: node packages/core/fixtures/pre-workspace/generate.ts
 */
import { execSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { summonFamiliar, type Familiar } from '../../src/index.ts'
import {
  scriptedModels,
  type ScriptedRequest,
} from '../../src/models/scripted.ts'
import { nextUpkeep } from '../../src/memory/upkeep/schedule.ts'
import { parseMinute } from '../../src/time.ts'

const here = dirname(fileURLToPath(import.meta.url))
const storePath = join(here, 'store.sqlite')
const context = BACKGROUND_CONTEXT

const ZONE = 'Europe/London'
const at = (minute: string) => parseMinute(minute, ZONE)!

/** Every request is answered from what it asks, so the run is repeatable. */
function respond(request: ScriptedRequest): AssistantMessage {
  const said = JSON.stringify(request.context.messages)
  const isUpkeep = said.includes('long-term memory of')
  switch (request.type) {
    case 'message':
      if (request.text.includes('Remind me')) {
        return fauxAssistantMessage(
          [
            fauxToolCall('schedule', {
              prompt: 'Remind Aidan to book Miso in at the vet',
              at: '2027-01-04 09:00',
            }),
          ],
          { stopReason: 'toolUse' },
        )
      }
      return fauxAssistantMessage(`Noted: ${request.text}`)
    case 'tool-result':
      // After the schedule, a reply; after upkeep's filing, its episode.
      return fauxAssistantMessage(
        isUpkeep
          ? 'Aidan introduced Miso, their cat, and asked for a vet reminder.'
          : 'I will remind you.',
      )
    case 'background': {
      if (!isUpkeep) {
        return fauxAssistantMessage('A quiet week with Miso.') // a rollup
      }
      // Upkeep's input lists each person's line as `[x<entry> ...`.
      const input = JSON.stringify(request.context.messages.at(-1))
      const cat = /\[(x\d+) [^\]]*\][^[]*Miso/.exec(input)?.[1]
      if (!cat) {
        return fauxAssistantMessage('Nothing new to file.')
      }
      return fauxAssistantMessage(
        [
          fauxToolCall('remember', {
            text: 'Has a cat called Miso',
            importance: 4,
            sources: [cat],
          }),
        ],
        { stopReason: 'toolUse' },
      )
    }
    case 'scheduled':
      throw new Error('No schedule falls due while the fixture is made.')
  }
}

/** Polls `check` until it holds; the scheduler runs on its own. */
async function until(check: () => Promise<boolean>, what: string) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await check()) {
      return
    }
    await setTimeout(10)
  }
  throw new Error(`Timed out waiting for ${what}.`)
}

async function read<T>(
  watch: () => Promise<{ value: T; stop(): Promise<unknown> }>,
) {
  const opened = await watch()
  await opened.stop()
  return opened.value
}

async function snapshot(familiar: Familiar) {
  const view = await read(() => familiar.watch())
  const memory = await read(() => familiar.memory.watch())
  const episodes = await read(() => familiar.memory.watchEpisodes())
  const schedules = await read(() => familiar.schedules.watch())
  const agent = view.docs['pi.agent']
  return {
    entries: view.entries.map(({ id, kind }) => ({ id, kind })),
    model: agent?.model,
    thinkingLevel: agent?.thinkingLevel,
    facts: memory?.facts.map(({ id, text, sources }) => ({
      id,
      text,
      sources,
    })),
    episodes: episodes?.episodes.map(
      ({ id, span, start, end, text, entries }) => ({
        id,
        span,
        start,
        end,
        text,
        entries,
      }),
    ),
    schedules: Object.values(schedules ?? {}).map(({ id, prompt, next }) => ({
      id,
      prompt,
      next,
    })),
  }
}

rmSync(storePath, { force: true })

let now = at('2026-11-02 12:00')
const timers: { due: number; fire: () => void }[] = []

const sol = { provider: 'faux', modelId: 'sol' }
const luna = { provider: 'faux', modelId: 'luna' }
const storage = await openNodeSqliteStorage(storePath)
const familiar = await summonFamiliar({
  storage,
  models: scriptedModels(respond, {
    models: [
      { id: 'sol', reasoning: true },
      { id: 'luna', reasoning: true },
    ],
  }),
  model: sol,
  chatModels: [
    { model: sol, thinkingLevel: 'low' },
    { model: luna, thinkingLevel: 'medium' },
  ],
  timeZone: ZONE,
  name: 'Fixture',
  now: () => now,
  setTimer: (fire, delayMs, { background }) => {
    if (background) {
      return undefined
    }
    const timer = { due: now + delayMs, fire }
    timers.push(timer)
    return () => void timers.splice(timers.indexOf(timer), 1)
  },
})

const aidan = { id: 'aidan', name: 'Aidan' }
const say = async (text: string) => {
  await familiar.send({ author: aidan, text, requestId: text.slice(0, 64) })
  await familiar.idle()
}

// A non-default model and level, remembered per model.
await familiar.setModel(luna)
await familiar.setThinkingLevel('high')

await say('I have a cat called Miso.')
await say('Remind me to book Miso in at the vet in January.')

// The night's upkeep pass files the fact, writes the episode and moves
// `through` past both messages.
const pass = nextUpkeep(now, ZONE)
now = pass
for (const timer of timers.splice(0).filter((timer) => timer.due <= now)) {
  timer.fire()
}
await until(async () => {
  const tasks = await storage.scanTasks(
    { kind: 'familiar.upkeep' },
    1,
    undefined,
    context,
  )
  const state = tasks.items[0]?.state
  return state?.status === 'sleeping' && state.until > pass
}, 'the upkeep pass')

// Said after the pass, so the next one still has it to review.
now = at('2026-11-03 10:00')
await say('Miso has started sleeping on the radiator.')

const expected = {
  commit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
  now,
  ...(await snapshot(familiar)),
}
await familiar.dismiss()

writeFileSync(
  join(here, 'expected.json'),
  `${JSON.stringify(expected, null, 2)}\n`,
)
console.log(`Wrote ${storePath} from ${expected.commit}.`)
