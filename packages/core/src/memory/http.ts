import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import type { MemoryApi } from './api.ts'
import { FactError } from './facts.ts'

/** Answers 204, or 404 when the rules refuse the edit; other failures stay server errors. */
async function edit(c: Context, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    if (error instanceof FactError) {
      return c.json({ error: error.message }, 404)
    }

    throw error
  }

  return c.body(null, 204)
}

/**
 * The owner's corrections, mounted at `/memory`, one route each. Each edit
 * answers 404, changing nothing, when the fact is missing or already past.
 */
export const memoryOperations = (memory: MemoryApi) => ({
  // Numbers that show whether memory is keeping up as it grows.
  health: new Hono().get('/health', async (c) => c.json(await memory.health())),
  // Saves a new version of a fact.
  revise: new Hono().put(
    '/:id',
    validator('json', (body, c) => {
      if (typeof body?.text !== 'string' || !body.text.trim()) {
        return c.json({ error: 'text is required' }, 400)
      }

      return { text: (body.text as string).trim() }
    }),
    (c) =>
      edit(c, () => memory.revise(c.req.param('id'), c.req.valid('json').text)),
  ),
  // Marks a fact no longer true.
  retire: new Hono().post('/:id/retire', (c) =>
    edit(c, () => memory.retire(c.req.param('id'))),
  ),
  // Pins a fact into core or unpins it.
  setPinned: new Hono().put(
    '/:id/pin',
    validator('json', (body, c) => {
      if (typeof body?.pinned !== 'boolean') {
        return c.json({ error: 'pinned must be true or false' }, 400)
      }

      return { pinned: body.pinned as boolean }
    }),
    (c) =>
      edit(c, () =>
        memory.setPinned(c.req.param('id'), c.req.valid('json').pinned),
      ),
  ),
})

/** Every memory route, mounted at `/memory`. */
export const memoryRoutes = (memory: MemoryApi) => {
  const operations = memoryOperations(memory)
  return new Hono()
    .route('/', operations.health)
    .route('/', operations.revise)
    .route('/', operations.retire)
    .route('/', operations.setPinned)
}
