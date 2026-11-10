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

/** A blank name or persona: `familiars.create` and `update` throw TypeErrors for exactly these. */
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

/**
 * Familiars, mounted at `/familiars`: who they are, each one's DM with the
 * person asking, memory, schedules and model, and each one's `/events`.
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
          if (typeof body?.name !== 'string' || !optional(body.persona)) {
            return c.json({ error: 'name is required' }, 400)
          }
          return {
            name: body.name as string,
            ...(body.persona !== undefined && {
              persona: body.persona as string,
            }),
          }
        }),
        (c) =>
          identity(c, async () => {
            const { id } = await workspace.familiars.create(c.req.valid('json'))
            return c.json({ id }, 201)
          }),
      )
      // A `null` persona returns it to the default.
      .patch(
        '/:familiar',
        can('familiars.update'),
        validator('json', (body, c) => {
          if (
            !optional(body?.name) ||
            !(optional(body.persona) || body.persona === null)
          ) {
            return c.json({ error: 'name and persona must be text' }, 400)
          }
          // Inline, so the route's type names nothing outside the wire contract.
          return body as { name?: string; persona?: string | null }
        }),
        (c) =>
          identity(c, async () => {
            const { name, persona } = c.req.valid('json')
            familiarOf(c)
            await workspace.familiars.update(idOf(c), { name, persona })
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
              operation: 'events.episodes',
              open: (stream) =>
                stream.document('episodes', () =>
                  familiar().memory.watchEpisodes(),
                ),
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
