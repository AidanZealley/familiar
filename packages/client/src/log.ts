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

/** The room store's log fields, which this module owns. */
export type LogState = {
  /** The room log's view: Pi's window of its newest entries. */
  view: ConversationView | undefined
  /** The room's turns in progress, live. */
  turns: RoomActivity | null | undefined
  /** Every entry loaded, then the turns; unchanged by unrelated updates. */
  transcript: Transcript | undefined
}

/**
 * Pi's ConversationTranscript holds every entry the room has shown or
 * loaded, the gaps between and whether earlier entries exist; the log adds
 * the room's turns. Loads reject on failure, so whoever shows a load shows
 * its progress and failure.
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

  const receive = (view: ConversationView | undefined) => ({
    view,
    ...show(view && transcript.merge(view)),
  })

  return {
    receive,
    apply: (ops: Extract<StreamEvent, { event: 'ops' }>['data']) =>
      receive(applyImmutable(get().view, ops)),
    turns: (turns: LogState['turns']) => show(merged, turns),
    /** Where a new watch continues the transcript: Pi's `resume` window. */
    resume: () => transcript.resume,
    // Pi shares concurrent loads of the same page, so callers needn't guard.
    // A load's own result can be older than a view merged as it settled, so
    // the transcript comes from merging the newest view again.
    loadOlder: async () => {
      await transcript.loadEarlier(BACKGROUND_CONTEXT)
      set(receive(get().view))
    },
    loadGap: async (gap: TranscriptGap) => {
      await transcript.fillGap(gap, BACKGROUND_CONTEXT)
      set(receive(get().view))
    },
  }
}
