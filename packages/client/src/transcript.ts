import type {
  AssistantMessage,
  Message,
  ToolCall as ModelToolCall,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
import type {
  TranscriptView,
  EntryRecord,
  ToolSlot,
} from '@earendil-works/pi-durable'
import type {
  Author,
  HANDOFF_KIND as CoreHandoffKind,
  HandoffData,
  MESSAGE_KIND as CoreMessageKind,
  ImageRef,
  Mention,
  NOTE_KIND as CoreNoteKind,
  NoteData,
  Question,
  REPLY_KIND as CoreReplyKind,
  ReplyData,
  RoomActivity,
  RoomMessageData,
  RoomScheduledData,
  SCHEDULED_KIND as CoreScheduledKind,
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

export type TranscriptGap = Extract<
  TranscriptView['items'][number],
  { kind: 'gap' }
>

/**
 * An image a message carries, or `unavailable` for one stored inline in the
 * message before images were stored apart, which is no longer shown.
 */
export type TranscriptImage = ImageRef | { unavailable: true }

/** Item IDs are unique across the transcript and stable across updates: use them as keys. */
export type TranscriptItem =
  | { type: 'gap'; id: string; gap: TranscriptGap }
  | {
      type: 'message'
      id: string
      author: Author
      /** Empty when it's images alone. */
      text: string
      /** Its images, in order. */
      images?: TranscriptImage[]
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
      /** Its name when it replied, if recorded. */
      name?: string
      text: string
      mentions?: Mention[]
      thinking: string
      toolCalls: ToolCall[]
      /** When it was written, in ms since the epoch. */
      at?: number
      /** Someone stopped it before it finished. */
      stopped: boolean
      /**
       * It chose to say nothing, with `stay_quiet`: shown only as that tool
       * call, so a client may leave it out.
       */
      quiet?: true
      /** Why it failed, or the model's error. */
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

/** A model request that failed and is tried again `at`, in ms since the epoch. */
export type Retrying = { at: number; error: string }

export type ReplyingFamiliar = {
  familiar: number
  /** Pending tool approvals and server questions, oldest first. */
  questions?: Question[]
  retrying?: Retrying
  /** Current tool activity, for clients that handle tool-specific actions. */
  tools?: ToolCall[]
}

export type Transcript = {
  items: TranscriptItem[]
  replying: ReplyingFamiliar[]
  /** A Familiar has a turn in progress here. */
  busy: boolean
  /** Entries exist before the first item, Pi's `earlier` marker. */
  earlier: boolean
}

/**
 * What a chat UI shows for a room: its assembled log and live activity.
 * Pi's TranscriptView supplies loaded history and missing ranges.
 */
export function toRoomTranscript(
  view: TranscriptView,
  turns: RoomActivity = {},
): Transcript {
  const rows = view.items
  const entries = rows.flatMap((row) =>
    row.kind === 'entry' ? [row.entry] : [],
  )
  const retryable = retryableIn(entries, turns)
  const replying: ReplyingFamiliar[] = []
  for (const turn of Object.values(turns)) {
    if (turn.status !== 'running') {
      continue
    }
    const retrying = turn.generation?.retry
    const tools = liveTools(turn.generation?.message, turn.tools)
    replying.push({
      familiar: turn.familiar,
      ...(turn.questions?.length && { questions: turn.questions }),
      ...(retrying && { retrying }),
      ...(tools.length && { tools }),
    })
  }
  const items: TranscriptItem[] = []
  for (const row of rows) {
    if (row.kind === 'entry') {
      items.push(...toItems(row.entry, retryable.has(row.entry.id)))
    } else if (row.kind === 'gap') {
      items.push({
        type: 'gap',
        id: `gap:${row.after}:${row.upTo}`,
        gap: row,
      })
    }
  }
  return {
    items,
    replying,
    busy: Object.keys(turns).length > 0,
    earlier: rows[0]?.kind === 'earlier',
  }
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

function toItems(entry: EntryRecord, retryable: boolean): TranscriptItem[] {
  const id = `entry:${entry.id}`
  switch (entry.kind) {
    case MESSAGE_KIND: {
      const { author, text, images, at, mentions } =
        entry.data as unknown as RoomMessageData
      return [
        {
          type: 'message',
          id,
          author,
          text,
          ...(images?.length && {
            images: images.map((image) =>
              image.id ? image : { unavailable: true as const },
            ),
          }),
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
  // Room routing records spans in the nonempty assistant texts joined by newlines.
  let offset = 0
  const items = reply.messages.flatMap((message: Message, index) => {
    if (message.role === 'toolResult') {
      settle(calls, message)
      return []
    }
    if (message.role !== 'assistant') {
      return []
    }
    const item = toReply(`${id}:${index}`, reply.familiar, message, calls)
    const mentions = reply.mentions
      ?.filter(
        ({ start, end }) => start >= offset && end <= offset + item.text.length,
      )
      .map((mention) => ({
        ...mention,
        start: mention.start - offset,
        end: mention.end - offset,
      }))
    if (item.text) {
      offset += item.text.length + 1
    }
    return [
      {
        ...item,
        ...(mentions?.length && { mentions }),
        name: reply.name,
        ...(reply.outcome === 'quiet' && { quiet: true as const }),
      },
    ]
  })
  const error =
    reply.outcome === 'failed' ? failureText(reply.failure) : undefined
  if (!error && (reply.outcome !== 'stopped' || items.length > 0)) {
    return items
  }
  const last = items.at(-1)
  // Says why on its last item, unless the model's own error already does.
  if (last?.type === 'reply') {
    last.error ??= error
    return items
  }
  // A stop or failure note can have no assistant messages.
  return [
    {
      type: 'reply',
      id,
      familiar: reply.familiar,
      name: reply.name,
      text: '',
      thinking: '',
      toolCalls: [],
      at: reply.at,
      stopped: reply.outcome === 'stopped',
      ...(error && { error }),
    },
  ]
}

/** Why a reply failed, in words, from the reason and detail Pi settled it with. */
function failureText(failure: ReplyData['failure']) {
  const detail = failure?.detail
  switch (failure?.reason) {
    case 'model_error':
      return detail ? `The model failed: ${detail}` : 'The model failed.'
    case 'no_model':
      return detail
        ? `No model to answer with: ${detail}`
        : 'No model to answer with.'
    case 'turn_limit':
      return detail
        ? `Stopped at its limit of ${detail}.`
        : 'Stopped at its turn limit.'
    case 'restart_limit':
      return 'Interrupted too many times to finish.'
    case 'interrupted':
      return 'Interrupted before it finished.'
    default:
      return 'The reply failed.'
  }
}

/** Match Pi's live tool slots to the current model's call arguments, when available. */
function liveTools(message?: AssistantMessage, slots?: readonly ToolSlot[]) {
  const calls = new Map<string, ToolCall>()
  for (const block of message?.content ?? []) {
    if (block.type === 'toolCall') {
      const { id, name, arguments: args } = block
      calls.set(id, {
        id,
        name,
        arguments: args,
        status: 'running',
        output: '',
      })
    }
  }
  for (const slot of slots ?? []) {
    calls.set(slot.callId, {
      id: slot.callId,
      name: slot.name,
      arguments: calls.get(slot.callId)?.arguments ?? {},
      status: slot.status === 'done' ? 'done' : 'running',
      output: slot.output ?? '',
      details: slot.details,
    })
  }
  return [...calls.values()]
}

function toReply(
  id: string,
  familiar: number,
  message: AssistantMessage,
  calls: Map<string, ToolCall>,
): Extract<TranscriptItem, { type: 'reply' }> {
  const textBlocks: string[] = []
  let thinking = ''
  const toolCalls: ToolCall[] = []
  for (const block of message.content) {
    if (block.type === 'text') {
      textBlocks.push(block.text)
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
    text: textBlocks.join('\n'),
    thinking,
    toolCalls,
    at: message.timestamp,
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
