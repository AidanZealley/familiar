import type { ModelRef } from '@earendil-works/pi-durable'
import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import { can, type AccessEnv } from '../access.ts'
import { modelRoutes } from '../conversation/http.ts'
import { streamEvents } from '../http/events.ts'
import { found } from '../http/found.ts'
import { memoryRoutes } from '../memory/http.ts'
import { scheduleRoutes } from '../schedules/http.ts'
import type { FamiliarId } from './familiars.ts'
import type { Workspace } from './index.ts'

/**
 * A blank name or persona, a memory model that isn't a model choice, or a
 * plugin or connection the workspace hasn't: `familiars.create`, `update` and
 * `setCapabilities` throw TypeErrors for exactly these.
 */
async function identity(c: Context, run: () => Promise<Response>) {
  try {
    return await run()
  } catch (error) {
    if (error instanceof TypeError) {
      return c.json({ error: error.message }, 400)
    }
    throw error
  }
}

const optional = (value: unknown) =>
  value === undefined || typeof value === 'string'

/** A model as the wire carries it: its provider and its ID in it. */
const modelRef = (value: unknown) =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { provider?: unknown }).provider === 'string' &&
  typeof (value as { modelId?: unknown }).modelId === 'string'

/** Only the two fields a model is named by. */
const pick = ({ provider, modelId }: ModelRef): ModelRef => ({
  provider,
  modelId,
})

const names = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) && value.every((name) => typeof name === 'string'))

/** A change to plugins and MCP connections, by name, as far as its shape. */
const capabilitiesChange = validator('json', (body, c) => {
  if (!names(body?.plugins) || !names(body.mcp)) {
    return c.json({ error: 'plugins and mcp must be lists of names' }, 400)
  }
  // Inline, so the route's type names nothing outside the wire contract.
  return body as { plugins?: string[]; mcp?: string[] }
})

/**
 * The workspace's defaults, mounted at `/defaults`: the plugins and MCP
 * connections a new Familiar uses unless its creator chooses.
 */
export const defaultRoutes = (workspace: Workspace) =>
  new Hono<AccessEnv>()
    .get('/capabilities', can('defaults.get'), async (c) =>
      c.json(await workspace.defaultCapabilities(), 200),
    )
    // Each list given replaces that kind's defaults.
    .put('/capabilities', can('defaults.set'), capabilitiesChange, (c) =>
      identity(c, async () => {
        const { plugins, mcp } = c.req.valid('json')
        await workspace.setDefaultCapabilities({ plugins, mcp })
        return c.body(null, 204)
      }),
    )

/**
 * The person asking, mounted at `/me`: who they are to Familiars, by their
 * host author ID and the name Familiars call them, which they may change.
 */
export const meRoutes = (workspace: Workspace) =>
  new Hono<AccessEnv>()
    .get('/', can('me.get'), async (c) =>
      c.json(await workspace.people.get(c.get('author')), 200),
    )
    .patch(
      '/',
      can('me.update'),
      validator('json', (body, c) => {
        if (typeof body?.name !== 'string') {
          return c.json({ error: 'name is required' }, 400)
        }
        return { name: body.name as string }
      }),
      (c) =>
        identity(c, async () => {
          await workspace.people.rename(
            c.get('author').id,
            c.req.valid('json').name,
          )
          return c.body(null, 204)
        }),
    )

/**
 * Familiars, mounted at `/familiars`: who they are, each one's DM with the
 * person asking, memory, schedules, model, plugins and MCP connections, and
 * each one's `/events`.
 * People talk to them in rooms, never in their chats.
 */
