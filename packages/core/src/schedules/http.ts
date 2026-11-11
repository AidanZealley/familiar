import { Hono, type Context } from 'hono'
import { can, type AccessEnv } from '../access.ts'
import { ScheduleError, type SchedulesApi } from './index.ts'

/** Answers 204 once `run` has, or 404 when there's no such schedule. */
async function found(c: Context, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    if (error instanceof ScheduleError) {
      return c.json({ error: error.message }, 404)
    }
    throw error
  }
  return c.body(null, 204)
}

/** A Familiar's schedule actions, mounted at `/familiars/:familiar/schedules`. */
export const scheduleRoutes = (schedulesOf: (c: Context) => SchedulesApi) =>
  new Hono<AccessEnv>()
    .delete('/:id', can('schedules.cancel'), (c) =>
      found(c, () => schedulesOf(c).cancel(c.req.param('id'))),
    )
    .post('/:id/pause', can('schedules.pause'), (c) =>
      found(c, () => schedulesOf(c).pause(c.req.param('id'))),
    )
    .post('/:id/resume', can('schedules.resume'), (c) =>
      found(c, () => schedulesOf(c).resume(c.req.param('id'))),
    )
