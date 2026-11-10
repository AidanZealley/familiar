import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import type { EntryId, Tx } from '@earendil-works/pi-durable'
import { formatAuthor, saidBy, type Said } from '../../conversation/message.ts'
import { localMinute } from '../../time.ts'
import { exchangeId } from '../exchanges.ts'
import { upkeepDay } from './schedule.ts'
import type { FamiliarId } from '../../workspace/familiars.ts'
import { entriesOf } from '../../pi/entries.ts'

const indented = (text: string) => text.replace(/^/gm, '    ')

/** An input's words, after whose they are. */
const inputLine = (said: Exclude<Said, { role: 'assistant' }>) =>
  said.role === 'person'
    ? `${formatAuthor(said.author)}: ${said.text}`
    : said.role === 'scheduled'
      ? `(scheduled${said.creator ? `; requested by ${formatAuthor(said.creator)}` : ''}) ${said.text}`
      : `(handed on by ${formatAuthor(said.from)}, another assistant) ${said.text}`

/** A reply belongs to the person's turn, even when a batch splits that turn. */
async function precedingDay(
  tx: Tx,
  familiar: FamiliarId,
  through: EntryId | null,
  timeZone: string,
) {
  if (through === null) {
    return undefined
  }
  for await (const entry of entriesOf(tx, {
    conversationId: familiar,
    maxEntryId: through,
    order: 'descending',
  })) {
    const said = saidBy(entry)
    if (said && said.role !== 'assistant') {
      return upkeepDay(said.at, timeZone)
    }
  }
  return undefined
}

/**
 * The oldest unreviewed day of `familiar`'s chat, split further only when
 * its text exceeds `budget`. `name` is what the Familiar's lines are called.
 */
export async function newMessages(
  tx: Tx,
  familiar: FamiliarId,
  through: EntryId | null,
  budget: number,
  name: string,
  timeZone: string,
) {
  const lines: string[] = []
  let oldest: EntryId | undefined
  let newest: EntryId | undefined
  let tokens = 0
  let day: string | undefined
  let turnDay: string | undefined
  let truncated = false

  for await (const entry of entriesOf(tx, {
    conversationId: familiar,
    order: 'ascending',
    ...(through !== null && { minEntryId: (through + 1) as EntryId }),
  })) {
    const said = saidBy(entry)
    if (!said) {
      continue
    }

    // Model replies use wall-clock timestamps, while people's messages use
    // Familiar's clock. Keep replies with their turn rather than redating it.
    if (said.role !== 'assistant') {
      turnDay = upkeepDay(said.at, timeZone)
    } else if (day === undefined) {
      turnDay = await precedingDay(tx, familiar, through, timeZone)
    }
    const messageDay = turnDay ?? upkeepDay(said.at, timeZone)
    if (day !== undefined && messageDay !== day) {
      break
    }

    // Inputs' lines carry their exchange ID, which facts cite as sources. A
    // reminder is the Familiar's own earlier words and a handoff's note
    // another Familiar's, so each says whose. What a room showed the
    // Familiar with an input follows it, set apart: those are other people's
    // and Familiars' words, not its sender's. It comes last, so a cut for
    // size never takes the input and its ID.
    const when = localMinute(said.at, timeZone)
    const line =
      said.role === 'assistant'
        ? `[${when}] ${name}: ${said.text}`
        : `[${exchangeId(entry.id)} ${when}] ${inputLine(said)}${said.context ? `\n  Shown to ${name} from the room with that input, said by others, not by its sender (cite the input's ID for any fact in it):\n${indented(said.context)}` : ''}`
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
    /** The upkeep day every message in the batch belongs to. */
    day,
    truncated,
  }
}
