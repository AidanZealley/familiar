import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai'
import {
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { expect, test, vi } from 'vitest'
import { scriptedModels, type ScriptedRequest } from '../../models/scripted.ts'
import { fakeClock, testHost, TEST_ZONE, timeAt } from '../../testing.ts'
import { familiarDoc } from '../../workspace/familiars.ts'
import { onlyFamiliar, withHarness } from '../testing.ts'
import { Journal, keyOf } from '../store.ts'
import { Filing } from './task.ts'
import type { FileArgs } from './tools.ts'

// Filing end to end, in a workspace on scripted models: the clock, the
// pass, the call and the commit that applies it with the progress mark.

const context = BACKGROUND_CONTEXT
const MINUTE = 60 * 1000

const isFiling = (context: TranscriptContext) =>
  JSON.stringify(context.messages).includes('You keep the memory of')

/** A filing call's input, as the model is shown it. */
const shown = (context: TranscriptContext) => JSON.stringify(context.messages)

async function setup(
  file: (input: string) => FileArgs | 'unreadable',
  chat: (request: ScriptedRequest) => AssistantMessage = () =>
    fauxAssistantMessage('Noted.'),
) {
  const clock = fakeClock(timeAt('2026-03-06 09:00'))
  const calls: string[] = []
  const host = await testHost({
    timeZone: TEST_ZONE,
    now: clock.now,
    setTimer: clock.setTimer,
    models: scriptedModels((request) => {
      if (isFiling(request.context)) {
        const input = shown(request.context)
        calls.push(input)
        const args = file(input)
        return args === 'unreadable'
          ? fauxAssistantMessage('I would rather not.')
          : fauxAssistantMessage([fauxToolCall('file', args)], {
              stopReason: 'toolUse',
            })
      }
      return chat(request)
    }),
  })
  const idle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await vi.waitFor(() => expect(host.workspace().wake().active).toBe(false))
  }
  await idle()
  const filing = async () => {
    await host.dismiss()
    const state = await withHarness(host.storage, (harness) =>
      harness.commit(
        async (tx) => ({
          filing: JSON.parse(
            JSON.stringify(
              await familiarDoc(tx, Filing, await onlyFamiliar(tx)),
            ),
          ),
          march: JSON.parse(
            JSON.stringify(
              await tx.doc(
                Journal,
                keyOf(await onlyFamiliar(tx), '2026-03'),
                null,
              ),
            ),
          ),
        }),
        context,
      ),
    )
    await host.reopen()
    return state
  }
  return {
    host,
    clock,
    calls,
    idle,
    memory: () => host.familiar().memory,
    /** The Familiar's subjects now. */
    subjects: async () => {
      const watch = await host.familiar().memory.watch()
      await watch.stop()
      return watch.value!.subjects
    },
    filing,
    /** Moves the clock to `time` and waits for what that starts. */
    at: async (time: number) => {
      clock.advanceTo(time)
      await idle()
    },
  }
}

test('settled messages are filed hourly in one call, applied with the progress mark; a failing batch is retried on the next two ticks, then skipped', async () => {
  let answer: 'ok' | 'unreadable' = 'ok'
  const f = await setup(() =>
    answer === 'unreadable'
      ? 'unreadable'
      : {
          journal: [
            {
              m: [1],
              on: '2026-03-05',
              text: 'Aidan ran the Leeds 10k in 52 minutes.',
              quote: 'Leeds 10k yesterday',
            },
          ],
          notes: [
            {
              subject: 'Aidan',
              kind: 'fact',
              text: 'Aidan runs.',
              m: [1],
              quote: 'I ran',
            },
          ],
        },
  )
  await f.host.say('I ran the Leeds 10k yesterday in 52 minutes!')
  // Not yet ten minutes old at the next look.
  await f.at(timeAt('2026-03-06 09:05'))
  expect(f.calls).toHaveLength(0)

  await f.at(timeAt('2026-03-06 10:00'))
  expect(f.calls).toHaveLength(1)
  expect(f.calls[0]).toContain('[m1] aidan, in a DM, Fri 2026-03-06 09:00:')
  // The reply is context, never numbered.
  expect(f.calls[0]).toContain("(Familiar's reply, context only) Noted.")
  const aidan = (await f.subjects()).find(
    (subject) => subject.participant?.id === 'aidan',
  )!
  expect(
    (await f.memory().page(aidan.id)).notes.map((note) => note.text),
  ).toEqual(['Aidan runs.'])
  const first = await f.filing()
  expect(first.march.lines).toMatchObject([
    { on: '2026-03-05', text: 'Aidan ran the Leeds 10k in 52 minutes.' },
  ])
  expect(first.filing).toMatchObject({ failures: 0, pass: null })
  const filedThrough = first.filing.through

  // An hour with nothing new makes no call.
  await f.at(timeAt('2026-03-06 11:00'))
  expect(f.calls).toHaveLength(1)

  answer = 'unreadable'
  await f.host.say('We had pasta for dinner.')
  await f.at(timeAt('2026-03-06 12:00'))
  await f.at(timeAt('2026-03-06 13:00'))
  const failing = await f.filing()
  expect(failing.filing).toMatchObject({ failures: 2, through: filedThrough })
  await f.at(timeAt('2026-03-06 14:00'))
  expect(f.calls).toHaveLength(4)
  const skipped = await f.filing()
  expect(skipped.filing.failures).toBe(0)
  expect(skipped.filing.through).toBeGreaterThan(filedThrough)

  // The skipped batch is never tried again.
  answer = 'ok'
  await f.at(timeAt('2026-03-06 15:00'))
  expect(f.calls).toHaveLength(4)
})

