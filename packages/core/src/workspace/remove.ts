import type { Context } from '@earendil-works/chord'
import type {
  Harness,
  JsonObject,
  SessionDocFamilyToken,
} from '@earendil-works/pi-durable'
import { ThinkingLevels } from '../conversation/models.ts'
import { Episodes } from '../memory/episodes.ts'
import { Facts, MemoryUsage } from '../memory/facts.ts'
import { Upkeep } from '../memory/upkeep/schedule.ts'
import { RoomCursors } from '../rooms/catch-up.ts'
import type { TurnInput } from '../rooms/log.ts'
import { leaveRooms } from '../rooms/rooms.ts'
import { TURN_TASK } from '../rooms/turn.ts'
import { Schedules } from '../schedules/schedules.ts'
import { familiarRecord, Familiars, type FamiliarId } from './familiars.ts'

/**
 * Every document family keyed by a Familiar (see `familiarDoc`): its
 * configuration and memory, which removing it retires. A new family joins
 * this list.
 */
const FAMILIAR_DOCS: SessionDocFamilyToken<JsonObject, null>[] = [
  Facts,
  MemoryUsage,
  Episodes,
  Upkeep,
  Schedules,
  ThinkingLevels,
  RoomCursors,
]

/**
 * Removes a Familiar, then stops its work. One commit takes it out of the
 * registry and every named room and retires its documents, so nothing new
 * can start for it: rooms route nothing to it, its DMs refuse new messages,
 * and `familiarOf` finds no owner for its conversations, which stay in
 * storage with the rooms' history. Then Pi's aborts stop what it was doing:
 * its turns in every room, its chat's run and queue, its schedules and
 * memory upkeep (its chat's background tasks), and upkeep's run. Throws for
 * a Familiar that doesn't exist.
 */
export async function removeFamiliar(
  harness: Harness,
  familiar: FamiliarId,
  context: Context,
) {
  const upkeep = await harness.commit(async (tx) => {
    const { upkeep } = await familiarRecord(tx, familiar)
    delete (await tx.doc(Familiars)).familiars[familiar]
    await leaveRooms(tx, familiar)
    for (const family of FAMILIAR_DOCS) {
      await tx.retireDoc(family, String(familiar))
    }
    return upkeep
  }, context)

  // Turns first: one being delivered could otherwise queue an input in the
  // chat after its abort. Each files what it said before it was stopped.
  const { tasks } = await harness.inspect(context)
  const turns = tasks
    .map(({ record }) => record)
    .filter(
      (task) =>
        task.kind === TURN_TASK &&
        (task.input as TurnInput).familiar === familiar,
    )
  await Promise.all(turns.map((task) => harness.abortTask(task.id, context)))
  await Promise.all(turns.map((task) => harness.waitForTask(task.id, context)))

  for (const conversation of [familiar, upkeep]) {
    await (
      await harness.conversation(conversation, context)
    )?.abort(context, {
      background: true,
    })
  }
}
