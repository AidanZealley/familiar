import { DurableObject } from 'cloudflare:workers'
import type { Notification } from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'
import { DurableFamiliar, FamiliarTerminated } from '../src/index.ts'
import { scriptedModels } from './model.ts'

// The Worker the workerd tests run: one DurableFamiliar per name on a
// scripted model, reached without auth because only the tests can reach it.

type Env = {
  BOTS: DurableObjectNamespace<Bot>
  OUTBOX: DurableObjectNamespace<Outbox>
  TIME_ZONE: string
  HEARTBEAT_MS: string
}

export class Bot extends DurableObject<Env> {
  /** Changes whenever the object restarts. */
  readonly instance = crypto.randomUUID()
  readonly familiar = new DurableFamiliar(this.ctx, {
    familiar: () => ({
      models: scriptedModels(),
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone: this.env.TIME_ZONE,
      notify: (notification) =>
        this.env.OUTBOX.get(
          this.env.OUTBOX.idFromName(this.ctx.id.toString()),
        ).add(notification),
    }),
    heartbeatMs: Number(this.env.HEARTBEAT_MS),
  })

  override async fetch(request: Request) {
    try {
      return await this.familiar.use((familiar) =>
        createHttpApi(familiar, {
          allow: () => true,
          authenticate: () => ({ id: 'owner', name: 'owner' }),
        }).fetch(request),
      )
    } catch (error) {
      if (error instanceof FamiliarTerminated) {
        return Response.json({ error: 'terminated' }, { status: 410 })
      }
      throw error
    }
  }

  override alarm() {
    return this.familiar.alarm()
  }

  terminate() {
    return this.familiar.terminate()
  }

  async status() {
    return { alarm: await this.ctx.storage.getAlarm(), instance: this.instance }
  }
}

/** Notifications, kept apart from the bot so reading them never wakes it. */
export class Outbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS sent (body TEXT)')
  }

  add({ body }: Notification) {
    this.ctx.storage.sql.exec('INSERT INTO sent (body) VALUES (?)', body)
  }

  list() {
    return this.ctx.storage.sql
      .exec<{ body: string }>('SELECT body FROM sent ORDER BY rowid')
      .toArray()
      .map(({ body }) => body)
  }
}

export default {
  async fetch(request, env) {
    const [, name, ...rest] = new URL(request.url).pathname.split('/')
    const id = env.BOTS.idFromName(name)
    const bot = env.BOTS.get(id)
    switch (rest.join('/')) {
      case 'status':
        return Response.json(await bot.status())
      case 'terminate':
        await bot.terminate()
        return new Response(null, { status: 204 })
      case 'notifications':
        return Response.json(
          await env.OUTBOX.get(env.OUTBOX.idFromName(id.toString())).list(),
        )
      default: {
        // `/<name>/api/...` is Familiar's own HTTP API.
        const url = new URL(request.url)
        url.pathname = `/${rest.slice(1).join('/')}`
        return bot.fetch(new Request(url, request))
      }
    }
  },
} satisfies ExportedHandler<Env>
