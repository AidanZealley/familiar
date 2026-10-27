import { Hono, type Context } from 'hono'
import type { MemoryApi } from './api.ts'
import { FactError } from './facts.ts'

/**
 * `PUT /memory/:id` saves a new version of a fact; `POST /memory/:id/retire`
 * marks it no longer true; `DELETE /memory/:id` forgets it. Each answers 404,
 * changing nothing, when the fact is missing or already past.
 */
export type ReviseBody = { text: string }

/** `PUT /memory/:id/pin` pins a fact into core or unpins it. */
export type PinBody = { pinned: boolean }

/** Answers 204, or 404 when the rules refuse the edit; other failures stay server errors. */
async function edit(c: Context, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    if (error instanceof FactError) return c.json({ error: error.message }, 404)
    throw error
  }
  return c.body(null, 204)
}

/** The owner's corrections, mounted at `/memory` by the HTTP API. */
export const memoryRoutes = (memory: MemoryApi) =>
  new Hono()
    .put('/:id', async (c) => {
      const body = await c.req.json<ReviseBody>()
      if (typeof body.text !== 'string' || !body.text.trim())
        return c.json({ error: 'text is required' }, 400)
      return edit(c, () => memory.revise(c.req.param('id'), body.text.trim()))
    })
    .post('/:id/retire', (c) => edit(c, () => memory.retire(c.req.param('id'))))
    .put('/:id/pin', async (c) => {
      const body = await c.req.json<PinBody>()
      if (typeof body.pinned !== 'boolean')
        return c.json({ error: 'pinned must be true or false' }, 400)
      return edit(c, () => memory.setPinned(c.req.param('id'), body.pinned))
    })
    .delete('/:id', (c) => edit(c, () => memory.forget(c.req.param('id'))))
