import type { EntryId } from '@earendil-works/pi-durable'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { Hono, type Context, type TypedResponse } from 'hono'
import { validator } from 'hono/validator'
import type { ConversationApi, HistoryPage } from './api.ts'
import { MessageError, type Author } from './message.ts'
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
 * The conversation's model and reasoning level, mounted at `/model`, one
 * route each. The current ones are in the view's `pi.agent` document.
 */
export const modelOperations = (conversation: ConversationApi) => ({
  // The models the conversation may switch to.
  modelOptions: new Hono().get('/options', (c) =>
    c.json(conversation.models()),
  ),
  setModel: new Hono().put(
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
  ),
  setThinkingLevel: new Hono().put(
    '/thinking-level',
    validator('json', (body, c) => {
      if (typeof body?.level !== 'string') {
        return c.json({ error: 'level is required' }, 400)
      }

      // setThinkingLevel refuses any level the current model doesn't offer.
      return { level: body.level as ModelThinkingLevel }
    }),
    (c) =>
      change(c, () => conversation.setThinkingLevel(c.req.valid('json').level)),
  ),
})

/** Every model route, mounted at `/model`. */
export const modelRoutes = (conversation: ConversationApi) => {
  const model = modelOperations(conversation)
  return new Hono()
    .route('/', model.modelOptions)
    .route('/', model.setModel)
    .route('/', model.setThinkingLevel)
}

/**
 * Sending, history and aborting, one route each. Message attribution comes
 * only from the host, never the request body.
 */
export const conversationOperations = (
  conversation: Pick<ConversationApi, 'send' | 'history' | 'abort'>,
  author: (context: Context) => Author | Promise<Author>,
) => ({
  // A page of entries older than `before`, newest first.
  history: new Hono().get(
    '/history',
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
      return c.json(page) as unknown as TypedResponse<HistoryPage, 200, 'json'>
    },
  ),
  send: new Hono().post(
    '/messages',
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
          author: await author(c),
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
  ),
  abort: new Hono().post('/abort', async (c) => {
    await conversation.abort()
    return c.body(null, 202)
  }),
})

/** Sending, history and aborting, mounted together. */
export const conversationRoutes = (
  conversation: Pick<ConversationApi, 'send' | 'history' | 'abort'>,
  author: (context: Context) => Author | Promise<Author>,
) => {
  const operations = conversationOperations(conversation, author)
  return new Hono()
    .route('/', operations.history)
    .route('/', operations.send)
    .route('/', operations.abort)
}
