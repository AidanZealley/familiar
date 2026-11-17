import type { Computer } from '@familiar-ai/computer/cloudflare'
import type { Bot } from './bot.ts'

export type Env = {
  BOTS: DurableObjectNamespace<Bot>
  /** Each Familiar's computer, a container. */
  COMPUTERS: DurableObjectNamespace<Computer>
  /** IANA zone every bot reads its calendar in. */
  TIME_ZONE: string
  /** Bearer token for every route. Without it, everything is refused. */
  FAMILIAR_TOKEN?: string
}
