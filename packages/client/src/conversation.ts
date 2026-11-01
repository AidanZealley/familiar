import { applyImmutable } from '@earendil-works/chord/delta'
import type { StreamEvent } from '@familiar-ai/core/http'
import type { ConversationView } from '@earendil-works/pi-durable'
import type { StoreApi } from 'zustand/vanilla'
import type { FamiliarState, History } from './store.ts'
import { toTranscript } from './transcript.ts'

export type FetchHistory = (
  before: number,
) => Promise<{ entries: History['entries']; more: boolean }>

type ConversationState = Pick<FamiliarState, 'conversation' | 'transcript'>

const transition = (
  previous: ConversationState,
  view: ConversationView | undefined,
  history: History,
): ConversationState => ({
  conversation:
    view === previous.conversation.view &&
    history === previous.conversation.history
      ? previous.conversation
      : { ...previous.conversation, view, history },
  transcript:
    view === previous.conversation.view &&
    history.entries === previous.conversation.history.entries
      ? previous.transcript
      : view && toTranscript(view, history.entries),
})

export const createConversation = (
  set: StoreApi<FamiliarState>['setState'],
  get: StoreApi<FamiliarState>['getState'],
  historyPage: FetchHistory,
) => {
  let loading: Promise<boolean> | undefined
  const loadOlder = async () => {
    const state = get()
    const { history } = state.conversation
    if (history.status === 'start') {
      return false
    }
    const before = oldestOf(state)
    if (before === undefined) {
      return true
    }
    set({
      conversation: {
        ...state.conversation,
        history: { ...history, status: 'loading' },
      },
    })
    try {
      const page = await historyPage(before)
      const current = get()
      // A reconnect left a gap, so history starts again from the new view.
      if (oldestOf(current) !== before) {
        set({
          conversation: {
            ...current.conversation,
            history: { ...current.conversation.history, status: 'more' },
          },
        })
        return true
      }
      set(
        transition(current, current.conversation.view, {
          entries: [
            ...page.entries.toReversed(),
            ...current.conversation.history.entries,
          ],
          status: page.more ? 'more' : 'start',
        }),
      )
      return page.more
    } catch (error) {
      set(({ conversation }) => ({
        conversation: {
          ...conversation,
          history: { ...conversation.history, status: 'failed' },
        },
      }))
      throw error
    }
  }

  const receive = (view: ConversationView | undefined) => {
    const state = get()
    return transition(
      state,
      view,
      carryOver(state.conversation.history, state.conversation.view, view),
    )
  }
  return {
    loadOlder: () =>
      (loading ??= loadOlder().finally(() => (loading = undefined))),
    receive,
    apply: (ops: Extract<StreamEvent, { event: 'ops' }>['data']) =>
      receive(applyImmutable(get().conversation.view, ops)),
  }
}

/**
 * The oldest entry in a view. A view opens with its head marker, such as a
 * compaction summary, which is newer than the entry it heads.
 */
export const startOf = (view: ConversationView) =>
  view.entries[0] && (view.entries[0].head ?? view.entries[0].id)

const oldestOf = ({
  conversation: { view, history },
}: Pick<FamiliarState, 'conversation'>) =>
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
