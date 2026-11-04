import type { Familiar } from '@familiar-ai/core'
import { createHttpApi, type Operation } from '@familiar-ai/core/http'
import { isOwner, sessionAuthor } from './host.ts'

// What anyone signed in may do: talk, read history, watch the conversation.
const CHAT = new Set<Operation>([
  'conversation.send',
  'conversation.history',
  'conversation.abort',
  'events.conversation',
])

// What only the owner may do on top of that: sign Familiar in and out.
const OWNER = new Set<Operation>([
  'account.signIn',
  'account.answerSignIn',
  'account.cancelSignIn',
  'account.signOut',
  'events.account',
])

export const createApi = (familiar: Familiar) =>
  createHttpApi(familiar, {
    authenticate: sessionAuthor,
    allow: (author, operation) =>
      CHAT.has(operation) || (OWNER.has(operation) && isOwner(author)),
  })
