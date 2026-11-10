import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import { can, type AccessEnv } from '../access.ts'
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
 * The owner's corrections to a Familiar's memory, mounted at
 * `/familiars/:familiar/memory`. Each edit answers 404, changing nothing,
 * when the fact is missing or already past.
 */
export const memoryRoutes = (memoryOf: (c: Context) => MemoryApi) =>
  new Hono<AccessEnv>()
    // Saves a new version of a fact.
    .put(
      '/:id',
      can('memory.revise'),
      validator('json', (body, c) => {
        if (typeof body?.text !== 'string' || !body.text.trim()) {
          return c.json({ error: 'text is required' }, 400)
        }

        return { text: (body.text as string).trim() }
      }),
      (c) =>
        edit(c, () =>
          memoryOf(c).revise(c.req.param('id'), c.req.valid('json').text),
        ),
    )
    // Marks a fact no longer true.
    .post('/:id/retire', can('memory.retire'), (c) =>
      edit(c, () => memoryOf(c).retire(c.req.param('id'))),
    )
    // Pins a fact into core or unpins it.
    .put(
      '/:id/pin',
      can('memory.setPinned'),
      validator('json', (body, c) => {
        if (typeof body?.pinned !== 'boolean') {
          return c.json({ error: 'pinned must be true or false' }, 400)
        }

        return { pinned: body.pinned as boolean }
      }),
      (c) =>
        edit(c, () =>
          memoryOf(c).setPinned(c.req.param('id'), c.req.valid('json').pinned),
        ),
    )
