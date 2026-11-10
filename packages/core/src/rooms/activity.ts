import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  InboxDoc,
  LiveDoc,
  type EntryId,
  type Harness,
  type InboxState,
  type LiveState,
  type WatchHandle,
} from '@earendil-works/pi-durable'
import { derivedWatch } from '../watch.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { Turns, type RoomId, type TurnRecord } from './rooms.ts'

/**
 * What a room shows of the work its turns are doing in their Familiars'
 * chats: each turn's place in its Familiar's queue, and its reply as it
 * streams. Derived from the room's turns document and those chats' live
 * state, never stored, and never anything from a Familiar's other rooms.
 */

/** One turn in progress in a room, by its task's ID. */
export type TurnActivity = {
  familiar: FamiliarId
  /** The room entry it answers. */
  cause: EntryId
} & (
  | {
      /**
       * Waiting for its Familiar: `queued` behind work in this room, or not
       * yet delivered; `elsewhere` while its Familiar works in another room,
       * which isn't said.
       */
      status: 'queued' | 'elsewhere'
    }
  | {
      /** Its Familiar is answering it. */
      status: 'running'
      /** The reply so far, as Pi publishes it. */
      generation?: LiveState['generation']
      /** The current round's tool calls. */
      tools?: LiveState['tools']
    }
)

export type RoomActivity = Record<string, TurnActivity>

/** A Familiar's chat's live state, as far as it has been read. */
type Chat = {
  live: Readonly<LiveState> | null | undefined
  inbox: Readonly<InboxState> | null | undefined
}

/** The room's turns, each placed against its Familiar's chat. */
export function activityOf(
  turns: Readonly<Record<string, TurnRecord>>,
  chatOf: (familiar: FamiliarId) => Chat,
): RoomActivity {
  // A run answering any of these inputs is this room's.
  const here = new Set(
    Object.values(turns).flatMap((turn) => turn.submission ?? []),
  )
  const activity: RoomActivity = {}
  for (const [task, { familiar, cause, submission }] of Object.entries(turns)) {
    const { live, inbox } = chatOf(familiar)
    const run = live?.run
    if (submission !== undefined && run?.inputs.includes(submission)) {
      activity[task] = {
        familiar,
        cause,
        status: 'running',
        ...(live!.generation && { generation: live!.generation }),
        ...(live!.tools && { tools: live!.tools }),
      }
      continue
    }
    const waiting =
      submission === undefined ||
      !inbox ||
      inbox.items.some((item) => item.id === submission)
    // Settled, with its reply about to be copied in.
    if (!waiting) {
      activity[task] = { familiar, cause, status: 'running' }
      continue
    }
    // Only once its own input is known to wait: a run that starts as it's
    // delivered would otherwise look like another room's for a commit.
    const elsewhere =
      submission !== undefined &&
      !!run &&
      !run.inputs.some((input) => here.has(input))
    activity[task] = {
      familiar,
      cause,
      status: elsewhere ? 'elsewhere' : 'queued',
    }
  }
  return activity
}

const context = BACKGROUND_CONTEXT

/**
 * `room`'s activity, live. Follows each Familiar's chat from the first turn
 * it has here until the watch stops.
 */
export async function watchActivity(
  harness: Harness,
  room: RoomId,
): Promise<WatchHandle<RoomActivity>> {
  // Every room's log is created with its turns document.
  const turns = (await harness.watchDoc(Turns, room, context))!
  const chats = new Map<
    FamiliarId,
    { live?: WatchHandle<Chat['live']>; inbox?: WatchHandle<Chat['inbox']> }
  >()
  const derived = derivedWatch(() =>
    activityOf(turns.value ?? {}, (familiar) => {
      const chat = chats.get(familiar)
      return { live: chat?.live?.value, inbox: chat?.inbox?.value }
    }),
  )

  const followChats = () => {
    for (const { familiar } of Object.values(turns.value ?? {})) {
      if (chats.has(familiar)) {
        continue
      }
      const chat: {
        live?: WatchHandle<Chat['live']>
        inbox?: WatchHandle<Chat['inbox']>
      } = {}
      chats.set(familiar, chat)
      // A Familiar's chat is set up with both documents when it opens.
      void Promise.all([
        harness.watchDoc(LiveDoc, familiar, context),
        harness.watchDoc(InboxDoc, familiar, context),
      ]).then(([live, inbox]) => {
        chat.live = live
        chat.inbox = inbox
        if (live) {
          derived.follow(live)
        }
        if (inbox) {
          derived.follow(inbox)
        }
      }, derived.end)
    }
  }

  derived.follow(turns, followChats)
  return derived.watch
}
