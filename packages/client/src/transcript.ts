import type {
  AssistantMessage,
  Message,
  ToolCall as ModelToolCall,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
import type {
  ConversationView,
  EntryRecord,
  ToolSlot,
} from '@earendil-works/pi-durable'
import type {
  Author,
  HANDOFF_KIND as CoreHandoffKind,
  HandoffData,
  MESSAGE_KIND as CoreMessageKind,
  Mention,
  NOTE_KIND as CoreNoteKind,
  NoteData,
  REPLY_KIND as CoreReplyKind,
  ReplyData,
  RoomActivity,
  RoomMessageData,
  RoomScheduledData,
  SCHEDULED_KIND as CoreScheduledKind,
  TurnActivity,
} from '@familiar-ai/core/http'

// Core's entry kinds, typed against it without loading its runtime.
export const MESSAGE_KIND: typeof CoreMessageKind = 'familiar.message'
export const REPLY_KIND: typeof CoreReplyKind = 'familiar.reply'
const SCHEDULED_KIND: typeof CoreScheduledKind = 'familiar.scheduled'
export const HANDOFF_KIND: typeof CoreHandoffKind = 'familiar.handoff'
export const NOTE_KIND: typeof CoreNoteKind = 'familiar.note'

export type ToolCall = {
  id: string
  name: string
  /** What it was called with; empty for one still running in an unfinished reply. */
  arguments: ModelToolCall['arguments']
  status: 'running' | 'done' | 'error'
  output: string
  /** Persisted tool data. Hosts narrow it before rendering. */
  details?: unknown
}

/** Item IDs are unique across the transcript and stable across updates: use them as keys. */
export type TranscriptItem =
  | {
      type: 'message'
      id: string
      author: Author
      text: string
      /** When it was posted, in ms since the epoch. */
      at: number
      /** Whom it addresses, by span of the text. */
      mentions?: Mention[]
    }
  | {
      type: 'reply'
      id: string
      /** The Familiar replying. */
      familiar: number
      /** Its name when it replied; absent while it's still replying. */
      name?: string
      text: string
      thinking: string
      toolCalls: ToolCall[]
      /** When it was generated, in ms since the epoch; absent before it starts. */
      at?: number
      /** Still being generated. */
      streaming: boolean
      /** Someone stopped it before it finished. */
      stopped: boolean
      /**
       * It chose to say nothing, with `stay_quiet`: shown only as that tool
       * call, so a client may leave it out.
       */
      quiet?: true
      error?: string
      /**
       * A failed reply's entry ID, which a room's `retry` tries again: on
       * its last item only, while it's its Familiar's newest reply to what
       * it answered and no turn for that is under way.
       */
      retry?: number
    }
  /** A Familiar asking another in the room to take a turn. A reply follows it. */
  | {
      type: 'handoff'
      id: string
      /** The Familiars asking and asked. */
      from: number
      to: number
      note: string
      /** When it was posted, in ms since the epoch. */
      at: number
    }
  /** A host's note: context for the room's Familiars, which no one replies to. */
  | {
      type: 'note'
      id: string
      text: string
      /** When it was posted, in ms since the epoch. */
      at: number
    }
  /** A schedule's prompt, arriving now that it's due. A reply follows it. */
  | {
      type: 'scheduled'
      id: string
      /** The Familiar whose schedule it is. */
      familiar: number
      prompt: string
      creator?: Author
      /** The time it was scheduled for, in ms since the epoch. */
      due: number
    }
  /**
   * A Familiar has a turn here with nothing to show yet: `queued` behind
   * work in this room, `elsewhere` while it works in another room, or
   * `running` before its reply starts.
   */
  | {
      type: 'waiting'
      id: string
      familiar: number
      status: TurnActivity['status']
    }

export type Transcript = {
  items: TranscriptItem[]
  /** A Familiar has a turn in progress here. */
  busy: boolean
}

/**
 * What a chat UI shows for a room: its log, after any `history` loaded
 * before it (oldest first), then each turn in progress, from `turns`.
 * Pure, so any client can reuse it.
 */
export function toRoomTranscript(
  view: ConversationView,
  history: readonly EntryRecord[] = [],
  turns: RoomActivity = {},
): Transcript {
  const entries = [...history, ...view.entries]
  const retryable = retryableIn(entries, turns)
  const items: TranscriptItem[] = []
  for (const entry of entries) {
    items.push(...toItems(entry, retryable.has(entry.id)))
  }
  for (const [task, turn] of Object.entries(turns)) {
    items.push(toActive(task, turn))
  }
  return { items, busy: Object.keys(turns).length > 0 }
}

/**
 * The failed replies a person can try again: each Familiar's newest reply
 * to an entry, if it failed and no turn for that entry is under way.
 */
function retryableIn(entries: readonly EntryRecord[], turns: RoomActivity) {
  const newest = new Map<string, EntryRecord>()
  for (const entry of entries) {
    if (entry.kind === REPLY_KIND) {
      const { familiar, cause } = entry.data as unknown as ReplyData
      newest.set(`${familiar}:${cause}`, entry)
    }
  }
  for (const { familiar, cause } of Object.values(turns)) {
    newest.delete(`${familiar}:${cause}`)
  }
  return new Set(
    [...newest.values()]
      .filter(
        (entry) => (entry.data as unknown as ReplyData).outcome === 'failed',
      )
      .map((entry) => entry.id),
  )
}

function toItems(entry: EntryRecord, retryable = false): TranscriptItem[] {
  const id = `entry:${entry.id}`
  switch (entry.kind) {
    case MESSAGE_KIND: {
      const { author, text, at, mentions } =
        entry.data as unknown as RoomMessageData
      return [
        {
          type: 'message',
          id,
          author,
          text,
          at,
          ...(mentions && { mentions }),
        },
      ]
    }
    case SCHEDULED_KIND: {
      const { familiar, prompt, due, creator } =
        entry.data as unknown as RoomScheduledData
      return [
        {
          type: 'scheduled',
          id,
          familiar,
          prompt,
          due,
          ...(creator && { creator }),
        },
      ]
    }
    case HANDOFF_KIND: {
      const { from, to, note, at } = entry.data as unknown as HandoffData
      return [{ type: 'handoff', id, from, to, note, at }]
    }
    case NOTE_KIND: {
      const { text, at } = entry.data as unknown as NoteData
      return [{ type: 'note', id, text, at }]
    }
    case REPLY_KIND: {
      const items = toReplies(id, entry.data as unknown as ReplyData)
      const last = items.at(-1)
      if (retryable && last?.type === 'reply') {
        last.retry = entry.id
      }
      return items
    }
    default:
      return []
  }
}

/** A copied reply: an item per message the Familiar wrote, with its tools' results. */
function toReplies(id: string, reply: ReplyData): TranscriptItem[] {
  const calls = new Map<string, ToolCall>()
  const items = reply.messages.flatMap((message: Message, index) => {
    if (message.role === 'toolResult') {
      settle(calls, message)
      return []
    }
    if (message.role !== 'assistant') {
      return []
    }
    return [
      {
        ...toReply(`${id}:${index}`, reply.familiar, message, calls),
        name: reply.name,
        ...(reply.outcome === 'quiet' && { quiet: true as const }),
      },
    ]
  })
  // A run that failed before saying anything still shows that it failed.
  if (!items.length && reply.outcome === 'failed') {
    return [
      {
        type: 'reply',
        id,
        familiar: reply.familiar,
        name: reply.name,
        text: '',
        thinking: '',
        toolCalls: [],
        streaming: false,
        stopped: false,
        error: 'The reply failed.',
      },
    ]
  }
  return items
}

/** A turn in progress: its reply so far, or what it's waiting for. */
function toActive(task: string, turn: TurnActivity): TranscriptItem {
  const id = `turn:${task}`
  if (turn.status !== 'running' || (!turn.generation?.message && !turn.tools)) {
    return { type: 'waiting', id, familiar: turn.familiar, status: turn.status }
  }
  const calls = new Map<string, ToolCall>()
  const partial = turn.generation?.message as AssistantMessage | undefined
  const reply: Extract<TranscriptItem, { type: 'reply' }> = partial
    ? toReply(id, turn.familiar, partial, calls)
    : {
        type: 'reply',
        id,
        familiar: turn.familiar,
        text: '',
        thinking: '',
        toolCalls: [],
        streaming: true,
        stopped: false,
      }
  // The round's tools, whose calls an earlier message of the run made.
  for (const slot of (turn.tools ?? []) as ToolSlot[]) {
    let call = calls.get(slot.callId)
    if (!call) {
      call = {
        id: slot.callId,
        name: slot.name,
        arguments: {},
        status: 'running',
        output: '',
      }
      reply.toolCalls.push(call)
    }
    call.status = slot.status === 'done' ? 'done' : 'running'
    call.output = slot.output ?? ''
    call.details = slot.details
  }
  return { ...reply, streaming: true }
}

function toReply(
  id: string,
  familiar: number,
  message: AssistantMessage,
  calls: Map<string, ToolCall>,
): Extract<TranscriptItem, { type: 'reply' }> {
  let text = ''
  let thinking = ''
  const toolCalls: ToolCall[] = []
  for (const block of message.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'thinking') {
      thinking += block.thinking
    } else {
      const call: ToolCall = {
        id: block.id,
        name: block.name,
        arguments: block.arguments,
        status: 'running',
        output: '',
      }
      calls.set(call.id, call)
      toolCalls.push(call)
    }
  }
  return {
    type: 'reply',
    id,
    familiar,
    text,
    thinking,
    toolCalls,
    at: message.timestamp,
    streaming: false,
    stopped: message.stopReason === 'aborted',
    ...(message.stopReason === 'error' && { error: message.errorMessage }),
  }
}

/** Marks the call `result` answers with its outcome. */
function settle(calls: Map<string, ToolCall>, result: ToolResultMessage) {
  const call = calls.get(result.toolCallId)
  if (call) {
    call.status = result.isError ? 'error' : 'done'
    call.output = textOf(result.content)
    call.details = result.details
  }
}

const textOf = (content: UserMessage['content']) =>
  typeof content === 'string'
    ? content
    : content.map((part) => (part.type === 'text' ? part.text : '')).join('')
