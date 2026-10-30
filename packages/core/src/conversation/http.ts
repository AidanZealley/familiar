import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { Hono, type Context } from 'hono'
import { validator } from 'hono/validator'
import type { ConversationApi } from './api.ts'
import { ModelError } from './models.ts'

/** Answers 204, or 400 when the chat models refuse the change. */
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
 * The conversation's model and reasoning level, mounted at `/model`. The
 * current ones are in the view's `pi.agent` document.
 */
export const modelRoutes = (conversation: ConversationApi) =>
  new Hono()
    // The models the conversation may switch to.
    .get('/options', (c) => c.json(conversation.models()))
    .put(
      '/',
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
      (c) => change(c, () => conversation.setModel(c.req.valid('json'))),
    )
    .put(
      '/thinking-level',
      validator('json', (body, c) => {
        if (typeof body?.level !== 'string') {
          return c.json({ error: 'level is required' }, 400)
        }

        // setThinkingLevel refuses any level the current model doesn't offer.
        return { level: body.level as ModelThinkingLevel }
      }),
      (c) =>
        change(c, () =>
          conversation.setThinkingLevel(c.req.valid('json').level),
        ),
    )
