# @familiar-ai/client

Browser-safe live stores for Familiar's HTTP/SSE API: one for the workspace, one per Familiar and one per room, with a room's derived chat transcript and optional React bindings. Familiar's web app uses the same API available to embedded clients.

Guide and reference: [Connect a frontend](https://aidanzealley.github.io/familiar/build/connect-a-frontend/) and the [client API](https://aidanzealley.github.io/familiar/reference/client/) (the site publishes once GitHub Pages deployment is enabled).

```sh
npm install @familiar-ai/client
```

```ts
import { createRoomStore, createWorkspaceStore } from '@familiar-ai/client'

// Who the Familiars are and which rooms this person sees, live.
const workspace = createWorkspaceStore('/api')
const [familiar] = await workspace.familiars.list()

// This person's DM with it.
const room = createRoomStore('/api', await workspace.familiars.dm(familiar.id))
const unsubscribe = room.subscribe((state) => {
  console.log(state.connection, state.transcript?.items)
})
await room.send('Hello')
// When these connections are no longer needed:
unsubscribe()
room.disconnect()
workspace.disconnect()
```

`createFamiliarStore('/api', id)` mirrors one Familiar's model, memory and schedules. `composeMessage` turns names picked in a composer into `@Name` text with the mentions that address them, for `room.send(text, mentions)`.

The host assigns the message author. Pass `{ fetch }` to attach credentials to every request, including stream reconnects. `unauthorized`, `failed` and `outdated` connections stop retrying; disconnect and create a new store after those, after sign-out or after an identity change. The library never reloads the page.

Commands live on the stores, and their state is plain data. Every command is present; one the host's `allow` refuses rejects with its 403. React 18 or 19 bindings for a room, `RoomProvider`, `useRoom` and `useRoomStore`, come from `@familiar-ai/client/react`; use zustand's `useStore` for the others. The vanilla entry loads neither React nor core's server runtime.
