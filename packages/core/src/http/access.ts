import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { Author } from '../conversation/message.ts'

/** Everything the HTTP API can do, each named for `allow`. */
export type Operation =
  | 'conversation.history'
  | 'conversation.send'
  | 'conversation.abort'
  | 'conversation.modelOptions'
  | 'conversation.setModel'
  | 'conversation.setThinkingLevel'
  | 'account.state'
  | 'account.signIn'
  | 'account.answerSignIn'
  | 'account.cancelSignIn'
  | 'account.signOut'
  | 'memory.health'
  | 'memory.revise'
  | 'memory.retire'
  | 'memory.setPinned'
  | 'schedules.cancel'
  | 'push.key'
  | 'push.subscribe'
  | 'push.unsubscribe'
  | 'connections.list'
  | 'connections.setSecret'
  | 'connections.deleteSecret'
  | 'mcp.add'
  | 'mcp.remove'
  | 'mcp.reconnect'
  | 'events.conversation'
  | 'events.memory'
  | 'events.episodes'
  | 'events.schedules'
  | 'events.account'

/** Whether `author` may perform `operation`. Anything but `true` refuses. */
export type Allow = (
  author: Author,
  operation: Operation,
) => boolean | Promise<boolean>

/** What `createHttpApi` gives every route: who is asking, and the host's policy. */
export type AccessEnv = { Variables: { author: Author; allow: Allow } }

export const forbidden = (c: Context) => c.json({ error: 'forbidden' }, 403)

/** Whether the request's author may perform `operation`. */
export const allows = async (c: Context<AccessEnv>, operation: Operation) =>
  (await c.get('allow')(c.get('author'), operation)) === true

/** Answers 403 before the route reads anything, unless `allow` agrees. */
export const can = (operation: Operation) =>
  createMiddleware<AccessEnv>(async (c, next) =>
    (await allows(c, operation)) ? next() : forbidden(c),
  )
