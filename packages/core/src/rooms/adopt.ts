import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import type {
  EntryDraft,
  EntryId,
  EntryRecord,
  Tx,
} from '@earendil-works/pi-durable'
import {
  MESSAGE_KIND,
  SCHEDULED_KIND,
  type MessageData,
  type ScheduledData,
} from '../conversation/message.ts'
import { familiarDoc, type FamiliarId } from '../workspace/familiars.ts'
import { RoomCursors } from './catch-up.ts'
import {
  REPLY_KIND,
  type ReplyData,
  type RoomEntry,
  type RoomScheduledData,
} from './log.ts'
import { dmWith, type RoomId } from './rooms.ts'

/**
 * Before rooms, people talked to a Familiar in its chat directly. Adopting
 * such a chat copies it, once, into the Familiar's DM with the person who
 * wrote it, so the DM shows the whole conversation, and the Familiar starts
 * there having seen all of it. The chat itself is left as it is.
 */

/** The person whose messages these mostly are, by host author ID. */
function mostFrequentAuthor(chat: readonly EntryRecord[]) {
  const counts = new Map<string, number>()
  for (const entry of chat) {
    if (entry.kind === MESSAGE_KIND) {
      const { id } = (entry.data as MessageData).author
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** How a copied run ended, from its last model response. */
function outcomeOf(messages: Message[]): ReplyData['outcome'] {
  const last = messages.findLast(
    (message): message is AssistantMessage => message.role === 'assistant',
  )
  return last?.stopReason === 'aborted'
    ? 'stopped'
    : last?.stopReason === 'error'
      ? 'failed'
      : 'answered'
}

/**
 * Copies `familiar`'s `chat`, its entries oldest first, read before this
 * commit wrote anything, into its DM with the person who wrote most of it,
 * in the commit `tx`: each message and reminder as the room's own entry,
 * and each run's assistant and tool-result messages as one reply to the
 * input it answered. `name` is what the replies say answered. Returns the
 * DM, or undefined for a chat no person wrote in.
 */
export async function adoptChat(
  tx: Tx,
  familiar: FamiliarId,
  name: string,
  chat: readonly EntryRecord[],
): Promise<RoomId | undefined> {
  const person = mostFrequentAuthor(chat)
  if (person === undefined) {
    return undefined
  }
  const dm = await dmWith(tx, familiar, person)
  const append = async (entry: RoomEntry) =>
    // A reply's messages are JSON as stored in the chat; Pi's types don't say so.
    (await tx.appendEntry(dm, entry as EntryDraft)).id

  // The input the run being copied answers, and its messages so far.
  let cause: EntryId | undefined
  let run: Message[] = []
  let last: EntryId | undefined
  const endRun = async () => {
    if (cause !== undefined && run.length) {
      last = await append({
        kind: REPLY_KIND,
        data: { familiar, name, cause, outcome: outcomeOf(run), messages: run },
      })
    }
    run = []
  }

  for (const entry of chat) {
    if (entry.kind === MESSAGE_KIND) {
      await endRun()
      const { author, text } = entry.data as MessageData
      // Before rooms, a chat message's time was its model message's.
      const at = entry.model?.[0]?.timestamp ?? 0
      cause = last = await append({
        kind: MESSAGE_KIND,
        data: { author, text, at },
      })
    } else if (entry.kind === SCHEDULED_KIND) {
      await endRun()
      const { scheduleId, prompt, due, creator } = entry.data as ScheduledData
      const data: RoomScheduledData = {
        familiar,
        scheduleId,
        prompt,
        due,
        ...(creator && { creator }),
      }
      cause = last = await append({ kind: SCHEDULED_KIND, data })
    } else if (
      entry.kind === 'pi.assistant' ||
      entry.kind === 'pi.tool-result'
    ) {
      run.push(...(entry.model ?? []))
    }
  }
  await endRun()

  // It has seen everything copied, so its first turn there shows none of it again.
  if (last !== undefined) {
    const cursors = await familiarDoc(tx, RoomCursors, familiar)
    cursors.rooms[dm] = last
    cursors.last = dm
  }
  return dm
}
