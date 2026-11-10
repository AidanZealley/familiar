import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createRegistry, Harness } from '@earendil-works/pi-durable'
import { expect, test } from 'vitest'
import { fauxModels, ReopenableStorage } from '../testing.ts'
import { createFamiliar } from '../workspace/familiars.ts'
import { post, REPLY_KIND, VIEW_KIND } from './log.ts'
import { dmWith } from './rooms.ts'
import type { TurnTask } from './turn.ts'
import { historyOf } from '../pi/entries.ts'

const context = BACKGROUND_CONTEXT

test("a room's view keeps its newest entries once it's long, and history reaches the rest", async () => {
  const harness = await Harness.open(
    new ReopenableStorage(),
    { models: fauxModels().models, registry: createRegistry() },
    context,
  )
  const { familiar, room } = await harness.commit(async (tx) => {
    const familiar = await createFamiliar(tx, { name: 'Ada' })
    return { familiar, room: await dmWith(tx, familiar, 'aidan') }
  }, context)

  // Replies start no turns, so no turn task is needed to post them.
  const posted = []
  for (let n = 0; n < 250; n++) {
    posted.push(
      await harness.commit(
        async (tx) =>
          (
            await post(
              tx,
              undefined as unknown as TurnTask,
              room,
              {
                kind: REPLY_KIND,
                data: {
                  familiar,
                  name: 'Ada',
                  cause: 1 as never,
                  outcome: 'answered',
                  messages: [],
                },
              },
              `reply:${n}`,
            )
          ).entry,
        context,
      ),
    )
  }

  const log = (await harness.conversation(room, context))!
  const watch = await log.watch(context)
  await watch.stop()
  const [marker, ...shown] = watch.value.entries
  expect(marker.kind).toBe(VIEW_KIND)
  // Never more than the limit in view, and always the newest.
  expect(shown.length).toBeLessThanOrEqual(200)
  expect(shown.at(-1)!.id).toBe(posted.at(-1))
  expect(shown[0].id).toBe(marker.head)

  // Paging back from the view's start reaches the first entry.
  const older: number[] = []
  let before = marker.head!
  for (;;) {
    const page = await historyOf(log, before, 50)
    older.push(
      ...page.entries
        .filter((entry) => entry.kind === REPLY_KIND)
        .map((entry) => entry.id),
    )
    if (!page.more) {
      break
    }
    before = page.entries.at(-1)!.id
  }
  expect([...older.reverse(), ...shown.map((entry) => entry.id)]).toEqual(
    posted,
  )
  await harness.close(context)
})
