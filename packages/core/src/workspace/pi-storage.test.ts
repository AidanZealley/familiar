import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  createRegistry,
  defineDoc,
  defineDocFamily,
  defineExtension,
  defineTask,
  Harness,
  ROOT_CONVERSATION_ID,
  type HarnessOptions,
  type Task,
} from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { fakeClock, fauxModels, ReopenableStorage } from '../testing.ts'

/**
 * The Pi behaviour moving a Familiar's state into a workspace relies on. Pi
 * is experimental and changes without notice; these fail first if it does.
 */

const context = BACKGROUND_CONTEXT

type Items = { items: string[] }
const common = {
  kind: 'test.items',
  version: 1,
  scope: 'session',
  initial: () => ({ items: [] }),
  checkpointWhen: () => true,
} as const
const Singleton = defineDoc<Items>(common)
const Family = defineDocFamily<Items, null>({ ...common, family: true })

const harnessOptions = (
  tasks: Task<never, never, never, never>[] = [],
  clock?: ReturnType<typeof fakeClock>,
): HarnessOptions => {
  const registry = createRegistry()
  registry.install(defineExtension({ name: 'test', tasks }))
  return {
    models: fauxModels().models,
    registry,
    now: clock?.now,
    setTimer: clock?.setTimer,
  }
}

test('a session document moves into a family of the same kind in one commit, and must not be read once retired', async () => {
  const harness = await Harness.open(
    new ReopenableStorage(),
    harnessOptions(),
    context,
  )
  await harness.commit(async (tx) => {
    ;(await tx.doc(Singleton)).items.push('kept')
  }, context)

  // Reads, writes and the retirement in one commit: all of it or none.
  await harness.commit(async (tx) => {
    const { items } = await tx.doc(Singleton)
    ;(await tx.doc(Family, 'f1', null)).items.push(...items)
    await tx.retireDoc(Singleton)
  }, context)

  expect(await harness.snapshot(Family, 'f1', context)).toEqual({
    items: ['kept'],
  })
  expect(await harness.snapshot(Singleton, context)).toBeUndefined()

  // Reading it again creates a new, empty one, so a migration runs once.
  await harness.commit((tx) => tx.doc(Singleton), context)
  expect(await harness.snapshot(Singleton, context)).toEqual({ items: [] })

  await harness.close(context)
})

test('a sleeping task keeps its stored version until it wakes, then migrates', async () => {
  const clock = fakeClock(1_000)
  const storage = new ReopenableStorage()
  const ran: unknown[] = []

  const sleeper = <I>(version: number, migrate?: (input: unknown) => I) =>
    defineTask<I, { phase: 'wait' } | { phase: 'run' }, null>({
      name: 'test.sleeper',
      version,
      initial: () => ({ phase: 'wait' }),
      ...(migrate && {
        migrate: (input, checkpoint) => ({
          input: migrate(input),
          checkpoint: checkpoint as { phase: 'run' },
        }),
      }),
      phases: {
        wait: (_task, runtime, context) =>
          runtime.sleepUntil(5_000, { phase: 'run' }, context),
        run: async (task, runtime, context) => {
          ran.push(task.input)
          await runtime.commit(
            () => ({
              status: 'terminal',
              outcome: { status: 'completed', result: null },
            }),
            context,
          )
        },
      },
      abort: (_task, runtime, context) =>
        runtime.commit(
          () => ({ status: 'terminal', outcome: { status: 'aborted' } }),
          context,
        ),
    })
  const v1 = sleeper<{ id: string }>(1)
  const v2 = sleeper(2, (input) => ({
    familiar: 'root',
    ...(input as { id: string }),
  }))

  const first = await Harness.open(
    storage,
    harnessOptions([v1 as never], clock),
    context,
  )
  await first.root(context)
  const id = await first.commit(
    (tx) =>
      tx.createTask(
        v1,
        { id: 's1' },
        {
          ownership: { kind: 'conversation' },
          conversationId: ROOT_CONVERSATION_ID,
          background: true,
        },
      ),
    context,
  )
  first.resume()
  const sleeping = async () =>
    (await storage.scanTasks({ kind: 'test.sleeper' }, 1, undefined, context))
      .items[0]
  await expect
    .poll(async () => (await sleeping())?.state.status)
    .toBe('sleeping')
  await first.close(context)

  const second = await Harness.open(
    storage,
    harnessOptions([v2 as never], clock),
    context,
  )
  second.resume()
  expect(await sleeping()).toMatchObject({ version: 1, input: { id: 's1' } })

  clock.advanceTo(5_000)
  await second.waitForTask(id, context)
  expect(ran).toEqual([{ familiar: 'root', id: 's1' }])
  await second.close(context)
})
