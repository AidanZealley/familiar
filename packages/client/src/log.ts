import { applyImmutable } from '@earendil-works/chord/delta'
import type { RoomActivity, StreamEvent } from '@familiar-ai/core/http'
import type { ConversationView, EntryRecord } from '@earendil-works/pi-durable'
import type { StoreApi } from 'zustand/vanilla'
import type { FetchHistory } from './commands.ts'
import { toRoomTranscript, type Transcript } from './transcript.ts'

/** The log before the view, as far back as it has been loaded. */
export type History = {
  /** Committed entries older than any in the view, oldest first. */
  entries: readonly EntryRecord[]
  /**
   * `start` once `entries` reaches the start of the conversation; `failed`
   * if the last load did, until the next one.
   */
  status: 'more' | 'loading' | 'failed' | 'start'
}

/** The room store's log fields, which this module owns. */
export type LogState = {
  /** The room log's view. */
  view: ConversationView | undefined
  history: History
  /** The room's turns in progress, live. */
  turns: RoomActivity | null | undefined
  /** Derived with the view, history and turns; unchanged by unrelated updates. */
  transcript: Transcript | undefined
}

const transition = (
  previous: LogState,
  view: ConversationView | undefined,
  history: History,
  turns: LogState['turns'],
): LogState => ({
  view,
  history,
  turns,
  transcript:
    view === previous.view &&
    history.entries === previous.history.entries &&
    turns === previous.turns
      ? previous.transcript
      : view && toRoomTranscript(view, history.entries, turns ?? {}),
})

export const createLog = (
  set: StoreApi<LogState>['setState'],
  get: StoreApi<LogState>['getState'],
  historyPage: FetchHistory,
) => {
  /**
   * Loads the page before the oldest entry. `history.status` owns its
   * progress and failure, so one call at a time runs and none rejects.
   */
  const loadOlder = async () => {
    const state = get()
    const before = oldestOf(state)
    const { status } = state.history
    if (before === undefined || status === 'loading' || status === 'start') {
      return
    }
    set({ history: { ...state.history, status: 'loading' } })
    const page = await historyPage(before).catch(() => undefined)
    const current = get()
    // A reconnect gap reset history to `more` meanwhile, so this page
    // belongs to the old view, and a newer load may already be running.
    if (oldestOf(current) !== before) {
      return
    }
    set(
      page
        ? transition(
            current,
            current.view,
            {
              entries: [
                ...page.entries.toReversed(),
                ...current.history.entries,
              ],
              status: page.more ? 'more' : 'start',
            },
            current.turns,
          )
        : { history: { ...current.history, status: 'failed' } },
    )
  }

  const receive = (view: ConversationView | undefined) => {
    const state = get()
    return transition(
      state,
      view,
      carryOver(state.history, state.view, view),
      state.turns,
    )
  }
  return {
    loadOlder,
    receive,
    apply: (ops: Extract<StreamEvent, { event: 'ops' }>['data']) =>
      receive(applyImmutable(get().view, ops)),
    /** The turns, whole or patched, with the transcript they change. */
    turns: (turns: LogState['turns']) => {
      const state = get()
      return transition(state, state.view, state.history, turns)
    },
  }
}

/**
 * The oldest entry in a view. A view opens with its head marker, such as a
 * compaction summary, which is newer than the entry it heads.
 */
export const startOf = (view: ConversationView) =>
  view.entries[0] && (view.entries[0].head ?? view.entries[0].id)

const oldestOf = ({ view, history }: LogState) =>
  history.entries[0]?.id ?? (view && startOf(view))

/**
 * History after the view moves from `before` to `after`. Compaction moves the
 * view's start forward, and what leaves the view joins history, so loaded
 * history stays contiguous with it. If the new view starts somewhere the old
 * one never reached, as after a long disconnect, history starts over.
 */
export function carryOver(
  history: History,
  before: ConversationView | undefined,
  after: ConversationView | undefined,
): History {
  const from = before && startOf(before)
  const to = after && startOf(after)
  if (from === undefined || to === undefined || to <= from) {
    return history
  }
  if (!before!.entries.some((entry) => entry.id === to)) {
    return { entries: [], status: 'more' }
  }
  const left = before!.entries.filter((entry) => entry.id < to)
  return {
    ...history,
    entries: [...history.entries, ...left].toSorted((a, b) => a.id - b.id),
  }
}
