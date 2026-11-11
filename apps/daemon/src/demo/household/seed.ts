import { setTimeout } from 'node:timers/promises'
import type {
  FamiliarId,
  Mention,
  RoomApi,
  RoomId,
  RoomsState,
  Workspace,
} from '@familiar-ai/core'
import { OWNER_ID } from '../../serve.ts'
import type { DemoClock } from '../clock.ts'
import { seedMcp } from '../scenarios/mcp.ts'
import { memories, SEED_MESSAGE } from './memory.ts'
import { createScript } from './script.ts'
import type { Moment, RoomSeed, Said, Story } from './story.ts'

/** Every reply the story writes down, for the scripted model to give. */
export function scriptOf(story: Story) {
  const script = createScript(story.familiars)
  for (const room of story.rooms) {
    for (const said of [...room.history, ...(room.live ? [room.live] : [])]) {
      if ('say' in said) {
        for (const [familiar, reply] of Object.entries(said.replies)) {
          script.add({ familiar, input: said.say }, reply)
        }
      }
    }
  }
  return script
}

/** When the story starts: a minute before anything in it happens. */
export const startOf = (story: Story) =>
  Math.min(...story.rooms.flatMap((room) => room.history.map(({ at }) => at))) -
  60_000

/**
 * Plays `story` into a fresh workspace through its API, on `clock`, which
 * starts at `startOf(story)`: who's who, their tools and memory, then every
 * room's history in time order, letting schedules fall due on the way. Then
 * real time resumes and each room's `live` message is sent and left
 * running. `first` is the Familiar the daemon created, the story's first.
 */
