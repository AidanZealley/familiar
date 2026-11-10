import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import { ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { afterEach, expect, test } from 'vitest'
import { openWorkspace, type Notification } from '../../src/index.ts'
import {
  MESSAGE_KIND,
  SCHEDULED_KIND,
  type MessageData,
} from '../../src/conversation/message.ts'
import { REPLY_KIND, type ReplyData } from '../../src/rooms/index.ts'
import { nextUpkeep } from '../../src/memory/upkeep/schedule.ts'
import { scriptedModels } from '../../src/models/scripted.ts'
import { fakeClock, inputOf } from '../../src/testing.ts'

/**
 * A store written before workspaces, by `generate.ts`, opened as a
 * workspace: everything its one Familiar kept is still there, and its
 * sleeping work carries on where it was.
 */

const here = dirname(fileURLToPath(import.meta.url))
const expected = JSON.parse(
  readFileSync(join(here, 'expected.json'), 'utf8'),
) as {
  now: number
  entries: { id: number; kind: string }[]
  model: unknown
  thinkingLevel: string
  facts: unknown[]
  episodes: unknown[]
  schedules: { id: string; prompt: string; next: number }[]
}

let directory: string | undefined
afterEach(() => {
  if (directory) {
    rmSync(directory, { recursive: true, force: true })
  }
})

/** A copy of the fixture's store, so no test changes the fixture. */
function copyOfStore() {
  directory = mkdtempSync(join(tmpdir(), 'familiar-pre-workspace-'))
  const path = join(directory, 'store.sqlite')
  copyFileSync(join(here, 'store.sqlite'), path)
  return path
}

const read = async <T>(
  watch: () => Promise<{ value: T; stop(): Promise<unknown> }>,
) => {
  const opened = await watch()
  await opened.stop()
  return opened.value
}

test('a pre-workspace store becomes a workspace whose one Familiar keeps everything and carries on', async () => {
  const path = copyOfStore()
  const clock = fakeClock(expected.now)
  const upkeepInputs: string[] = []
  // What each reminder's turn was delivered with, as the model saw it.
  const reminderInputs: string[] = []
  const notifications: Notification[] = []
  const sol = { provider: 'faux', modelId: 'sol' }
  const luna = { provider: 'faux', modelId: 'luna' }
  const open = async () =>
    openWorkspace({
      storage: await openNodeSqliteStorage(path),
      models: scriptedModels(
        (request) => {
          if (request.type === 'scheduled') {
            reminderInputs.push(inputOf(request.context))
          }
          if (request.type === 'background') {
            upkeepInputs.push(inputOf(request.context))
            return fauxAssistantMessage('Miso found the radiator.')
          }
          return fauxAssistantMessage('Time to book the vet for Miso.')
        },
        {
          models: [
            { id: 'sol', reasoning: true },
            { id: 'luna', reasoning: true },
          ],
        },
      ),
      model: sol,
      chatModels: [
        { model: sol, thinkingLevel: 'low' },
        { model: luna, thinkingLevel: 'medium' },
      ],
      timeZone: 'Europe/London',
      now: clock.now,
      setTimer: clock.setTimer,
      notify: async (notification) => {
        notifications.push(notification)
      },
    })

  const workspace = await open()
  try {
    // The root conversation's Familiar, named until a host renames it.
    expect(await workspace.familiars.list()).toEqual([
      { id: ROOT_CONVERSATION_ID, name: 'Familiar' },
    ])
    const familiar = workspace.familiars.get(ROOT_CONVERSATION_ID)!

    const view = await read(() => familiar.watch())
    expect(view.entries.map(({ id, kind }) => ({ id, kind }))).toEqual(
      expected.entries,
    )
    expect(view.docs['pi.agent']).toMatchObject({
      model: expected.model,
      thinkingLevel: expected.thinkingLevel,
    })
    const memory = await read(() => familiar.memory.watch())
    expect(
      memory?.facts.map(({ id, text, sources }) => ({ id, text, sources })),
    ).toEqual(expected.facts)
    const episodes = await read(() => familiar.memory.watchEpisodes())
    expect(
      episodes?.episodes.map(({ id, span, start, end, text, entries }) => ({
        id,
        span,
        start,
        end,
        text,
        entries,
      })),
    ).toEqual(expected.episodes)
    const schedules = await read(() => familiar.schedules.watch())
    expect(
      Object.values(schedules ?? {}).map(({ id, prompt, next }) => ({
        id,
        prompt,
        next,
      })),
    ).toEqual(expected.schedules)

    // The chat, copied once into the Familiar's DM with the person who
    // wrote it: each message as it was sent, and each run as one reply.
    const [listed] = await workspace.rooms.list()
    expect(listed).toMatchObject({
      kind: 'dm',
      familiar: ROOT_CONVERSATION_ID,
      person: 'aidan',
    })
    const dm = (await workspace.rooms.get(listed.id))!
    const dmLog = async () => (await read(() => dm.watch())).entries
    const copied = await dmLog()
    expect(copied.map((entry) => entry.kind)).toEqual([
      MESSAGE_KIND,
      REPLY_KIND,
      MESSAGE_KIND,
      REPLY_KIND,
      MESSAGE_KIND,
      REPLY_KIND,
    ])
    const sent = view.entries.filter((entry) => entry.kind === MESSAGE_KIND)
    expect(
      copied
        .filter((entry) => entry.kind === MESSAGE_KIND)
        .map((entry) => entry.data),
    ).toEqual(
      sent.map((entry) => ({
        ...(entry.data as Pick<MessageData, 'author' | 'text'>),
        at: entry.model![0].timestamp,
      })),
    )
    // The reminder's run keeps its tool activity.
    expect(
      (copied[3].data as unknown as ReplyData).messages.map(
        (message) => message.role,
      ),
    ).toEqual(['assistant', 'toolResult', 'assistant'])

    // Tonight's upkeep reviews only what last night's didn't.
    clock.advanceTo(nextUpkeep(expected.now, 'Europe/London'))
    await expect.poll(() => upkeepInputs.length).toBeGreaterThan(0)
    expect(upkeepInputs[0]).toContain('radiator')
    expect(upkeepInputs[0]).not.toContain('cat called Miso')

    // The reminder set before workspaces fires into the DM now.
    const [reminder] = expected.schedules
    clock.advanceTo(reminder.next)
    await expect
      .poll(() => notifications)
      .toEqual([
        expect.objectContaining({
          title: 'Familiar',
          body: 'Time to book the vet for Miso.',
        }),
      ])
    expect((await dmLog()).map((entry) => entry.kind).slice(-2)).toEqual([
      SCHEDULED_KIND,
      REPLY_KIND,
    ])

    // Having seen the whole copy, the Familiar isn't shown it again.
    expect(reminderInputs).toHaveLength(1)
    expect(reminderInputs[0]).not.toContain('cat called Miso')
  } finally {
    await workspace.dismiss()
  }

  // Adopted once: reopened, it is the same workspace, with its facts.
  const reopened = await open()
  try {
    expect(await reopened.familiars.list()).toHaveLength(1)
    const familiar = reopened.familiars.get(ROOT_CONVERSATION_ID)!
    expect((await read(() => familiar.memory.watch()))?.facts).toHaveLength(
      expected.facts.length,
    )
  } finally {
    await reopened.dismiss()
  }
})
