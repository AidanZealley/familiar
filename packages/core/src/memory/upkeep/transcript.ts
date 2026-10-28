import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  ROOT_CONVERSATION_ID,
  type Cursor,
  type EntryId,
  type Tx,
} from '@earendil-works/pi-durable'
import { saidBy, type Said } from '../../conversation/message.ts'
import { localMinute } from '../../time/index.ts'
import { upkeepDay } from './schedule.ts'

/** The main conversation's entries after `through`, newest first. */
async function* entriesAfter(tx: Tx, through: EntryId | null) {
  let cursor: Cursor | undefined

  do {
    const page = await tx.scanEntries(
      {
        conversationId: ROOT_CONVERSATION_ID,
        order: 'descending',
        ...(through !== null && { minEntryId: (through + 1) as EntryId }),
      },
      200,
      cursor,
    )
    yield* page.items
    cursor = page.next
  } while (cursor)
}

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

  // People's messages date the span. Model replies carry wall-clock times, not
  // the Harness clock, so they date it only when nobody else spoke.
  const people = { first: Infinity, last: -Infinity }
  const replies = { first: Infinity, last: -Infinity }

  const note = (said: Said) => {
    const span = said.role === 'assistant' ? replies : people
    span.first = Math.min(span.first, said.at)
    span.last = Math.max(span.last, said.at)
  }

  for await (const entry of entriesAfter(tx, through)) {
    const said = saidBy(entry)

    if (!said) {
      continue
    }

    const who = said.role === 'assistant' ? name : said.author
    const line = `[${localMinute(said.at)}] ${who}: ${said.text}`
    const size = estimateTextTokens(line)
    newest ??= entry.id

    if (tokens + size > budget) {
      // A single message larger than the budget is cut, not skipped forever.
      // Three characters a token keeps the cut safely under it.
      if (!lines.length) {
        lines.push(line.slice(0, budget * 3))
        note(said)
      }

      break
    }

    lines.push(line)
    tokens += size
    note(said)
  }

  if (newest === undefined) {
    return undefined
  }

  return {
    newest,
    transcript: lines.reverse().join('\n'),
    start: upkeepDay(
      Number.isFinite(people.first) ? people.first : replies.first,
    ),
    end: upkeepDay(Number.isFinite(people.last) ? people.last : replies.last),
  }
}
