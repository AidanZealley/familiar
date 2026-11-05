import type { Bot } from './bot.ts'

export type Env = {
  BOTS: DurableObjectNamespace<Bot>
  /** IANA zone every bot reads its calendar in. */
  TIME_ZONE: string
  /** Bearer token for every route. Without it, everything is refused. */
  FAMILIAR_TOKEN?: string
}
