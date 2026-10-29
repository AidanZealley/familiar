import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai'

/** A scripted model response and any replies to the tools it calls. */
export type Scenario = {
  start(): AssistantMessage
  replies?: Record<
    string,
    (output: string, context: TranscriptContext) => AssistantMessage
  >
}
