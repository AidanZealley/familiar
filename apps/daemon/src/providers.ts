import type { Models } from '@earendil-works/pi-ai'
import { secretValue } from '@familiar-ai/core'
import { Hono } from 'hono'
import { validator } from 'hono/validator'

/**
 * Model providers' API keys, mounted at `/providers`. Write-only: `models`
 * saves each key in its credential store, and the listing says only whether
 * a provider has a credential. OpenAI's is the ChatGPT sign-in, so it isn't
 * listed. Which providers have one is read at startup, so a change applies
 * after a restart.
 */
export const providerRoutes = (models: Models) => {
  const keyed = () =>
    models.getProviders().filter((provider) => provider.id !== 'openai')
  const provider = validator('param', (params, c) =>
    keyed().some((provider) => provider.id === params.id)
      ? { id: params.id }
      : c.json({ error: 'no such provider' }, 404),
  )

  return new Hono()
    .get('/', async (c) =>
      c.json(
        await Promise.all(
          keyed().map(async ({ id, name }) => ({
            id,
            name,
            set: (await models.checkAuth(id)) !== undefined,
          })),
        ),
      ),
    )
    .put(
      '/:id/key',
      provider,
      validator('json', (body, c) => {
        const key =
          typeof body?.key === 'string' ? secretValue(body.key) : undefined
        return key === undefined
          ? c.json({ error: 'key must be visible ASCII characters' }, 400)
          : { key }
      }),
      async (c) => {
        const { key } = c.req.valid('json')
        // The provider's own API-key login, answered with the key.
        await models.login(c.req.valid('param').id, 'api_key', {
          prompt: async () => key,
          notify: () => {},
        })
        return c.body(null, 204)
      },
    )
    .delete('/:id/key', provider, async (c) => {
      await models.logout(c.req.valid('param').id)
      return c.body(null, 204)
    })
}
