import { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import { guarded, type AuthorEnv } from './guard.ts'

test('a check guards its own route even where another pattern also matches', async () => {
  const cancel = vi.fn()
  const clear = vi.fn()
  const items = {
    // `/items/:id` also matches `/items/all`.
    cancel: new Hono().delete('/items/:id', (c) => {
      cancel(c.req.param('id'))
      return c.body(null, 204)
    }),
    clear: new Hono().delete('/items/all', (c) => {
      clear()
      return c.body(null, 204)
    }),
  }
  /** Deletes `path` from the items mounted in `order`, with `refused` refused. */
  const remove = (
    order: (keyof typeof items)[],
    refused: keyof typeof items,
    path: string,
  ) => {
    const app = new Hono<AuthorEnv>().use(async (c, next) => {
      c.set('author', { id: 'sam', name: 'Sam' })
      await next()
    })
    for (const name of order) {
      app.route(
        '/',
        guarded(items[name], name === refused ? () => false : true),
      )
    }
    return app.request(path, { method: 'DELETE' })
  }

  // Whichever route matches first runs only past its own check, and a
  // refusal never falls through to the other route's handler.
  expect(
    (await remove(['cancel', 'clear'], 'cancel', '/items/all')).status,
  ).toBe(403)
  expect(
    (await remove(['clear', 'cancel'], 'clear', '/items/all')).status,
  ).toBe(403)
  expect(cancel).not.toHaveBeenCalled()
  expect(clear).not.toHaveBeenCalled()
  expect((await remove(['clear', 'cancel'], 'clear', '/items/3')).status).toBe(
    204,
  )
  expect(cancel).toHaveBeenCalledExactlyOnceWith('3')
  expect(clear).not.toHaveBeenCalled()
})

test.each([
  ['a middleware', new Hono().use(async (_c, next) => next())],
  [
    'two paths',
    new Hono().get('/a', (c) => c.body(null)).get('/b', (c) => c.body(null)),
  ],
])('an operation is one method and path, not %s', (_name, operation) => {
  expect(() => guarded(operation, () => true)).toThrow('one method and path')
})
