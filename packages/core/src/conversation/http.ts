import type { EntryId } from '@earendil-works/pi-durable'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { Hono, type Context, type TypedResponse } from 'hono'
import { validator } from 'hono/validator'
import type { ConversationApi, HistoryPage } from './api.ts'
import { can, type AccessEnv } from '../http/access.ts'
import { MessageError } from './message.ts'
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
 * Sending, history and aborting, and the conversation's model and reasoning
 * level under `/model`. The current model is in the view's `pi.agent`
 * document. Message attribution comes only from the host, never the body.
 */
export const conversationRoutes = (
  conversation: Pick<
    ConversationApi,
    'send' | 'history' | 'abort' | 'models' | 'setModel' | 'setThinkingLevel'
  >,
) =>
  new Hono<AccessEnv>()
    // A page of entries older than `before`, newest first.
    .get(
      '/history',
      can('conversation.history'),
      validator('query', (query, c) => {
        const before = Number(query.before)

        if (!Number.isSafeInteger(before)) {
          return c.json({ error: 'before must be an entry ID' }, 400)
        }

        return { before: before as EntryId }
      }),
      async (c) => {
        const { before } = c.req.valid('query')
        const page = await conversation.history(before, 50)

        // Pi's entries are already JSON, but their recursive types are too
        // deep for Hono to convert, so the client gets the page's own type.
        return c.json(page) as unknown as TypedResponse<
          HistoryPage,
          200,
          'json'
        >
      },
    )
    .post(
      '/messages',
      can('conversation.send'),
      // Only the shape here: `send` owns the bounds, for every caller.
      validator('json', (body, c) => {
        if (typeof body?.text !== 'string') {
          return c.json({ error: 'text is required' }, 400)
        }

        if (typeof body.requestId !== 'string') {
          return c.json({ error: 'requestId is required' }, 400)
        }

        return {
          text: body.text as string,
          requestId: body.requestId as string,
        }
      }),
      async (c) => {
        try {
          await conversation.send({
            author: c.get('author'),
            ...c.req.valid('json'),
          })
        } catch (error) {
          if (error instanceof MessageError) {
            return c.json({ error: error.message }, 400)
          }
          throw error
        }
        return c.body(null, 202)
      },
    )
    .post('/abort', can('conversation.abort'), async (c) => {
      await conversation.abort()
      return c.body(null, 202)
    })
    // The models the conversation may switch to.
    .get('/model/options', can('conversation.modelOptions'), (c) =>
      c.json(conversation.models()),
    )
    .put(
      '/model',
      can('conversation.setModel'),
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
      '/model/thinking-level',
      can('conversation.setThinkingLevel'),
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
