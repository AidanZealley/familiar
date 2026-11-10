import type {
  AssistantMessage,
  Message,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxProvider,
  type RegisterFauxProviderOptions,
} from '@earendil-works/pi-ai/providers/faux'
import {
  readMessage,
  textOf,
  type MessageData,
} from '../conversation/message.ts'
import { readHandoff } from '../rooms/log.ts'
import { SCHEDULED_PREFIX } from '../schedules/task.ts'

type Said = Pick<MessageData, 'author' | 'text'>

/** A person's message, after the people's earlier messages in this request. */
export type ScriptedMessage = { type: 'message'; earlier: Said[] } & Said

/** What a scripted model is asked, read from the request Familiar sends. */
export type ScriptedRequest = { context: TranscriptContext } & (
  | ScriptedMessage
  /** A tool the script called has returned. */
  | { type: 'tool-result'; name: string; output: string; isError: boolean }
  /** A schedule's prompt has come due. */
  | { type: 'scheduled' }
  /** Another Familiar handed this on, by name, with a note. */
  | { type: 'handoff'; from: string; note: string }
  /** Work nobody is waiting on, such as compaction or memory upkeep. */
  | { type: 'background' }
)

/**
 * The input itself: a room's input carries what the Familiar was shown from
 * the room first, as an earlier part (see rooms/turn.ts), so it's the last.
 */
const inputText = (message: Message) =>
  typeof message.content === 'string'
    ? message.content
    : (message.content.findLast((part) => part.type === 'text')?.text ?? '')

/**
 * Reads the input a request answers: its newest person's message, schedule,
 * handoff or tool result. Anything after it, such as a recall note or a plugin's note, is
 * context for that input. Compaction and upkeep carry no person's message or
 * schedule, so they read as background unless the script called a tool there.
 */
function readRequest(context: TranscriptContext): ScriptedRequest {
  const { messages } = context
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'toolResult') {
      return {
        type: 'tool-result',
        name: message.toolName,
        output: textOf(message),
        isError: message.isError,
        context,
      }
    }
    if (message.role !== 'user') {
      continue
    }
    const text = inputText(message)
    if (text.startsWith(SCHEDULED_PREFIX)) {
      return { type: 'scheduled', context }
    }
    const handoff = readHandoff(text)
    if (handoff) {
      return { type: 'handoff', ...handoff, context }
    }
    const said = readMessage(text)
    if (said) {
      const earlier = messages
        .slice(0, index)
        .flatMap((other) =>
          other.role === 'user' ? (readMessage(inputText(other)) ?? []) : [],
        )
      return { type: 'message', ...said, earlier, context }
    }
  }
  return { type: 'background', context }
}

/**
 * Models that answer every request with `respond`, for demos and tests.
 * Familiar's requests arrive already read, so a script depends on what was
 * asked rather than on Familiar's prompts. `options` go to the faux provider,
 * such as its models and how fast replies stream.
 */
export function scriptedModels(
  respond: (
    request: ScriptedRequest,
    /** Aborted when the request is, such as when its run is stopped. */
    signal?: AbortSignal,
  ) => AssistantMessage | Promise<AssistantMessage>,
  options?: RegisterFauxProviderOptions,
) {
  const faux = fauxProvider(options)
  // The provider answers from a queue, so each answer queues the next.
  const step = (
    context: TranscriptContext,
    options?: { signal?: AbortSignal },
  ) => {
    faux.appendResponses([step])
    return respond(readRequest(context), options?.signal)
  }
  faux.setResponses([step])
  const models = createModels()
  models.setProvider(faux.provider)
  return models
}
