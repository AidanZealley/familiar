import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import type { ConversationApi } from './index.ts'
import { can, type AccessEnv } from '../access.ts'
import { ModelError } from './models.ts'

/** Answers 204, or 400 when the model choices refuse the change. */
async function change(c: Context, run: () => Promise<void>) {
  try {
    await run()
  } catch (error) {
    if (error instanceof ModelError) {
      return c.json({ error: error.message }, 400)
    }

    throw error
  }

  return c.body(null, 204)
}

/**
 * A Familiar's model and reasoning level, mounted at `/familiars/:familiar/model`.
 * The current ones stream from the Familiar's `/events` as `model`.
 */
export const modelRoutes = (
  familiarOf: (
    c: Context,
  ) => Pick<ConversationApi, 'models' | 'setModel' | 'setThinkingLevel'>,
) =>
  new Hono<AccessEnv>()
    // The models the Familiar may switch to.
    .get('/options', can('model.options'), (c) =>
      c.json(familiarOf(c).models(), 200),
    )
    .put(
      '/',
      can('model.set'),
      validator('json', (body, c) => {
        if (
          typeof body?.provider !== 'string' ||
          typeof body.modelId !== 'string'
        ) {
          return c.json({ error: 'provider and modelId are required' }, 400)
        }

        return {
          provider: body.provider as string,
          modelId: body.modelId as string,
        }
      }),
      (c) => change(c, () => familiarOf(c).setModel(c.req.valid('json'))),
    )
    .put(
      '/thinking-level',
      can('model.setThinkingLevel'),
      validator('json', (body, c) => {
        if (typeof body?.level !== 'string') {
          return c.json({ error: 'level is required' }, 400)
        }

        // setThinkingLevel refuses any level the current model doesn't offer.
        return { level: body.level as ModelThinkingLevel }
      }),
      (c) =>
        change(c, () =>
          familiarOf(c).setThinkingLevel(c.req.valid('json').level),
        ),
    )
