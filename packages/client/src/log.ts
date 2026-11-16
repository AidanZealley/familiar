import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { applyImmutable } from '@earendil-works/chord/delta'
import {
  ConversationTranscript,
  type ConversationView,
  type TranscriptView,
} from '@earendil-works/pi-durable'
import type { RoomActivity, StreamEvent } from '@familiar-ai/core/http'
import type { StoreApi } from 'zustand/vanilla'
import type { FetchHistory } from './commands.ts'
import {
  toRoomTranscript,
  type Transcript,
  type TranscriptGap,
} from './transcript.ts'

/** Loading the entries before the transcript's start. */
export type History = { status: 'more' | 'loading' | 'failed' | 'start' }

/** The room store's log fields, which this module owns. */
export type LogState = {
  /** The room log's view: Pi's window of its newest entries. */
  view: ConversationView | undefined
  history: History
  /** The room's turns in progress, live. */
  turns: RoomActivity | null | undefined
  /** Every entry loaded, then the turns; unchanged by unrelated updates. */
  transcript: Transcript | undefined
}

/**
 * Pi's ConversationTranscript holds every entry the room has shown or
 * loaded, and the gaps between; the log adds the room's turns and the status
 * of loading earlier entries.
 */
export const createLog = (
  set: StoreApi<LogState>['setState'],
  get: StoreApi<LogState>['getState'],
  history: FetchHistory,
) => {
  const transcript = new ConversationTranscript(history)
  // Pi's newest view of the transcript, the same object while nothing changes.
  let merged: TranscriptView | undefined

  /** The transcript for `view` and `turns`, derived only when either changes. */
  const show = (view: TranscriptView | undefined, turns = get().turns) => {
    const unchanged = view === merged && turns === get().turns
    merged = view
    return {
      turns,
      transcript: unchanged
        ? get().transcript
        : view && toRoomTranscript(view, turns ?? {}),
    }
  }
  const reach = (): History => ({
    status: merged?.items[0]?.kind === 'earlier' ? 'more' : 'start',
  })

  /** Loads the page before the transcript's start; `history` owns its progress and failure. */
  const loadOlder = async () => {
    const { status } = get().history
    if (!merged || status === 'loading' || status === 'start') {
      return
    }
    set({ history: { status: 'loading' } })
    try {
      const shown = show(await transcript.loadEarlier(BACKGROUND_CONTEXT))
      set({ ...shown, history: reach() })
    } catch {
      set({ history: { status: 'failed' } })
    }
  }

  const receive = (view: ConversationView | undefined) => {
    const shown = show(view && transcript.merge(view))
    const { status } = get().history
    return {
      view,
      ...shown,
      // A load keeps its status until it settles, and a failure until retried.
      history:
        status === 'loading' || status === 'failed' ? get().history : reach(),
    }
  }

  return {
    loadOlder,
    /** Loads the next page of `gap`; rejects if that fails. */
    loadGap: async (gap: TranscriptGap) =>
      set(show(await transcript.fillGap(gap, BACKGROUND_CONTEXT))),
    receive,
    apply: (ops: Extract<StreamEvent, { event: 'ops' }>['data']) =>
      receive(applyImmutable(get().view, ops)),
    turns: (turns: LogState['turns']) => show(merged, turns),
  }
}
