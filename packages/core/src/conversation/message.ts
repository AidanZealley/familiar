import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai'
import type { EntryRecord } from '@earendil-works/pi-durable'

/** The entry kind people's messages are stored as. */
export const MESSAGE_KIND = 'familiar.message'

export type MessageData = { author: string; text: string }

/** Who said what, for the entries people and the assistant wrote. */
export function saidBy(entry: EntryRecord) {
  const message = entry.model?.[0] as UserMessage | AssistantMessage | undefined
  if (!message) return undefined
  if (entry.kind === MESSAGE_KIND || entry.kind === 'pi.user') {
    const data = entry.data as Partial<MessageData> | undefined
    const content = (message as UserMessage).content
    const text =
      typeof content === 'string'
        ? content
        : content
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join('')
    return { who: data?.author || 'user', text, at: message.timestamp }
  }
  if (entry.kind === 'pi.assistant') {
    const text = (message as AssistantMessage).content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
    return text ? { who: 'you', text, at: message.timestamp } : undefined
  }
  return undefined
}
