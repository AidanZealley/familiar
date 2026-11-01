import { applyImmutable } from '@earendil-works/chord/delta'
import type { StreamEvent } from '@familiar-ai/core/http'
import type { ConversationView } from '@earendil-works/pi-durable'
import type { StoreApi } from 'zustand/vanilla'
import type { FamiliarState, History } from './store.ts'
import { toTranscript } from './transcript.ts'
import type { createCommands } from './commands.ts'

type ConversationState = Pick<FamiliarState, 'view' | 'history' | 'transcript'>

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
  set: StoreApi<FamiliarState>['setState'],
  get: StoreApi<FamiliarState>['getState'],
  historyPage: ReturnType<typeof createCommands>['history'],
) => {
  let loading: Promise<boolean> | undefined
  const loadOlder = async () => {
    const state = get()
    const { history } = state
    if (history.status === 'start') {
      return false
    }
    const before = oldestOf(state)
    if (before === undefined) {
      return true
    }
    set({ history: { ...history, status: 'loading' } })
    try {
      const page = await historyPage(before)
      const current = get()
      // A reconnect left a gap, so history starts again from the new view.
      if (oldestOf(current) !== before) {
        set({ history: { ...current.history, status: 'more' } })
        return true
      }
      set(
        transition(current, current.view, {
          entries: [...page.entries.toReversed(), ...current.history.entries],
          status: page.more ? 'more' : 'start',
        }),
      )
      return page.more
    } catch (error) {
      set(({ history }) => ({
        history: { ...history, status: 'failed' },
      }))
      throw error
    }
  }

  const receive = (view: ConversationView | undefined) => {
    const state = get()
    return transition(state, view, carryOver(state.history, state.view, view))
  }
  return {
    loadOlder: () =>
      (loading ??= loadOlder().finally(() => (loading = undefined))),
    receive,
    apply: (ops: Extract<StreamEvent, { event: 'ops' }>['data']) =>
      receive(applyImmutable(get().view, ops)),
  }
}

/**
 * The oldest entry in a view. A view opens with its head marker, such as a
 * compaction summary, which is newer than the entry it heads.
 */
export const startOf = (view: ConversationView) =>
  view.entries[0] && (view.entries[0].head ?? view.entries[0].id)

const oldestOf = ({ view, history }: Pick<FamiliarState, 'view' | 'history'>) =>
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
