import { openWorkspace, type Author } from '@familiar-ai/core'
import { createHttpApi, type Operation } from '@familiar-ai/core/http'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { createRoomStore } from '@familiar-ai/client'
import { PEOPLE } from '../people.ts'
import { guestListPlugin } from './plugin.ts'
import { createScriptedModels, SCRIPTED_MODEL } from './script.ts'

const PERSONA = `You are Familiar, the assistant in a group's shared chat. Several people talk to you in one room. Answer in short plain text.`

// Everyone signed in may talk in the group's room, read it and stop it.
const CHAT = new Set<Operation>([
  'rooms.post',
  'rooms.history',
  'rooms.stop',
  'events.room',
])

/**
 * One Familiar and one room the whole group talks in, with a signed-in
 * client for each person, all in this page's memory. Each client sends its
 * own session token and opens its own event stream, as each person's
 * browser would.
 *
 * Only the model is scripted. To use a real one, register a provider in
 * `models` on a server you control and serve this API from there, so
 * credentials never reach the browser.
 */
export async function startDemo() {
  const workspace = await openWorkspace({
    storage: new MemoryStorage(),
    models: createScriptedModels(),
    model: SCRIPTED_MODEL,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    plugins: [guestListPlugin()],
  })
  // A lasting host creates these once, on its store's first open.
  const familiar = await workspace.familiars.create({
    name: 'Familiar',
    persona: PERSONA,
  })
  const room = await workspace.rooms.create({
    name: 'Group',
    familiars: [familiar.id],
    lead: familiar.id,
  })
  // The host's sign-ins: session token to the person it belongs to.
  const sessions = new Map<string, Author>()
  const api = createHttpApi(workspace, {
    // Each request's session decides its author, never its body.
    authenticate: (request) => {
      const token = request.headers
        .get('authorization')
        ?.replace(/^Bearer /, '')
      return token ? sessions.get(token) : undefined
    },
    // Only the group's room. Every other operation, such as memory,
    // schedules or MCP, answers 403.
    allow: (_, operation, resource) =>
      CHAT.has(operation) &&
      resource !== undefined &&
      'room' in resource &&
      resource.room === room,
  })

  /** What the host does when a person signs in: a session, and a client for it. */
  const signIn = (author: Author) => {
    // getRandomValues, unlike randomUUID, works on plain-HTTP origins too.
    const token = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    sessions.set(token, author)
    // In-page requests: the client's usual HTTP and SSE calls reach the API
    // without leaving the browser. A real host passes its API's URL instead,
    // and the browser sends its session cookie.
    const store = createRoomStore('https://demo.invalid', room, {
      fetch: async (input, init) => {
        const request = new Request(input, init)
        request.headers.set('authorization', `Bearer ${token}`)
        return api.fetch(request)
      },
    })
    return { author, store }
  }

  return { workspace, clients: PEOPLE.map(signIn) }
}

export type Demo = Awaited<ReturnType<typeof startDemo>>
export type Client = Demo['clients'][number]
