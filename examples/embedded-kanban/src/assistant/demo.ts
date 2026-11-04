import { summonFamiliar, type Author, type Familiar } from '@familiar-ai/core'
import { createHttpApi } from '@familiar-ai/core/http'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { createFamiliarStore } from '@familiar-ai/client'
import { createBoard, type Task } from '../board/board.ts'
import { boardPlugin } from './plugin.ts'
import { createScriptedModels, SCRIPTED_MODEL } from './script.ts'

const PERSONA = `You are Familiar, the assistant inside a team's task board. Help the person see and change the board with your tools. Refer to tasks by ID and title. Answer in short plain text.`

/**
 * The routes this page serves: sending, history and the conversation's event
 * stream. Every other route, such as memory, schedules, sign-in or MCP,
 * isn't mounted and answers 404.
 *
 * The demo has one fixed person and nobody signs in, so `authenticate`
 * names them for every request. That is a demo identity, not
 * authentication: a real host checks each request's session here.
 */
const createHostApi = (familiar: Familiar, author: Author) =>
  createHttpApi(familiar, {
    authenticate: () => author,
    routes: {
      conversation: { send: true, history: true, abort: true },
      events: { conversation: true },
    },
  })

export type HostApi = ReturnType<typeof createHostApi>

/**
 * Everything one page needs, all in memory: the host's board, a Familiar with
 * tools over it, the host's HTTP routes, and a client store that talks to
 * those routes. Reloading the page starts again from the seed.
 *
 * Only the model is scripted. To use a real one, register a provider in
 * `models` on a server you control and serve these routes from there, so
 * credentials never reach the browser.
 */
export async function startDemo({
  author,
  tasks,
}: {
  author: Author
  tasks: Task[]
}) {
  const board = createBoard(tasks)
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models: createScriptedModels(),
    model: SCRIPTED_MODEL,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    persona: PERSONA,
    plugins: [boardPlugin(board)],
    // The board tools never reach the network.
    fetch: async () => {
      throw new Error('This demo has no network access.')
    },
  })
  const api = createHostApi(familiar, author)
  // In-page requests: the client's usual HTTP and SSE calls reach the routes
  // without leaving the browser. A real host passes its API's URL instead.
  const store = createFamiliarStore<HostApi>('https://demo.invalid', {
    fetch: async (input, init) => api.fetch(new Request(input, init)),
  })
  return { author, board, familiar, api, store }
}

export type Demo = Awaited<ReturnType<typeof startDemo>>