test('remember files the message at once, as asked for; forgetting removes the note, clears its profile and blocks its message', async () => {
  const f = await setup(
    () => ({
      subjects: [
        { ref: 'maya', kind: 'person', name: 'Maya', line: "Aidan's partner" },
      ],
      notes: [
        {
          subject: 'maya',
          kind: 'fact',
          text: 'Maya is allergic to nuts.',
          m: [1],
          quote: 'Maya is allergic to nuts',
        },
      ],
    }),
    (request) =>
      request.type === 'message'
        ? fauxAssistantMessage([fauxToolCall('remember', {})], {
            stopReason: 'toolUse',
          })
        : fauxAssistantMessage('Kept.'),
  )
  await f.host.say('Please remember Maya is allergic to nuts.')
  await f.idle()
  // Filed within the turn's minute, not at the next tick.
  expect(f.calls).toHaveLength(1)
  const maya = (await f.subjects()).find((subject) => subject.name === 'Maya')!
  const [note] = (await f.memory().page(maya.id)).notes
  expect(note).toMatchObject({
    text: 'Maya is allergic to nuts.',
    origin: 'stated',
  })

  await f.memory().forget(note.id)
  const [forgotten] = (await f.memory().page(maya.id)).notes
  expect(forgotten).toMatchObject({
    text: '',
    quote: '',
    retired: { reason: 'forgotten' },
  })
  const after = await f.memory().watch()
  await after.stop()
  expect(after.value!.forgotten).toEqual(note.sources)
  await expect(f.memory().forget(note.id)).rejects.toThrow(
    `No note ${note.id}.`,
  )
  expect(await f.memory().section()).not.toContain('allergic')
})

test('a message only minutes old is filed with one asked to be remembered after it', async () => {
  const f = await setup(
    (input) => ({
      journal: input.includes('[m2]')
        ? [
            {
              m: [1],
              on: '2026-03-06',
              text: 'Aidan mentioned the boiler.',
              quote: 'boiler',
            },
          ]
        : [],
    }),
    (request) =>
      request.type === 'message' && request.text.startsWith('Remember')
        ? fauxAssistantMessage([fauxToolCall('remember', {})], {
            stopReason: 'toolUse',
          })
        : fauxAssistantMessage('Noted.'),
  )
  await f.host.say('The boiler is making a noise again.')
  f.clock.advanceTo(f.clock.now() + 2 * MINUTE)
  await f.host.say('Remember the engineer is called Priya.')
  await f.idle()
  expect(f.calls).toHaveLength(1)
  expect(f.calls[0]).toContain('[m2]')
})

test("a person's page is on the roster of their first call, and is named as the workspace names them now", async () => {
  const f = await setup(() => ({}))
  await f.host.say('I ran the Leeds 10k yesterday.')
  await f.at(timeAt('2026-03-06 10:00'))
  expect(f.calls[0]).toContain('s2 aidan (person, takes part)')
  expect(f.calls[0]).toContain('Pages these messages touch:')
  expect(f.calls[0].split('Pages these messages touch:')[1]).toContain(
    's2 aidan',
  )

  // Said under the old name, filed after the rename.
  await f.host.say('We had pasta for dinner.')
  await f.host.workspace().people.rename('aidan', 'Aidan Z')
  await f.at(timeAt('2026-03-06 11:00'))
  expect(f.calls[1]).toContain('[m1] Aidan Z, in a DM')
  expect(f.calls[1]).toContain('s2 Aidan Z (person, takes part)')
  expect((await f.subjects()).map((subject) => subject.name)).toEqual([
    'Familiar',
    'Aidan Z',
  ])
})

test('a batch is one day of messages, at most twenty', async () => {
  const f = await setup(() => ({}))
  for (let n = 1; n <= 21; n++) {
    await f.host.say(`Message ${n} of Friday.`)
  }
  await f.at(timeAt('2026-03-07 09:00'))
  await f.host.say('A message on Saturday.')
  await f.at(timeAt('2026-03-07 10:00'))

  expect(f.calls).toHaveLength(3)
  expect(f.calls[0]).toContain('[m20]')
  expect(f.calls[0]).not.toContain('[m21]')
  expect(f.calls[1]).toContain('Message 21 of Friday.')
  expect(f.calls[1]).not.toContain('[m2]')
  expect(f.calls[2]).toContain('A message on Saturday.')
  expect(f.calls[2]).not.toContain('of Friday')
})
