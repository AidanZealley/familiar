import { DurableObject } from 'cloudflare:workers'
import { DurableWorkspace, WorkspaceTerminated } from '@familiar-ai/cloudflare'
import { createHttpApi } from '@familiar-ai/core/http'
import type { Env } from './env.ts'
import { ECHO_MODEL, echoModels } from './model.ts'

/**
 * One workspace per name, each in its own Durable Object and storage, with
 * one Familiar the owner talks to in their DM.
 */
export class Bot extends DurableObject<Env> {
  readonly workspace = new DurableWorkspace(this.ctx, {
    // Called each time the object opens, including after eviction.
    workspace: () => ({
      models: echoModels(),
      chatModel: ECHO_MODEL.model,
      modelChoices: [ECHO_MODEL],
      timeZone: this.env.TIME_ZONE,
      // A real host delivers these, such as by Web Push or email.
      notify: async (notification) => console.log(notification),
    }),
    // Its Familiar, made the first time the object opens.
    setup: async (workspace) => {
      if (!(await workspace.familiars.list()).length) {
        await workspace.familiars.create({ name: 'Echo' })
      }
    },
  })

  override async fetch(request: Request): Promise<Response> {
    try {
      return await this.workspace.use((workspace) =>
        // The Worker authenticated the request; only it can reach this object.
        createHttpApi(workspace, {
          allow: () => true,
          authenticate: () => ({ id: 'owner', name: 'owner' }),
        }).fetch(request),
      )
    } catch (error) {
      if (error instanceof WorkspaceTerminated) {
        return Response.json({ error: 'terminated' }, { status: 410 })
      }
      throw error
    }
  }

  override alarm() {
    return this.workspace.alarm()
  }
}
