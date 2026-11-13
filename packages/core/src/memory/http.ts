import { Hono, type Context } from 'hono'
import { can, type AccessEnv } from '../access.ts'
import { MemoryError, type MemoryApi } from './api.ts'

/** Answers `run`'s value, or 404 when memory refuses; other failures stay server errors. */
async function answer<T>(c: Context, run: () => Promise<T>) {
  try {
    return await run()
  } catch (error) {
    if (error instanceof MemoryError) {
      return c.json({ error: error.message }, 404)
    }
    throw error
  }
}

/**
 * A Familiar's memory, mounted at `/familiars/:familiar/memory`. Its
 * subjects stream as the `memory` document; pages and the prompt section
 * are read here, and forgetting is the one change.
 */
export const memoryRoutes = (memoryOf: (c: Context) => MemoryApi) =>
  new Hono<AccessEnv>()
    // The memory section of the prompt, as the model sees it now.
    .get('/section', can('memory.read'), async (c) =>
      c.json({ text: await memoryOf(c).section() }, 200),
    )
    // A subject's page: its profile and notes.
    .get('/pages/:subject', can('memory.read'), (c) =>
      answer(c, async () =>
        c.json(await memoryOf(c).page(c.req.param('subject')), 200),
      ),
    )
    // Forgets a note and blocks what it came from.
    .post('/notes/:note/forget', can('memory.forget'), (c) =>
      answer(c, async () => {
        await memoryOf(c).forget(c.req.param('note'))
        return c.body(null, 204)
      }),
    )
