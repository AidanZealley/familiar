import { summonFamiliar, type Author, type Familiar } from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { createFamiliarStore, type FamiliarStore } from '@familiar-ai/client'
import { guestListPlugin } from './plugin.ts'
import { createScriptedModels, SCRIPTED_MODEL } from './script.ts'

const PERSONA = `You are Familiar, the assistant in a group's shared chat. Several people talk to you in one conversation. Answer in short plain text.`

/**
 * The host's routes: sending, history and the conversation's event stream,
 * behind the host's own sign-in. Each request's session decides its author,
 * never its body. Everyone signed in shares the conversation and its history.
 */
const createHostApi = (familiar: Familiar, sessions: Map<string, Author>) =>
  createHttpApi(familiar, {
    authenticate: (request) => {
      const token = request.headers
        .get('authorization')
        ?.replace(/^Bearer /, '')
      return token ? sessions.get(token) : undefined
    },
    routes: {
      conversation: { send: true, history: true, abort: true },
      events: { conversation: true },
    },
  })

export type HostApi = ReturnType<typeof createHostApi>

/**
 * One Familiar and its one conversation, with a signed-in client for each
 * person, all in this page's memory. Each client sends its own session token
 * and opens its own event stream, as each person's browser would.
 *
 * Only the model is scripted. To use a real one, register a provider in
 * `models` on a server you control and serve these routes from there, so
 * credentials never reach the browser.
 */
export async function startDemo(people: Author[]) {
  // The host's sign-ins: session token to the person it belongs to.
  const sessions = new Map<string, Author>()
  const signedIn = (id: string) =>
    [...sessions.values()].some((author) => author.id === id)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models: createScriptedModels(),
    model: SCRIPTED_MODEL,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    // Asked as each tool runs, so someone who has signed out can't run tools
    // through a message they sent earlier.
    authorizeTool: ({ invoker }) =>
      invoker.kind === 'person' && signedIn(invoker.author.id),
    persona: PERSONA,
    plugins: [guestListPlugin()],
    // The guest list tools never reach the network.
    fetch: async () => {
      throw new Error('This demo has no network access.')
    },
  })
  const api = createHostApi(familiar, sessions)
  const stores: FamiliarStore<HostApi>[] = []

  /** What the host does when a person signs in: a session, and a client for it. */
  const signIn = (author: Author) => {
    // getRandomValues, unlike randomUUID, works on plain-HTTP origins too.
    const token = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    sessions.set(token, { id: author.id, name: author.name })
    // In-page requests: the client's usual HTTP and SSE calls reach the routes
    // without leaving the browser. A real host passes its API's URL instead,
    // and the browser sends its session cookie.
    const store = createFamiliarStore<HostApi>('https://demo.invalid', {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        request.headers.set('authorization', `Bearer ${token}`)
        return api.fetch(request)
      },
    })
    stores.push(store)
    return { sessionId: token, author, store }
  }

  const clients = people.map(signIn)
  return {
    familiar,
    clients,
    signIn,
    /** Closes every client's stream, ends the sessions and Familiar. */
    stop: async () => {
      for (const store of stores) {
        store.getState().disconnect()
      }
      sessions.clear()
      await familiar.dismiss()
    },
  }
}

export type Demo = Awaited<ReturnType<typeof startDemo>>
export type Client = Demo['clients'][number]
