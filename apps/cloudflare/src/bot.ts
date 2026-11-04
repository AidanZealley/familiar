import { DurableObject } from 'cloudflare:workers'
import { DurableFamiliar, FamiliarTerminated } from '@familiar-ai/cloudflare'
import { authorizeSingleOwner } from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'
import { DEV_MODEL, devModels } from './model.ts'
import type { Env } from './env.ts'

/** One Familiar per name, on the scripted model. */
export class Bot extends DurableObject<Env> {
  readonly familiar = new DurableFamiliar(this.ctx, {
    familiar: () => ({
      models: devModels(),
      model: DEV_MODEL.model,
      chatModels: [DEV_MODEL],
      timeZone: this.env.TIME_ZONE,
      // A development bot with one owner, who may run every tool.
      authorizeTool: authorizeSingleOwner,
      notify: (notification) => this.#outbox().add(notification),
    }),
    heartbeatMs: Number(this.env.HEARTBEAT_MS) || undefined,
  })

  override async fetch(request: Request): Promise<Response> {
    try {
      return await this.familiar.use((familiar) =>
        // The Worker authenticated the request; only it can reach this object.
        createHttpApi(familiar, {
          routes: true,
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

  status() {
    return this.familiar.status()
  }

  #outbox() {
    return this.env.OUTBOX.get(
      this.env.OUTBOX.idFromName(this.ctx.id.toString()),
    )
  }
}