export async function seedHousehold(
  workspace: Workspace,
  first: FamiliarId,
  story: Story,
  clock: DemoClock,
) {
  const author = { id: OWNER_ID, name: story.owner }
  await workspace.people.rename(OWNER_ID, story.owner)
  await seedMcp(workspace)
  await workspace.setDefaultCapabilities(story.defaults)

  const familiars = new Map<string, FamiliarId>()
  for (const [index, seed] of story.familiars.entries()) {
    const { name, persona, avatar, capabilities, model } = seed
    let id = first
    if (index === 0) {
      await workspace.familiars.update(first, { name, persona, avatar })
      await workspace.familiars.get(first)!.setCapabilities(capabilities)
    } else {
      id = (
        await workspace.familiars.create({
          name,
          persona,
          ...(avatar && { avatar }),
          capabilities,
        })
      ).id
    }
    if (model) {
      await workspace.familiars.get(id)!.setModel(model)
    }
    familiars.set(name, id)
  }
  const familiar = (name: string) => {
    const id = familiars.get(name)
    if (id === undefined) {
      throw new Error(`The story has no Familiar ${name}.`)
    }
    return workspace.familiars.get(id)!
  }

  /** Until nothing runs or is due: every turn answered, every reminder delivered. */
  const settle = async () => {
    while (workspace.wake().active) {
      workspace.resume()
      await setTimeout(20)
    }
  }
  /** Moves the clock to `at`, stopping at each sleeping task's time on the way to run it. */
  const advance = async (at: number) => {
    for (let due = workspace.wake().at; due !== undefined && due <= at;) {
      clock.set(due)
      await settle()
      due = workspace.wake().at
    }
    clock.set(at)
  }

  // Memory first, as the demo always has: the first Familiar is asked to
  // seed every Familiar's, in its DM, then the owner pins what they would.
  const dm = await open(workspace, await workspace.rooms.dm(first, OWNER_ID))
  await dm.post({ author, text: SEED_MESSAGE, requestId: 'seed' })
  await settle()
  for (const [name, id] of familiars) {
    const { memory } = workspace.familiars.get(id)!
    const watch = await memory.watch()
    await watch.stop()
    for (const text of memories[name]?.pinned ?? []) {
      const fact = watch.value?.facts.find((fact) => fact.text === text)
      if (fact) {
        await memory.setPinned(fact.id, true)
      }
    }
  }

  const rooms = new Map<RoomSeed, RoomApi>()
  for (const room of story.rooms) {
    const id =
      'dm' in room
        ? await workspace.rooms.dm(familiars.get(room.dm)!, OWNER_ID)
        : await workspace.rooms.create({
            name: room.name,
            familiars: room.familiars.map((name) => familiars.get(name)!),
            ...(room.lead && { lead: familiars.get(room.lead)! }),
          })
    rooms.set(room, await open(workspace, id))
  }
  const members = (room: RoomSeed) =>
    ('dm' in room ? [room.dm] : room.familiars).map((name) => ({
      name,
      id: familiars.get(name)!,
    }))

  let requests = 0
  const post = (room: RoomSeed, { say }: Said) =>
    rooms.get(room)!.post({
      author,
      text: say,
      requestId: `story-${++requests}`,
      mentions: mentionsIn(say, members(room)),
    })

  const happen = async (room: RoomSeed, moment: Moment) => {
    const api = rooms.get(room)!
    if ('say' in moment) {
      await post(room, moment)
    } else if ('note' in moment) {
      await api.note({ text: moment.note, requestId: `story-${++requests}` })
    } else if ('pause' in moment) {
      const { familiar: name, prompt } = moment.pause
      const { schedules } = familiar(name)
      const watch = await schedules.watch()
      await watch.stop()
      const found = Object.values(watch.value ?? {}).find(
        (schedule) => schedule.prompt === prompt,
      )
      if (!found) {
        throw new Error(`${name} has no schedule "${prompt}".`)
      }
      await schedules.pause(found.id)
    } else {
      await workspace.rooms.archive(api.id)
    }
  }

  const timeline = story.rooms
    .flatMap((room) => room.history.map((moment) => ({ room, moment })))
    .sort((a, b) => a.moment.at - b.moment.at)
  for (const { room, moment } of timeline) {
    await advance(moment.at)
    await happen(room, moment)
    await settle()
  }
  await advance(Date.now())
  clock.resume()

  // What the owner has read, as the room lists count it.
  const listed = await workspace.rooms.list(OWNER_ID)
  for (const [room, api] of rooms) {
    const last = listed.find(({ id }) => id === api.id)?.last
    if (room.read && last) {
      await api.read(OWNER_ID, last.entry)
    }
  }

  // Live: the first is left running, so the others queue behind it.
  const [running, ...waiting] = story.rooms.filter((room) => room.live)
  if (running) {
    const posted = await post(running, running.live!)
    await until(workspace, ({ rooms: state }) =>
      Object.values(state).some((room) =>
        room.turns.some(
          (turn) =>
            turn.status === 'running' &&
            String(room.last?.entry) === String(posted),
        ),
      ),
    )
  }
  for (const room of waiting) {
    await post(room, room.live!)
  }
}

const open = async (workspace: Workspace, id: RoomId) =>
  (await workspace.rooms.get(id))!

/** The `@Name` of each Familiar in `members` that `text` mentions. */
function mentionsIn(
  text: string,
  members: { name: string; id: FamiliarId }[],
): Mention[] {
  return members.flatMap(({ name, id }) => {
    const start = text.indexOf(`@${name}`)
    return start === -1
      ? []
      : [
          {
            kind: 'familiar' as const,
            id: String(id),
            start,
            end: start + name.length + 1,
          },
        ]
  })
}

/** Resolves once the rooms, as the owner's list shows them, satisfy `done`. */
async function until(
  workspace: Workspace,
  done: (state: RoomsState) => boolean,
) {
  const watch = await workspace.rooms.watch(OWNER_ID)
  try {
    if (!done(watch.value)) {
      await new Promise<void>((resolve) =>
        watch.start(async (state) => {
          if (done(state)) {
            resolve()
          }
        }),
      )
    }
  } finally {
    await watch.stop()
  }
}