export function familiarRoutes(workspace: Workspace) {
  const idOf = (c: Context) => Number(c.req.param('familiar')) as FamiliarId
  const familiarOf = (c: Context) =>
    found(workspace.familiars.get(idOf(c)), 'Familiar')

  return (
    new Hono<AccessEnv>()
      .get('/', can('familiars.list'), async (c) =>
        c.json(await workspace.familiars.list(), 200),
      )
      .post(
        '/',
        can('familiars.create'),
        validator('json', (body, c) => {
          if (
            typeof body?.name !== 'string' ||
            !optional(body.persona) ||
            !optional(body.avatar)
          ) {
            return c.json(
              { error: 'name is required; persona and avatar are text' },
              400,
            )
          }
          if (body.memoryModel !== undefined && !modelRef(body.memoryModel)) {
            return c.json(
              { error: 'memoryModel must be a provider and modelId' },
              400,
            )
          }
          const capabilities = body.capabilities as
            { plugins?: unknown; mcp?: unknown } | undefined
          if (
            capabilities !== undefined &&
            (!names(capabilities?.plugins) || !names(capabilities?.mcp))
          ) {
            return c.json(
              { error: 'capabilities must list plugins and mcp by name' },
              400,
            )
          }
          return {
            name: body.name as string,
            ...(body.persona !== undefined && {
              persona: body.persona as string,
            }),
            ...(body.avatar !== undefined && {
              avatar: body.avatar as string,
            }),
            ...(body.memoryModel !== undefined && {
              memoryModel: pick(body.memoryModel as ModelRef),
            }),
            // Without it, the workspace's default tools.
            ...(capabilities !== undefined && {
              capabilities: capabilities as {
                plugins?: string[]
                mcp?: string[]
              },
            }),
          }
        }),
        (c) =>
          identity(c, async () => {
            const { id } = await workspace.familiars.create(c.req.valid('json'))
            return c.json({ id }, 201)
          }),
      )
      // A `null` persona, avatar or memoryModel returns it to the default.
      .patch(
        '/:familiar',
        can('familiars.update'),
        validator('json', (body, c) => {
          if (
            !optional(body?.name) ||
            !(optional(body.persona) || body.persona === null) ||
            !(optional(body.avatar) || body.avatar === null)
          ) {
            return c.json(
              { error: 'name, persona and avatar must be text' },
              400,
            )
          }
          if (
            body.memoryModel !== undefined &&
            body.memoryModel !== null &&
            !modelRef(body.memoryModel)
          ) {
            return c.json(
              { error: 'memoryModel must be a provider and modelId' },
              400,
            )
          }
          // Inline, so the route's type names nothing outside the wire contract.
          return body as {
            name?: string
            persona?: string | null
            avatar?: string | null
            memoryModel?: { provider: string; modelId: string } | null
          }
        }),
        (c) =>
          identity(c, async () => {
            const { name, persona, avatar, memoryModel } = c.req.valid('json')
            familiarOf(c)
            await workspace.familiars.update(idOf(c), {
              name,
              persona,
              avatar,
              memoryModel: memoryModel && pick(memoryModel),
            })
            return c.body(null, 204)
          }),
      )
      .delete('/:familiar', can('familiars.remove'), async (c) => {
        familiarOf(c)
        await workspace.familiars.remove(idOf(c))
        return c.body(null, 204)
      })
      // Which of the workspace's plugins and MCP connections it uses.
      .get('/:familiar/capabilities', can('capabilities.get'), async (c) =>
        c.json(await familiarOf(c).capabilities(), 200),
      )
      // Each list given replaces what it uses of that kind.
      .put(
        '/:familiar/capabilities',
        can('capabilities.set'),
        capabilitiesChange,
        (c) =>
          identity(c, async () => {
            const { plugins, mcp } = c.req.valid('json')
            await familiarOf(c).setCapabilities({ plugins, mcp })
            return c.body(null, 204)
          }),
      )
      // The DM between this Familiar and whoever asks, created if new.
      .post('/:familiar/dm', can('familiars.dm'), async (c) => {
        const { id } = familiarOf(c)
        return c.json(
          { room: await workspace.rooms.dm(id, c.get('author').id) },
          200,
        )
      })
      .route(
        '/:familiar/memory',
        memoryRoutes((c) => familiarOf(c).memory),
      )
      .route(
        '/:familiar/schedules',
        scheduleRoutes((c) => familiarOf(c).schedules),
      )
      .route('/:familiar/model', modelRoutes(familiarOf))
      .get('/:familiar/events', (c) => {
        // Opened only once the stream is allowed and the Familiar exists.
        const familiar = () => familiarOf(c)
        return streamEvents(
          c,
          [
            {
              operation: 'events.model',
              open: (stream) =>
                stream.document('model', () => familiar().watchModel()),
            },
            {
              operation: 'events.memory',
              open: (stream) =>
                stream.document('memory', () => familiar().memory.watch()),
            },
            {
              operation: 'events.schedules',
              open: (stream) =>
                stream.document('schedules', () =>
                  familiar().schedules.watch(),
                ),
            },
          ],
          { familiar: idOf(c) },
          familiar,
        )
      })
  )
}
