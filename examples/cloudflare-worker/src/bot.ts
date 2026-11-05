import { DurableObject } from 'cloudflare:workers'
import { DurableFamiliar, FamiliarTerminated } from '@familiar-ai/cloudflare'
import { createHttpApi } from '@familiar-ai/core/http'
import type { Env } from './env.ts'
import { ECHO_MODEL, echoModels } from './model.ts'

/** One Familiar per name, each in its own Durable Object and storage. */
export class Bot extends DurableObject<Env> {
  readonly familiar = new DurableFamiliar(this.ctx, {
    // Called each time the object opens, including after eviction.
    familiar: () => ({
      models: echoModels(),
      model: ECHO_MODEL.model,
      chatModels: [ECHO_MODEL],
      timeZone: this.env.TIME_ZONE,
      // A real host delivers these, such as by Web Push or email.
      notify: async (notification) => console.log(notification),
    }),
  })

  override async fetch(request: Request): Promise<Response> {
    try {
      return await this.familiar.use((familiar) =>
        // The Worker authenticated the request; only it can reach this object.
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
}
