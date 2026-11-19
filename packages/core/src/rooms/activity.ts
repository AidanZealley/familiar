import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  InboxDoc,
  LiveDoc,
  type EntryId,
  type Harness,
  type InboxState,
  type LiveState,
  type SubmissionId,
  type WatchHandle,
} from '@earendil-works/pi-durable'
import { derivedWatch } from '../pi/watch.ts'
import { pendingIn, Questions, type Question } from '../questions/index.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { membersOf, Rooms, type RoomId } from './rooms.ts'
import { inputOrigin, originOf, type Origin } from './status.ts'

/**
 * What a room shows of its Familiars' work on it: whether each is replying
 * here, with its reply as it streams, or has something from here queued.
 * Derived from the Familiars' chats' live state and inboxes (see
 * status.ts), never stored, and never anything from a Familiar's other
 * rooms but that it's busy elsewhere.
 */

/** One Familiar's work in a room, keyed by its FamiliarId. */
export type TurnActivity = {
  familiar: FamiliarId
  /** The room entry it's answering, or the first it has queued. */
  cause: EntryId
} & (
  | {
      /**
       * Waiting for its Familiar: `queued` behind work in this room or a
       * reply being posted; `elsewhere` while its Familiar works in another
       * room, which isn't said.
       */
      status: 'queued' | 'elsewhere'
    }
  | {
      /** Its Familiar is replying here. */
      status: 'running'
      /** The reply so far, as Pi publishes it. */
      generation?: LiveState['generation']
      /** The current round's tool calls. */
      tools?: LiveState['tools']
      /** What its Familiar is waiting for the person to answer, oldest first. */
      questions?: Question[]
    }
)

export type RoomActivity = Record<string, TurnActivity>

/**
 * A Familiar's chat's live state and inbox, as far as each has been read,
 * and where its inputs came from, by submission: null for none, undefined
 * while not yet known.
 */
export type Chat = {
  live: Readonly<LiveState> | null | undefined
  inbox: Readonly<InboxState> | null | undefined
  origin: (input: SubmissionId) => Origin | null | undefined
}

/** `room`'s activity: each of `familiars` placed against its chat. */
export function activityOf(
  room: RoomId | string,
  familiars: readonly FamiliarId[],
  chatOf: (familiar: FamiliarId) => Chat,
  questions?: Parameters<typeof pendingIn>[0],
): RoomActivity {
  const here = (origin: Origin | null | undefined) =>
    !!origin && String(origin.room) === String(room)
  const activity: RoomActivity = {}
  for (const familiar of familiars) {
    const { live, inbox, origin } = chatOf(familiar)
    const run = live?.run
    const running = run?.inputs.map(origin).find(here)
    if (running) {
      const asking = pendingIn(questions, familiar)
      activity[familiar] = {
        familiar,
        cause: running.cause,
        status: 'running',
        ...(live!.generation && { generation: live!.generation }),
        ...(live!.tools && { tools: live!.tools }),
        ...(asking.length > 0 && { questions: asking }),
      }
      continue
    }
    const queued = inbox?.items
      .map((item) => originOf(item.entry?.data))
      .find(here)
    if (queued) {
      // Behind another room's run only once that run's input is known to
      // be another room's.
      const elsewhere = !!run?.inputs.some((input) => {
        const from = origin(input)
        return from !== undefined && !here(from)
      })
      activity[familiar] = {
        familiar,
        cause: queued.cause,
        status: elsewhere ? 'elsewhere' : 'queued',
      }
    }
  }
  return activity
}

const context = BACKGROUND_CONTEXT

/** Where `inputs` came from, each read from Pi once. */
function origins(harness: Harness, onKnown: () => void) {
  const known = new Map<SubmissionId, Origin | null>()
  const asked = new Map<SubmissionId, Promise<void>>()
  return {
    /** Once every origin asked for so far is known. */
    known: () => Promise.all(asked.values()),
    /** Notes the origins an inbox carries with its items. */
    note: (inbox: Readonly<InboxState> | null | undefined) => {
      for (const item of inbox?.items ?? []) {
        known.set(item.id, originOf(item.entry?.data))
      }
    },
    /** An input's origin, read in the background if not yet known. */
    of: (input: SubmissionId) => {
      if (!known.has(input) && !asked.has(input)) {
        asked.set(
          input,
          harness
            .commit((tx) => inputOrigin(tx, input), context)
            .then((origin) => {
              known.set(input, origin)
              onKnown()
            }),
        )
      }
      return known.get(input)
    },
  }
}

/**
 * Familiars' chats, for a derived watch of rooms' activity: `follow`
 * attaches each Familiar's chat from when it's first given until the watch
 * stops, `chatOf` reads what it has, and `start` makes `derived` follow
 * them all. A watch's first value is computed before it starts, so its
 * Familiars are followed first.
 */
export function chatsOf(harness: Harness) {
  type Followed = {
    live?: WatchHandle<Chat['live']>
    inbox?: WatchHandle<Chat['inbox']>
    attached?: Promise<void>
  }
  const chats = new Map<FamiliarId, Followed>()
  let derived: ReturnType<typeof derivedWatch> | undefined
  const inputs = origins(harness, () => derived?.refresh())
  const attach = ({ live, inbox }: Followed) => {
    if (live) {
      derived?.follow(live)
    }
    if (inbox) {
      derived?.follow(inbox)
    }
  }
  const chatOf = (familiar: FamiliarId): Chat => {
    const chat = chats.get(familiar)
    inputs.note(chat?.inbox?.value)
    return {
      live: chat?.live?.value,
      inbox: chat?.inbox?.value,
      origin: inputs.of,
    }
  }
  return {
    chatOf,
    /**
     * Follows `familiars`' chats; resolves once each is attached and the
     * origins of the inputs their runs hold are known.
     */
    follow: async (familiars: Iterable<FamiliarId>) => {
      const attaching: Promise<void>[] = []
      for (const familiar of familiars) {
        const followed = chats.get(familiar)
        if (followed) {
          attaching.push(followed.attached!)
          continue
        }
        const chat: Followed = {}
        chats.set(familiar, chat)
        // A Familiar's chat is set up with both documents when it opens.
        chat.attached = Promise.all([
          harness.watchDoc(LiveDoc, familiar, context),
          harness.watchDoc(InboxDoc, familiar, context),
        ]).then(
          ([live, inbox]) => {
            chat.live = live
            chat.inbox = inbox
            attach(chat)
          },
          () => derived?.end(),
        )
        attaching.push(chat.attached)
      }
      await Promise.all(attaching)
      for (const familiar of chats.keys()) {
        chatOf(familiar).live?.run?.inputs.forEach(inputs.of)
      }
      await inputs.known()
    },
    start: (watch: ReturnType<typeof derivedWatch>) => {
      derived = watch
      for (const chat of chats.values()) {
        attach(chat)
      }
    },
  }
}

/** `room`'s activity, live, following its Familiars' chats as they join. */
export async function watchActivity(
  harness: Harness,
  room: RoomId,
): Promise<WatchHandle<RoomActivity>> {
  // Opening the workspace creates these.
  const registry = (await harness.watchDoc(Rooms, context))!
  const questions = (await harness.watchDoc(Questions, context))!
  const members = () => {
    const record = registry.value?.rooms[room]
    return record ? membersOf(record) : []
  }
  const chats = chatsOf(harness)
  await chats.follow(members())
  const derived = derivedWatch(() =>
    activityOf(room, members(), chats.chatOf, questions.value),
  )
  chats.start(derived)
  derived.follow(registry, () => void chats.follow(members()))
  derived.follow(questions)
  return derived.watch
}
