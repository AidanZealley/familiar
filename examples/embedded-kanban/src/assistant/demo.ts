import { summonFamiliar } from '@familiar-ai/core'
import { createHttpApi, type Operation } from '@familiar-ai/core/http'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { createFamiliarStore } from '@familiar-ai/client'
import { createBoard } from '../board/board.ts'
import { CURRENT_AUTHOR, seedTasks } from '../board/seed.ts'
import { boardPlugin } from './plugin.ts'
import { createScriptedModels, SCRIPTED_MODEL } from './script.ts'

const PERSONA = `You are Familiar, the assistant inside a team's task board. Help the person see and change the board with your tools. Refer to tasks by ID and title. Answer in short plain text.`

// Everyone signed in may talk, read history and watch the conversation.
const CHAT = new Set<Operation>([
  'conversation.send',
  'conversation.history',
  'conversation.abort',
  'events.conversation',
])

/**
 * Everything one page needs, all in memory: the host's board, a Familiar with
 * tools over it, the host's HTTP API, and a client store that talks to it.
 * Reloading the page starts again from the seed.
 *
 * Only the model is scripted. To use a real one, register a provider in
 * `models` on a server you control and serve this API from there, so
 * credentials never reach the browser.
 */
export async function startDemo() {
  const board = createBoard(seedTasks())
  const familiar = await summonFamiliar({
    storage: new MemoryStorage(),
    models: createScriptedModels(),
    model: SCRIPTED_MODEL,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    persona: PERSONA,
    plugins: [boardPlugin(board)],
  })
  const api = createHttpApi(familiar, {
    // Nobody signs in to this demo, so every request is from its one person.
    // That is a demo identity, not authentication: a real host checks each
    // request's session here.
    authenticate: () => CURRENT_AUTHOR,
    // Every other operation, such as memory, schedules or MCP, answers 403.
    allow: (_, operation) => CHAT.has(operation),
  })
  // In-page requests: the client's usual HTTP and SSE calls reach the API
  // without leaving the browser. A real host passes its API's URL instead.
  const store = createFamiliarStore('https://demo.invalid', {
    fetch: async (input, init) => api.fetch(new Request(input, init)),
  })
  return { board, familiar, store }
}

export type Demo = Awaited<ReturnType<typeof startDemo>>
