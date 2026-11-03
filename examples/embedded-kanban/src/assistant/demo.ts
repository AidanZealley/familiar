import { summonFamiliar, type Author, type Familiar } from '@familiar-ai/core'
import { conversationRoutes, eventRoutes } from '@familiar-ai/core/http'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { createFamiliarStore } from '@familiar-ai/client'
import { Hono } from 'hono'
import { createBoard, type Task } from '../board/board.ts'
import { boardPlugin } from './plugin.ts'
import { createScriptedModels, SCRIPTED_MODEL } from './script.ts'

const PERSONA = `You are Familiar, the assistant inside a team's task board. Help the person see and change the board with your tools. Refer to tasks by ID and title. Answer in short plain text.`

/** The routes this page serves: the conversation and its event stream. */
const createHostApi = (familiar: Familiar, author: Author) =>
  new Hono()
    .route(
      '/',
      conversationRoutes(familiar, () => author),
    )
    .route('/', eventRoutes({ conversation: familiar.watch }))

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
  return { author, board, familiar, store }
}

export type Demo = Awaited<ReturnType<typeof startDemo>>
