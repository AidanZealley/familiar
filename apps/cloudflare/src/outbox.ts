import { DurableObject } from 'cloudflare:workers'
import type { Notification } from '@familiar/core'
import type { Env } from './env.ts'

export type Delivered = Notification & { at: number }

/**
 * Where one bot's notifications go, in place of push. Separate from the bot,
 * so reading it never wakes the bot.
 */
export class Outbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS notifications (at INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL)',
    )
  }

  add({ title, body }: Notification) {
    this.ctx.storage.sql.exec(
      'INSERT INTO notifications (at, title, body) VALUES (?, ?, ?)',
      Date.now(),
      title,
      body,
    )
  }

  list(): Delivered[] {
    return this.ctx.storage.sql
      .exec<Delivered>('SELECT at, title, body FROM notifications ORDER BY at')
      .toArray()
  }
}
