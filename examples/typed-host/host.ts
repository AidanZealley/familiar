import { Hono, type Env } from 'hono'
import type { ExtractSchema } from 'hono/types'
import { validator } from 'hono/validator'
import {
  conversationRoutes,
  eventRoutes,
  memoryRoutes,
} from '@familiar-ai/core/http'
import type { Familiar } from '@familiar-ai/core'

export const createHostApi = (familiar: Familiar) =>
  new Hono()
    .route(
      '/',
      conversationRoutes(familiar, () => ({
        id: 'owner',
        name: 'Example owner',
      })),
    )
    .route('/memory', memoryRoutes(familiar.memory))
    .route('/', eventRoutes({ conversation: familiar.watch }))

export type HostApi = ReturnType<typeof createHostApi>

export const createPartialApi = (familiar: Familiar) =>
  new Hono()
    .route(
      '/',
      conversationRoutes(familiar, () => ({
        id: 'owner',
        name: 'Example owner',
      })),
    )
    .get('/memory/health', async (c) => c.json(await familiar.memory.health()))

export type PartialApi = ReturnType<typeof createPartialApi>
export type NonstandardApi = ReturnType<typeof createNonstandardApi>
export const createNonstandardApi = (familiar: Familiar) =>
  new Hono().route(
    '/chat',
    conversationRoutes(familiar, () => ({
      id: 'owner',
      name: 'Example owner',
    })),
  )
export const createIncompatibleApi = () =>
  new Hono().post('/messages', (c) => c.json({ unsupported: true }))
export type IncompatibleApi = ReturnType<typeof createIncompatibleApi>

export type WidenedApi = Hono

export const createNarrowInputApi = () =>
  new Hono().post(
    '/messages',
    validator('json', () => ({ text: '', requestId: '', extraRequired: '' })),
    (c) => c.body(null, 202),
  )
export type NarrowInputApi = ReturnType<typeof createNarrowInputApi>

export const createPartialConversationApi = () =>
  new Hono().post(
    '/messages',
    validator('json', () => ({ text: '', requestId: '' })),
    (c) => c.body(null, 202),
  )
export type PartialConversationApi = ReturnType<
  typeof createPartialConversationApi
>

// Simulate a host declaration that loses only one endpoint's response type.
type HostSchema = ExtractSchema<HostApi>
export type ErasedOutputApi = Hono<
  Env,
  Omit<HostSchema, '/memory/health'> & {
    '/memory/health': {
      $get: Omit<HostSchema['/memory/health']['$get'], 'output'> & {
        output: ReturnType<typeof JSON.parse>
      }
    }
  }
>
