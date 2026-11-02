import type { Familiar } from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'
import { Hono } from 'hono'
import { sessionAuthor } from './host.ts'

export const createServer = (familiar: Familiar) =>
  new Hono().route(
    '/api',
    createHttpApi(familiar, { authenticate: sessionAuthor }),
  )
