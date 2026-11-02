import type { Familiar } from '@familiar-ai/core'
import {
  conversationRoutes,
  eventRoutes,
  memoryRoutes,
} from '@familiar-ai/core/http'
import { Hono } from 'hono'
import type { Author } from '@familiar-ai/core'
import { sessionAuthor } from './host.ts'

// Conversation and memory only: no account, schedules, push or MCP routes.
export const createHostApi = (familiar: Familiar) =>
  new Hono<{ Variables: { author: Author } }>()
    .use(async (c, next) => {
      const author = await sessionAuthor(c.req.raw)
      if (!author) {
        return c.json({ error: 'unauthorized' }, 401)
      }
      c.set('author', author)
      await next()
    })
    .route(
      '/',
      conversationRoutes(familiar, (c) => c.get('author')),
    )
    .route('/memory', memoryRoutes(familiar.memory))
    .route(
      '/',
      eventRoutes({
        conversation: familiar.watch,
        memory: familiar.memory.watch,
      }),
    )

export type HostApi = ReturnType<typeof createHostApi>
