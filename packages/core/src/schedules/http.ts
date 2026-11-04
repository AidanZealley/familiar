import { Hono } from 'hono'
import { ScheduleError, type SchedulesApi } from './index.ts'

/** The owner's schedule actions, mounted at `/schedules`, one route each. */
export const scheduleOperations = (schedules: SchedulesApi) => ({
  // Cancels a schedule; 404 when there's no such schedule.
  cancel: new Hono().delete('/:id', async (c) => {
    try {
      await schedules.cancel(c.req.param('id'))
    } catch (error) {
      if (error instanceof ScheduleError) {
        return c.json({ error: error.message }, 404)
      }
      throw error
    }
    return c.body(null, 204)
  }),
})

/** Every schedule route, mounted at `/schedules`. */
export const scheduleRoutes = (schedules: SchedulesApi) =>
  new Hono().route('/', scheduleOperations(schedules).cancel)
