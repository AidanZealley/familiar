import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import {
  ROOT_CONVERSATION_ID,
  type EntryId,
  type EntryRecord,
  type Storage,
  type TaskRecord,
} from '@earendil-works/pi-durable'

const context = BACKGROUND_CONTEXT

export async function entriesAfter(storage: Storage, after?: EntryId) {
  const entries: EntryRecord[] = []
  let cursor: Parameters<Storage['scanEntries']>[2]
  do {
    const page = await storage.scanEntries(
      {
        conversationId: ROOT_CONVERSATION_ID,
        order: 'ascending',
        ...(after === undefined ? {} : { minEntryId: (after + 1) as EntryId }),
      },
      200,
      cursor,
      context,
    )
    entries.push(...page.items)
    cursor = page.next
  } while (cursor)
  return entries
}

export async function tasksIn(storage: Storage) {
  const tasks: TaskRecord<unknown, unknown, unknown>[] = []
  let cursor: Parameters<Storage['scanTasks']>[2]
  do {
    const page = await storage.scanTasks({}, 200, cursor, context)
    tasks.push(...page.items)
    cursor = page.next
  } while (cursor)
  return tasks
}
