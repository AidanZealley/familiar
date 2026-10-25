import { Type } from '@earendil-works/pi-ai'
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai'
import {
  defineExtension,
  defineTool,
  type Conversation,
  type EntryRecord,
} from '@earendil-works/pi-durable'

const MAX_RESULTS = 10
const EXCERPT = 400

/**
 * Search everything ever said in a conversation, including what compaction
 * has since summarised away: the model only sees recent messages, but storage
 * keeps them all. Needs the conversation, so a host creates it after opening.
 */
export const createHistoryExtension = (conversation: Conversation) =>
  defineExtension({
    name: 'familiar.history',
    tools: [
      defineTool({
        name: 'search_history',
        description:
          'Search all earlier messages in this conversation, including ones too old for you to see, for when someone refers to something said before. Matches messages containing every word of the query.',
        parameters: Type.Object({ query: Type.String() }),
        replay: 'safe',
        execute: async ({ query }, _api, context) => {
          const words = query.toLowerCase().split(/\s+/).filter(Boolean)
          const matches: string[] = []
          let cursor: Parameters<Conversation['entries']>[2]
          do {
            const page = await conversation.entries({}, 200, cursor, context)
            for (const entry of page.items) {
              const said = saidBy(entry)
              const text = said?.text.toLowerCase()
              if (said && text && words.every((word) => text.includes(word)))
                matches.push(
                  `[${new Date(said.at).toISOString().slice(0, 16)}] ${said.who}: ${said.text.slice(0, EXCERPT)}`,
                )
              if (matches.length === MAX_RESULTS) break
            }
            cursor = page.next
          } while (cursor && matches.length < MAX_RESULTS)

          return {
            output: [
              {
                type: 'text',
                text: matches.length
                  ? `Newest first:\n${matches.join('\n')}`
                  : 'Nothing found.',
              },
            ],
          }
        },
      }),
    ],
  })

/** Who said what, for the entries people and the assistant wrote. */
export function saidBy(entry: EntryRecord) {
  const message = entry.model?.[0] as UserMessage | AssistantMessage | undefined
  if (!message) return undefined
  if (entry.kind === 'familiar.message' || entry.kind === 'pi.user') {
    const data = entry.data as { author?: string } | undefined
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
