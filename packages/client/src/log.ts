import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { applyImmutable } from '@earendil-works/chord/delta'
import {
  ConversationTranscript,
  type ConversationView,
  type TranscriptView,
} from '@earendil-works/pi-durable'
import type { RoomActivity, StreamEvent } from '@familiar-ai/core/http'
import type { StoreApi } from 'zustand/vanilla'
import type { FetchEntries } from './commands.ts'
import { toRoomTranscript, type Transcript } from './transcript.ts'

/** Fetch status for the earlier-message control. Pi owns the loaded entries. */
export type History = { status: 'more' | 'loading' | 'failed' | 'start' }

export type LogState = {
  view: ConversationView | undefined
  history: History
  turns: RoomActivity | null | undefined
  transcript: Transcript | undefined
}

/** Pi owns entry merging, pagination and gaps; Familiar adds room presentation. */
export const createLog = (
  set: StoreApi<LogState>['setState'],
  get: StoreApi<LogState>['getState'],
  entries: FetchEntries,
) => {
  const transcript = new ConversationTranscript((query, limit) =>
    entries(query, limit),
  )
  let merged: TranscriptView | undefined
  let rendered:
    | {
        view: TranscriptView | undefined
        turns: LogState['turns']
        transcript: Transcript | undefined
      }
    | undefined

  const render = (
    view: TranscriptView | undefined,
    turns: LogState['turns'],
  ) => {
    if (!rendered || view !== rendered.view || turns !== rendered.turns) {
      rendered = {
        view,
        turns,
        transcript: view && toRoomTranscript(view, turns ?? {}),
      }
    }
    return rendered.transcript
  }
  const status = (): History['status'] =>
    merged?.items[0]?.kind === 'earlier' ? 'more' : 'start'

  const show = (view: TranscriptView) => {
    merged = view
    return { transcript: render(view, get().turns) }
  }

  const loadOlder = async () => {
    if (!merged || get().history.status === 'loading' || status() === 'start') {
      return
    }
    set({ history: { status: 'loading' } })
    try {
      const shown = show(await transcript.loadEarlier(BACKGROUND_CONTEXT))
      set({ ...shown, history: { status: status() } })
    } catch {
      set({ history: { status: 'failed' } })
    }
  }

  const receive = (view: ConversationView | undefined) => {
    merged = view && transcript.merge(view)
    return {
      view,
      history:
        get().history.status === 'loading'
          ? get().history
          : { status: status() },
      transcript: render(merged, get().turns),
    }
  }

  return {
    loadOlder,
    loadGap: async (after: number, upTo: number) => {
      const gap = merged?.items.find(
        (item) =>
          item.kind === 'gap' && item.after === after && item.upTo === upTo,
      )
      if (gap?.kind === 'gap') {
        set(show(await transcript.fillGap(gap, BACKGROUND_CONTEXT)))
      }
    },
    receive,
    apply: (ops: Extract<StreamEvent, { event: 'ops' }>['data']) =>
      receive(applyImmutable(get().view, ops)),
    turns: (turns: LogState['turns']) => ({
      turns,
      transcript: render(merged, turns),
    }),
  }
}
