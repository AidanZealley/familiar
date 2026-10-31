import type { Bot } from './bot.ts'
import type { Outbox } from './outbox.ts'

export type Env = {
  BOTS: DurableObjectNamespace<Bot>
  OUTBOX: DurableObjectNamespace<Outbox>
  /** IANA zone every bot reads its calendar in. */
  TIME_ZONE: string
  /** How soon a lost process's work resumes; tests shorten it. */
  HEARTBEAT_MS?: string
  /** Bearer token for every route. Without it, everything is refused. */
  FAMILIAR_DEV_TOKEN?: string
}
