import {
  CompactionEntry,
  type EntryId,
  type Tx,
} from '@earendil-works/pi-durable'
import {
  saidBy,
  type Author,
  type InRoom,
  type Said,
} from '../conversation/message.ts'
import { formatHandoff } from '../rooms/log.ts'
import type { RoomId, RoomRegistry } from '../rooms/rooms.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import { entriesOf } from '../pi/entries.ts'

/**
 * Exchanges: each input (a person's message, a scheduled prompt or a
 * handoff) with the replies after it, the smallest piece of the transcript
 * worth finding. They are never stored: memory reads them from the
 * transcript, which stays the ground truth.
 */

/**
 * An input's words, a handoff's under whoever handed it on, and after them
 * what the Familiar was shown from the room with it, so what was said only
 * there can be found and read in its exchange.
 */
const inputText = (said: Exclude<Said, { role: 'assistant' }>) => {
  const text =
    said.role === 'handoff' ? formatHandoff(said.from, said.text) : said.text
  return said.context
    ? `${text}\n[Shown from the room with it, said by others]\n${said.context}`
    : text
}

/** Where a message was said, as filing and recall show it. */
export function placeOf(
  rooms: Readonly<RoomRegistry>,
  room: RoomId | undefined,
) {
  const record = room === undefined ? undefined : rooms.rooms[room]
  return record?.kind === 'room' ? `#${record.name}` : 'a DM'
}

/** An exchange's ID: `x` and its input's entry ID. */
export const exchangeId = (entry: EntryId) => `x${entry}`

/** The input an exchange ID names, or undefined if it isn't one. */
export const entryOf = (id: string) =>
  /^x\d+$/.test(id) ? (Number(id.slice(1)) as EntryId) : undefined

export type Exchange = {
  /** `x` and the input's entry ID. */
  id: string
  /** When the input was sent, in ms since the epoch. */
  at: number
  /** Author snapshot, or creator when this exchange was scheduled. */
  author?: Author
  /** The room it came from, if any. */
  room?: RoomId
  /** The input's text, then the replies. */
  text: string
  /** Its newest entry: the last reply, or the input if none yet. */
  last: EntryId
}

/**
 * Reads `familiar`'s chat into exchanges for as long as the workspace runs.
 * `read` continues after the last entry it saw, so it is called at the start
 * of each search and never needs telling about new messages. An exchange is
 * handed on only once the next input exists, so every exchange is final;
 * the newest is still in the model's context anyway. It also notes where
 * the model's view begins, from the latest compaction, so searches can tell
 * what compaction took out of it.
 */
export function transcriptReader(familiar: FamiliarId) {
  let through: EntryId | undefined
  let open: Exchange | undefined
  let viewStart: EntryId | undefined

  return {
    async read(tx: Tx, add: (exchange: Exchange) => void) {
      for await (const entry of entriesOf(tx, {
        conversationId: familiar,
        order: 'ascending',
        ...(through !== undefined && {
          minEntryId: (through + 1) as EntryId,
        }),
      })) {
        through = entry.id
        if (CompactionEntry.is(entry)) {
          viewStart = entry.head
        }
        const said = saidBy(entry)
        // Every input and its replies are an exchange of their own.
        if (said && said.role !== 'assistant') {
          if (open) {
            add(open)
          }
          const room = (entry.data as InRoom | undefined)?.room
          open = {
            id: exchangeId(entry.id),
            at: said.at,
            // A handoff's sender is a Familiar, named in its text.
            ...(said.role === 'person'
              ? { author: said.author }
              : said.role === 'scheduled' && said.creator
                ? { author: said.creator }
                : {}),
            ...(room !== undefined && { room }),
            text: inputText(said),
            last: entry.id,
          }
        } else if (said && open) {
          open = { ...open, text: `${open.text}\n${said.text}`, last: entry.id }
        }
      }
    },

    /**
     * The first entry the model sees verbatim, as of the last read, or
     * undefined before any compaction.
     */
    get viewStart() {
      return viewStart
    },
  }
}
