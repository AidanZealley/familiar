import { Hono } from 'hono'
import { can, type AccessEnv } from '../http/access.ts'
import { ScheduleError, type SchedulesApi } from './index.ts'

/** The owner's schedule actions, mounted at `/schedules`. */
export const scheduleRoutes = (schedules: SchedulesApi) =>
  // Cancels a schedule; 404 when there's no such schedule.
  new Hono<AccessEnv>().delete('/:id', can('schedules.cancel'), async (c) => {
    try {
      await schedules.cancel(c.req.param('id'))
    } catch (error) {
      if (error instanceof ScheduleError) {
        return c.json({ error: error.message }, 404)
      }
      throw error
    }
    return c.body(null, 204)
  })
