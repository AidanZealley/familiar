import { applyImmutable } from '@earendil-works/chord/delta'
import type { StreamEvent } from '@familiar-ai/core/http'
import type {
  AgentState,
  ConversationView,
  EntryRecord,
} from '@earendil-works/pi-durable'
import type { StoreApi } from 'zustand/vanilla'
import type { FetchHistory } from './commands.ts'
import { toTranscript, type Transcript } from './transcript.ts'

/** The conversation before the view, as far back as it has been loaded. */
export type History = {
  /** Committed entries older than any in the view, oldest first. */
  entries: readonly EntryRecord[]
  /**
   * `start` once `entries` reaches the start of the conversation; `failed`
   * if the last load did, until the next one.
   */
  status: 'more' | 'loading' | 'failed' | 'start'
}

/** The store's conversation fields, which this module owns. */
export type ConversationState = {
  view: ConversationView | undefined
  history: History
  /** Derived with the view and history; unchanged by unrelated updates. */
  transcript: Transcript | undefined
}

const transition = (
  previous: ConversationState,
  view: ConversationView | undefined,
  history: History,
): ConversationState => ({
  view,
  history,
  transcript:
    view === previous.view && history.entries === previous.history.entries
      ? previous.transcript
      : view && toTranscript(view, history.entries),
})

export const createConversation = (
  set: StoreApi<ConversationState>['setState'],
  get: StoreApi<ConversationState>['getState'],
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
        ? transition(current, current.view, {
            entries: [...page.entries.toReversed(), ...current.history.entries],
            status: page.more ? 'more' : 'start',
          })
        : { history: { ...current.history, status: 'failed' } },
    )
  }

  const receive = (view: ConversationView | undefined) => {
    const state = get()
    return transition(state, view, carryOver(state.history, state.view, view))
  }
  return {
    loadOlder,
    receive,
    apply: (ops: Extract<StreamEvent, { event: 'ops' }>['data']) =>
      receive(applyImmutable(get().view, ops)),
  }
}

/** The conversation's model and reasoning level, as Pi stores them. */
export const agentOf = (view: ConversationView | undefined) =>
  view?.docs['pi.agent'] as AgentState | undefined

/**
 * The oldest entry in a view. A view opens with its head marker, such as a
 * compaction summary, which is newer than the entry it heads.
 */
export const startOf = (view: ConversationView) =>
  view.entries[0] && (view.entries[0].head ?? view.entries[0].id)

const oldestOf = ({ view, history }: ConversationState) =>
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
