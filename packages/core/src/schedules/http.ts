import { Hono, type Context } from 'hono'
import { can, type AccessEnv } from '../access.ts'
import { ScheduleError, type SchedulesApi } from './index.ts'

/** A Familiar's schedule actions, mounted at `/familiars/:familiar/schedules`. */
export const scheduleRoutes = (schedulesOf: (c: Context) => SchedulesApi) =>
  // Cancels a schedule; 404 when there's no such schedule.
  new Hono<AccessEnv>().delete('/:id', can('schedules.cancel'), async (c) => {
    try {
      await schedulesOf(c).cancel(c.req.param('id'))
    } catch (error) {
      if (error instanceof ScheduleError) {
        return c.json({ error: error.message }, 404)
      }
      throw error
    }
    return c.body(null, 204)
  })
