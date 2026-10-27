import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  ROOT_CONVERSATION_ID,
  type EntryId,
  type Tx,
} from '@earendil-works/pi-durable'
import { saidBy } from '../../conversation/message.ts'
import { localMinute } from '../../time/index.ts'
import { upkeepDay } from './schedule.ts'

/**
 * The messages since `through`, oldest first, keeping the newest that fit in
 * `budget` tokens, and the newest entry among them.
 */
export async function newMessages(
  tx: Tx,
  through: EntryId | null,
  budget: number,
  name: string,
) {
  const lines: string[] = []
  let newest: EntryId | undefined
  let tokens = 0
  // People's messages date the span; model replies carry wall-clock times,
  // not the Harness clock, so they date it only when nobody else spoke.
  const people = { first: Infinity, last: -Infinity }
  const replies = { first: Infinity, last: -Infinity }
  const note = (said: { who: string; at: number }) => {
    const span = said.who === 'you' ? replies : people
    span.first = Math.min(span.first, said.at)
    span.last = Math.max(span.last, said.at)
  }
  let cursor: Parameters<Tx['scanEntries']>[2]
  scan: do {
    const page = await tx.scanEntries(
      {
        conversationId: ROOT_CONVERSATION_ID,
        order: 'descending',
        ...(through === null ? {} : { minEntryId: (through + 1) as EntryId }),
      },
      200,
      cursor,
    )
    for (const entry of page.items) {
      const said = saidBy(entry)
      if (!said) continue
      const who = said.who === 'you' ? name : said.who
      const line = `[${localMinute(said.at)}] ${who}: ${said.text}`
      const size = estimateTextTokens(line)
      if (tokens + size > budget) {
        // A single message larger than the budget is cut, not skipped forever.
        if (!lines.length) {
          lines.push(line.slice(0, budget * 3))
          note(said)
        }
        newest ??= entry.id
        break scan
      }
      newest ??= entry.id
      lines.push(line)
      tokens += size
      note(said)
    }
    cursor = page.next
  } while (cursor)
  return newest === undefined
    ? undefined
    : {
        newest,
        transcript: lines.reverse().join('\n'),
        start: upkeepDay(
          Number.isFinite(people.first) ? people.first : replies.first,
        ),
        end: upkeepDay(
          Number.isFinite(people.last) ? people.last : replies.last,
        ),
      }
}
