import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Author } from './conversation/message.ts'
import type { RoomId } from './rooms/rooms.ts'
import type { FamiliarId } from './workspace/familiars.ts'

/** What the HTTP API can do to the workspace as a whole, each named for `allow`. */
export type WorkspaceOperation =
  | 'account.state'
  | 'account.signIn'
  | 'account.answerSignIn'
  | 'account.cancelSignIn'
  | 'account.signOut'
  | 'push.key'
  | 'push.subscribe'
  | 'push.unsubscribe'
  | 'connections.list'
  | 'connections.setSecret'
  | 'connections.deleteSecret'
  | 'mcp.add'
  | 'mcp.remove'
  | 'mcp.reconnect'
  | 'familiars.list'
  | 'familiars.create'
  | 'rooms.list'
  | 'rooms.create'
  | 'events.familiars'
  | 'events.rooms'
  | 'events.account'

/** What it can do to one Familiar, asked with that Familiar's ID. */
export type FamiliarOperation =
  | 'familiars.update'
  | 'familiars.remove'
  | 'familiars.dm'
  | 'memory.revise'
  | 'memory.retire'
  | 'memory.setPinned'
  | 'schedules.cancel'
  | 'model.options'
  | 'model.set'
  | 'model.setThinkingLevel'
  | 'capabilities.get'
  | 'capabilities.set'
  | 'events.model'
  | 'events.memory'
  | 'events.episodes'
  | 'events.schedules'

/** What it can do in one room, asked with that room's ID. */
export type RoomOperation =
  | 'rooms.update'
  | 'rooms.archive'
  | 'rooms.post'
  | 'rooms.note'
  | 'rooms.history'
  | 'rooms.stop'
  | 'events.room'

/** Everything the HTTP API can do, each named for `allow`. */
export type Operation = WorkspaceOperation | FamiliarOperation | RoomOperation

/**
 * What an operation is about, beyond the workspace: the Familiar or the room
 * in its path. Core doesn't check that it exists before asking.
 */
export type Resource = { familiar: FamiliarId } | { room: RoomId }

/**
 * Whether `author` may perform `operation`, on `resource` for a Familiar's
 * or a room's operations. Anything but `true` refuses.
 */
export type Allow = (
  author: Author,
  operation: Operation,
  resource?: Resource,
) => boolean | Promise<boolean>

/** What `createHttpApi` gives every route: who is asking, and the host's policy. */
export type AccessEnv = { Variables: { author: Author; allow: Allow } }

export const forbidden = (c: Context) => c.json({ error: 'forbidden' }, 403)

/** Whether the request's author may perform `operation`, on `resource` if it has one. */
export const allows = async (
  c: Context<AccessEnv>,
  operation: Operation,
  resource?: Resource,
) => (await c.get('allow')(c.get('author'), operation, resource)) === true

/** The resource a route's path names, by its `:familiar` or `:room` parameter. */
const resourceOf = (c: Context<AccessEnv>): Resource | undefined => {
  const familiar = c.req.param('familiar')
  const room = c.req.param('room')
  return familiar !== undefined
    ? { familiar: Number(familiar) as FamiliarId }
    : room !== undefined
      ? { room: Number(room) as RoomId }
      : undefined
}

/**
 * Answers 403 before the route reads anything, unless `allow` agrees. A
 * Familiar's or room's operation is asked with the ID in the path.
 */
export const can = (operation: Operation) =>
  createMiddleware<AccessEnv>(async (c, next) =>
    (await allows(c, operation, resourceOf(c))) ? next() : forbidden(c),
  )
