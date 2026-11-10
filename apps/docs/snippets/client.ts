import { createRoomStore, createWorkspaceStore } from '@familiar-ai/client'
import { getCurrentToken } from './host.ts'

const options = {
  // Every request, including stream reconnects, goes through this.
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    request.headers.set('Authorization', `Bearer ${await getCurrentToken()}`)
    return fetch(request)
  },
}
const api = 'https://your-host.example/api'

// The workspace: who the Familiars are, and the rooms this person sees.
const workspace = createWorkspaceStore(api, options)
const [familiar] = await workspace.familiars.list()

// This person's DM with the first Familiar.
const room = createRoomStore(
  api,
  await workspace.familiars.dm(familiar.id),
  options,
)

const unsubscribe = room.subscribe((state) => {
  console.log(state.connection, state.transcript?.items.length)
})

await room.send('Hello')

// On sign-out, or when this view goes away:
unsubscribe()
room.disconnect()
workspace.disconnect()
