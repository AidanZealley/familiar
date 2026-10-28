import { Hono } from 'hono'
import { ScheduleError, type SchedulesApi } from './index.ts'

/** The owner's schedule actions, mounted at `/schedules` by the HTTP API. */
export const scheduleRoutes = (schedules: SchedulesApi) =>
  new Hono()
    // Cancels a schedule; 404 when there's no such schedule.
    .delete('/:id', async (c) => {
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
