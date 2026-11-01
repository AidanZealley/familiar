import type { EntryId } from '@earendil-works/pi-durable'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { Hono, type Context, type TypedResponse } from 'hono'
import { validator } from 'hono/validator'
import type { ConversationApi, HistoryPage } from './api.ts'
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

/** Message attribution comes only from the host, never the request body. */
export const conversationRoutes = (
  conversation: Pick<ConversationApi, 'send' | 'history' | 'abort'>,
  author: (context: Context) => string | Promise<string>,
) =>
  new Hono()
    // A page of entries older than `before`, newest first.
    .get(
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
        return c.json(page) as unknown as TypedResponse<
          HistoryPage,
          200,
          'json'
        >
      },
    )
    .post(
      '/messages',
      validator('json', (body, c) => {
        if (typeof body?.text !== 'string' || !body.text.trim()) {
          return c.json({ error: 'text is required' }, 400)
        }

        if (typeof body.requestId !== 'string' || !body.requestId) {
          return c.json({ error: 'requestId is required' }, 400)
        }

        return {
          text: body.text as string,
          requestId: body.requestId as string,
        }
      }),
      async (c) => {
        await conversation.send({
          author: await author(c),
          ...c.req.valid('json'),
        })
        return c.body(null, 202)
      },
    )
    .post('/abort', async (c) => {
      await conversation.abort()
      return c.body(null, 202)
    })
