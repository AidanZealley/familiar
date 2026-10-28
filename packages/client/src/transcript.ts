import type {
  AssistantMessage,
  ToolCall as ModelToolCall,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
import type {
  ConversationView,
  EntryRecord,
  InboxState,
  LiveState,
} from '@earendil-works/pi-durable'
import type { MessageData, SavedDetails } from '@familiar/core/http'

import { MESSAGE_KIND } from './conversation/message.ts'

export type ToolCall = {
  id: string
  name: string
  arguments: ModelToolCall['arguments']
  status: 'running' | 'done' | 'error'
  output: string
  /** The fact this call saved, when it was a memory tool that saved one. */
  saved?: string
}

/** Item IDs are unique across the transcript and stable across updates: use them as keys. */
export type TranscriptItem =
  | {
      type: 'message'
      id: string
      author: string
      text: string
      /** When it was sent, in ms since the epoch; absent while queued. */
      at?: number
      /** Sent while busy; waiting for the current run to reach a boundary. */
      queued: boolean
    }
  | {
      type: 'reply'
      id: string
      text: string
      thinking: string
      toolCalls: ToolCall[]
      /** IDs of the facts its tool calls saved, new or revised. */
      saved: string[]
      /** When it was generated, in ms since the epoch. */
      at: number
      /** Still being generated. */
      streaming: boolean
      /** Someone stopped it before it finished. */
      stopped: boolean
      error?: string
    }
  /** Older messages were summarised; they stay in storage but the model sees the summary. */
  | { type: 'compaction'; id: string }

export type Transcript = {
  items: TranscriptItem[]
  /** A run is working on a message. */
  busy: boolean
}

/**
 * What a chat UI shows for a conversation view, after any `history` loaded
 * before it (oldest first). Pure, so any client can reuse it.
 */
export function toTranscript(
  view: ConversationView,
  history: readonly EntryRecord[] = [],
): Transcript {
  const live = view.docs['pi.live'] as LiveState | undefined
  const inbox = view.docs['pi.inbox'] as InboxState | undefined

  const items: TranscriptItem[] = []
  const calls = new Map<string, ToolCall>()
  const entries = [...history, ...view.entries]

  // A compaction is committed after the entries it keeps, and a view starts
  // with it, but it shows where its summary ends: before the first entry it
  // kept, so everything above it is what was summarised.
  const compactions = new Map<EntryRecord['id'], EntryRecord>()
  for (const entry of entries) {
    if (entry.kind === 'pi.compaction' && entry.head !== undefined) {
      compactions.set(entry.head, entry)
    }
  }

  for (const entry of entries) {
    const compaction = compactions.get(entry.id)
    if (compaction) {
      items.push({ type: 'compaction', id: `entry:${compaction.id}` })
    }
    if (entry.kind === 'pi.compaction') {
      continue
    }
    const item = toItem(entry, calls)
    if (item) {
      items.push(item)
    }
  }

  // Tool calls of the current round, already in the transcript, now running.
  for (const slot of live?.tools ?? []) {
    const call = calls.get(slot.callId)
    if (call && slot.status !== 'done') {
      call.status = 'running'
      call.output = slot.output ?? ''
    }
  }

  const partial = live?.generation?.message as AssistantMessage | undefined
  if (partial) {
    items.push({ ...toReply('streaming', partial, calls), streaming: true })
  }

  for (const item of inbox?.items ?? []) {
    if (item.mode === 'write' || item.entry?.kind !== MESSAGE_KIND) {
      continue
    }
    const data = item.entry.data as MessageData
    items.push({
      type: 'message',
      id: `queued:${item.id}`,
      ...data,
      queued: true,
    })
  }

  // Tool results arrive after their call, so what a reply saved is known
  // only once every entry has been read.
  for (const item of items) {
    if (item.type === 'reply') {
      item.saved = savedBy(item.toolCalls)
    }
  }

  return { items, busy: live?.run !== undefined }
}

const savedBy = (calls: ToolCall[]) =>
  calls.flatMap((call) => (call.saved ? [call.saved] : []))

function toItem(
  entry: EntryRecord,
  calls: Map<string, ToolCall>,
): TranscriptItem | undefined {
  const id = `entry:${entry.id}`
  switch (entry.kind) {
    case MESSAGE_KIND: {
      const data = entry.data as MessageData
      const message = entry.model?.[0] as UserMessage | undefined
      return {
        type: 'message',
        id,
        ...data,
        at: message?.timestamp,
        queued: false,
      }
    }
    case 'pi.user': {
      // Input submitted without an author, e.g. by a host directly.
      const message = entry.model?.[0] as UserMessage
      return {
        type: 'message',
        id,
        author: '',
        text: textOf(message.content),
        at: message.timestamp,
        queued: false,
      }
    }
    case 'pi.assistant':
      return toReply(id, entry.model?.[0] as AssistantMessage, calls)
    case 'pi.tool-result': {
      const result = entry.model?.[0] as ToolResultMessage
      const call = calls.get(result.toolCallId)
      if (call) {
        call.status = result.isError ? 'error' : 'done'
        call.output = textOf(result.content)
        const details = result.details as Partial<SavedDetails> | undefined
        if (typeof details?.saved === 'string') {
          call.saved = details.saved
        }
      }
      return undefined
    }
    default:
      return undefined
  }
}

function toReply(
  id: string,
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
    text,
    thinking,
    toolCalls,
    saved: [],
    at: message.timestamp,
    streaming: false,
    stopped: message.stopReason === 'aborted',
    error: message.stopReason === 'error' ? message.errorMessage : undefined,
  }
}

const textOf = (content: UserMessage['content']) =>
  typeof content === 'string'
    ? content
    : content.map((part) => (part.type === 'text' ? part.text : '')).join('')
