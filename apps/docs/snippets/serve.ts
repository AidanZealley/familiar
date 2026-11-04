import type { Familiar } from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'
import { isOwner, sessionAuthor } from './host.ts'

// Everyone signed in talks to Familiar; only the owner signs it in.
export const createApi = (familiar: Familiar) =>
  createHttpApi(familiar, {
    authenticate: sessionAuthor,
    routes: {
      conversation: { send: true, history: true, abort: true },
      account: {
        signIn: isOwner,
        answerSignIn: isOwner,
        cancelSignIn: isOwner,
        signOut: isOwner,
      },
      events: { conversation: true, account: isOwner },
    },
  })

export type Api = ReturnType<typeof createApi>
