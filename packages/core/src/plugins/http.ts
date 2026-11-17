import { Hono } from 'hono'
import { can, type AccessEnv } from '../access.ts'
import { found } from '../http/found.ts'
import type { FamiliarId } from '../workspace/familiars.ts'
import type { Workspace } from '../workspace/index.ts'
import type { PluginEnv } from './types.ts'

type Env = { Variables: AccessEnv['Variables'] & PluginEnv['Variables'] }

/**
 * Each plugin's routes, at `/<name>/familiars/:familiar`: asked of `allow`
 * as `plugins.<name>` with the Familiar's ID, then 404 for no such
 * Familiar, then the plugin's, given the Familiar.
 */
export function pluginRoutes(workspace: Workspace) {
  const routes = new Hono<Env>()
  for (const plugin of workspace.plugins) {
    if (plugin.routes) {
      routes.route(
        `/${plugin.name}/familiars/:familiar`,
        new Hono<Env>()
          .use(can(`plugins.${plugin.name}`))
          .use(async (c, next) => {
            const id = Number(c.req.param('familiar')) as FamiliarId
            c.set('familiar', found(workspace.familiars.get(id), 'Familiar').id)
            await next()
          })
          .route('/', plugin.routes),
      )
    }
  }
  return routes
}
