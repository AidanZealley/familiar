import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import {
  ROOT_CONVERSATION_ID,
  type EntryId,
  type Tx,
} from '@earendil-works/pi-durable'
import { entriesOf, saidBy } from '../../conversation/message.ts'
import { localMinute } from '../../time/index.ts'
import { exchangeId } from '../exchanges.ts'
import { upkeepDay } from './schedule.ts'

/** A reply belongs to the person's turn, even when a batch splits that turn. */
async function precedingDay(tx: Tx, through: EntryId | null) {
  if (through === null) {
    return undefined
  }
  for await (const entry of entriesOf(tx, {
    conversationId: ROOT_CONVERSATION_ID,
    maxEntryId: through,
    order: 'descending',
  })) {
    const said = saidBy(entry)
    if (said?.role === 'person') {
      return upkeepDay(said.at)
    }
  }
  return undefined
}

/** The oldest unreviewed day, split further only when its text exceeds `budget`. */
export async function newMessages(
  tx: Tx,
  through: EntryId | null,
  budget: number,
  name: string,
) {
  const lines: string[] = []
  let oldest: EntryId | undefined
  let newest: EntryId | undefined
  let tokens = 0
  let day: string | undefined
  let turnDay: string | undefined
  let truncated = false

  for await (const entry of entriesOf(tx, {
    conversationId: ROOT_CONVERSATION_ID,
    order: 'ascending',
    ...(through !== null && { minEntryId: (through + 1) as EntryId }),
  })) {
    const said = saidBy(entry)
    if (!said) {
      continue
    }

    // Model replies use wall-clock timestamps, while people's messages use
    // Familiar's clock. Keep replies with their turn rather than redating it.
    if (said.role === 'person') {
      turnDay = upkeepDay(said.at)
    } else if (day === undefined) {
      turnDay = await precedingDay(tx, through)
    }
    const messageDay = turnDay ?? upkeepDay(said.at)
    if (day !== undefined && messageDay !== day) {
      break
    }

    // People's lines carry their exchange ID, which facts cite as sources.
    const line =
      said.role === 'person'
        ? `[${exchangeId(entry.id)} ${localMinute(said.at)}] ${said.author}: ${said.text}`
        : `[${localMinute(said.at)}] ${name}: ${said.text}`
    const size = estimateTextTokens(line)
    if (tokens + size > budget) {
      if (!lines.length) {
        // Preserve progress for a single oversized message. Report the loss
        // to the host rather than silently treating it as a complete review.
        lines.push(line.slice(0, budget * 3))
        oldest = entry.id
        newest = entry.id
        day = messageDay
        truncated = true
      }
      break
    }

    lines.push(line)
    tokens += size
    oldest ??= entry.id
    newest = entry.id
    day = messageDay
  }

  if (oldest === undefined || newest === undefined || day === undefined) {
    return undefined
  }
  return {
    oldest,
    newest,
    transcript: lines.join('\n'),
    start: day,
    end: day,
    truncated,
  }
}
