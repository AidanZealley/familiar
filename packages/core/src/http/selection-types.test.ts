import { Hono } from 'hono'
import { hc } from 'hono/client'
import type { BlankSchema, ExtractSchema } from 'hono/types'
import { expect, expectTypeOf, test } from 'vitest'
import type { Author } from '../conversation/message.ts'
import type { Familiar } from '../familiar.ts'
import {
  accountOperations,
  conversationOperations,
  createHttpApi,
  type HttpApi,
  type HttpRoutes,
} from './index.ts'

const sam: Author = { id: 'sam', name: 'Sam' }
const authenticate = () => sam

// Compile-time checks; the test only keeps them in the suite.
const selectionTypes = (familiar: Familiar) => {
  expectTypeOf<keyof NonNullable<HttpRoutes['conversation']>>().toEqualTypeOf<
    | 'send'
    | 'history'
    | 'abort'
    | 'modelOptions'
    | 'setModel'
    | 'setThinkingLevel'
  >()
  expectTypeOf<keyof NonNullable<HttpRoutes['account']>>().toEqualTypeOf<
    'state' | 'signIn' | 'answerSignIn' | 'cancelSignIn' | 'signOut'
  >()
  expectTypeOf<keyof HttpRoutes>().toEqualTypeOf<
    | 'conversation'
    | 'account'
    | 'memory'
    | 'schedules'
    | 'push'
    | 'connections'
    | 'mcp'
    | 'events'
  >()

  // A selection is exactly its routes, as composing them by hand gives.
  const sendOnly = createHttpApi(familiar, {
    authenticate,
    routes: { conversation: { send: true } },
  })
  const handMade = new Hono().route(
    '/',
    conversationOperations(familiar, () => sam).send,
  )
  expectTypeOf<ExtractSchema<typeof sendOnly>>().toEqualTypeOf<{
    '/messages': ExtractSchema<typeof handMade>['/messages']
  }>()
  // @ts-expect-error a precise schema, not any
  const anySchema: ExtractSchema<typeof sendOnly> = 1

  // Same path, different methods: both, merged, with typed inputs.
  const signIn = createHttpApi(familiar, {
    authenticate,
    // Checks get the authenticated author and request.
    routes: {
      account: {
        signIn: (author) => author.id === 'owner',
        cancelSignIn: async (_author, request) => request.method === 'DELETE',
        answerSignIn: true,
      },
    },
  })
  const account = hc<typeof signIn>('/').account
  account['sign-in'].$post()
  account['sign-in'].$delete()
  account['sign-in'].answer.$post({ json: { text: 'https://back.example' } })
  // @ts-expect-error inputs stay typed
  account['sign-in'].answer.$post({ json: { text: 1 } })
  // @ts-expect-error unselected
  account['sign-out'].$post()
  // @ts-expect-error unselected
  account.$get()
  const accountOnly = new Hono().route(
    '/account',
    accountOperations(undefined).signIn,
  )
  expectTypeOf<
    ExtractSchema<typeof signIn>['/account/sign-in']['$post']
  >().toEqualTypeOf<
    ExtractSchema<typeof accountOnly>['/account/sign-in']['$post']
  >()

  // No routes, and no stream without a source.
  const none = createHttpApi(familiar, { authenticate })
  expectTypeOf<ExtractSchema<typeof none>>().toEqualTypeOf<BlankSchema>()
  const empty = createHttpApi(familiar, {
    authenticate,
    routes: { events: {} },
  })
  // @ts-expect-error no sources, no stream
  hc<typeof empty>('/').events.$get()
  const events = createHttpApi(familiar, {
    authenticate,
    routes: { events: { account: true } },
  })
  hc<typeof events>('/').events.$get()
  expectTypeOf(
    createHttpApi(familiar, { authenticate, routes: true }),
  ).toEqualTypeOf<HttpApi>()

  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error misspelled operation
    routes: { conversation: { send: true, sned: true } },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error unknown group
    routes: { conversation: { send: true }, memroy: { health: true } },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error false isn't a selection
    routes: { conversation: { send: false } },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error no group-wide shorthand
    routes: { conversation: true },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error unknown event source
    routes: { events: { conversation: true, acount: true } },
  })
  createHttpApi(familiar, {
    authenticate,
    // @ts-expect-error checks return a boolean
    routes: { memory: { health: () => 'yes' } },
  })
  // Values above exist for their types.
  return [
    anySchema,
    sendOnly,
    handMade,
    signIn,
    accountOnly,
    none,
    empty,
    events,
  ]
}

test('selections type exactly what they mount', () => {
  expect(selectionTypes).toBeTypeOf('function')
})
