import type { Workspace } from '@familiar-ai/core'
import { createHttpApi, type Operation } from '@familiar-ai/core/http'
import { isOwner, sessionAuthor } from './host.ts'

// What anyone signed in may do: find the Familiars and rooms, open their
// own DMs, talk in rooms and mark them read, and see who they are.
const CHAT = new Set<Operation>([
  'familiars.list',
  'familiars.dm',
  'rooms.list',
  'rooms.post',
  'rooms.read',
  'rooms.history',
  'rooms.stop',
  'events.familiars',
  'events.rooms',
  'events.me',
  'events.room',
])

// What only the owner may do on top of that: sign Familiar in and out.
const OWNER = new Set<Operation>([
  'account.signIn',
  'account.answerSignIn',
  'account.cancelSignIn',
  'account.signOut',
  'events.account',
])

export const createApi = (workspace: Workspace) =>
  createHttpApi(workspace, {
    authenticate: sessionAuthor,
    // Familiar keeps each DM to its person; anyone signed in shares the
    // named rooms.
    allow: (author, operation) =>
      CHAT.has(operation) || (OWNER.has(operation) && isOwner(author)),
  })
