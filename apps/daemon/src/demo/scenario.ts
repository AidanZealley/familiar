import type {
  AssistantMessage,
  TranscriptContext,
} from '@familiar-ai/core/models'

/** A scripted model response and any replies to the tools it calls. */
export type Scenario = {
  start(): AssistantMessage | Promise<AssistantMessage>
  replies?: Record<
    string,
    (
      output: string,
      context: TranscriptContext,
    ) => AssistantMessage | Promise<AssistantMessage>
  >
}

/** The demo's own time zone, so its sample dates and reminders don't depend on the machine's. */
export const DEMO_TIME_ZONE = 'Europe/London'

/** The text of a message's content, ignoring anything that isn't text. */
export const textOf = (content: string | readonly object[] | undefined) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .map((part) => ('text' in part ? String(part.text) : ''))
        .join('')
