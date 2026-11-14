import { openWorkspace } from '@familiar-ai/core'
import { createHttpApi, type Operation } from '@familiar-ai/core/http'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'
import { createRoomStore } from '@familiar-ai/client'
import { createBoard } from '../board/board.ts'
import { CURRENT_AUTHOR, SEED_TASKS } from '../board/seed.ts'
import { boardPlugin } from './plugin.ts'
import { createScriptedModels, SCRIPTED_MODEL } from './script.ts'

const PERSONA = `You are Familiar, the assistant inside a team's task board. Help the person see and change the board with your tools. Refer to tasks by ID and title. Answer in short plain text.`

// Everyone signed in may talk in the board's room, read it and stop it.
const CHAT = new Set<Operation>([
  'rooms.post',
  'rooms.history',
  'rooms.stop',
  'events.room',
])

/**
 * Everything one page needs, all in memory: the host's board, a workspace
 * with one Familiar with tools over it and one room everyone talks in, the
 * host's HTTP API, and a client store for that room. Reloading the page
 * starts again from the seed.
 *
 * Only the model is scripted. To use a real one, register a provider in
 * `models` on a server you control and serve this API from there, so
 * credentials never reach the browser.
 */
export async function startDemo() {
  const board = createBoard(SEED_TASKS)
  const tools = boardPlugin(board)
  const workspace = await openWorkspace({
    storage: new MemoryStorage(),
    models: createScriptedModels(),
    chatModel: SCRIPTED_MODEL,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    plugins: [tools],
  })
  // A lasting host creates these once, on its store's first open.
  const familiar = await workspace.familiars.create({
    name: 'Familiar',
    persona: PERSONA,
    // Each Familiar opts in to the plugins it uses.
    capabilities: { plugins: [tools.name] },
  })
  const room = await workspace.rooms.create({
    name: 'Board',
    familiars: [familiar.id],
    lead: familiar.id,
  })
  const api = createHttpApi(workspace, {
    // Nobody signs in to this demo, so every request is from its one person.
    // That is a demo identity, not authentication: a real host checks each
    // request's session here.
    authenticate: () => CURRENT_AUTHOR,
    // Only the board's room. Every other operation, such as memory,
    // schedules or MCP, answers 403.
    allow: (_, operation, resource) =>
      CHAT.has(operation) &&
      resource !== undefined &&
      'room' in resource &&
      resource.room === room,
  })
  // In-page requests: the client's usual HTTP and SSE calls reach the API
  // without leaving the browser. A real host passes its API's URL instead.
  const store = createRoomStore('https://demo.invalid', room, {
    fetch: async (input, init) => api.fetch(new Request(input, init)),
  })
  return { board, workspace, store }
}

export type Demo = Awaited<ReturnType<typeof startDemo>>
