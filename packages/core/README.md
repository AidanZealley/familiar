# @familiar-ai/core

A workspace of assistants, built on Pi Durable: Familiars, each with its own memory, schedules and one continuing working context, and rooms where people talk to them, a DM with one Familiar or a named room with several. The Familiar daemon and Cloudflare host both use this package; it does not start a server or render a UI.

Guides and reference: [Build with Familiar](https://aidanzealley.github.io/familiar/build/overview/) and the [core API](https://aidanzealley.github.io/familiar/reference/core/) (the site publishes once GitHub Pages deployment is enabled).

```sh
npm install @familiar-ai/core
```

## Try it without a provider

This runs the real assistant with a scripted response and disposable storage. It needs no credentials or network.

```ts
import { openWorkspace } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import {
  fauxProvider,
  fauxAssistantMessage,
} from '@familiar-ai/core/models/faux'
import { MemoryStorage } from '@familiar-ai/core/storage/memory'

const faux = fauxProvider({ models: [{ id: 'demo' }] })
const models = createModels()
models.setProvider(faux.provider)
faux.setResponses([fauxAssistantMessage('Hello, Sam.')])

const workspace = await openWorkspace({
  storage: new MemoryStorage(),
  models,
  chatModel: { provider: 'faux', modelId: 'demo' },
  timeZone: 'Europe/London',
})
try {
  const familiar = await workspace.familiars.create({ name: 'Familiar' })
  const dm = (await workspace.rooms.get(
    await workspace.rooms.dm(familiar.id, 'person-123'),
  ))!
  await dm.post({
    author: { id: 'person-123', name: 'Sam' },
    text: 'Hello',
    requestId: crypto.randomUUID(),
  })
  // The room's log: the message now, the reply once the turn ends.
  const watch = await dm.watch()
  watch.start(async (view) => console.log(view.entries.at(-1)?.data))
} finally {
  await workspace.dismiss()
}
```

A lasting host supplies persistent storage (Pi Durable's SQLite storage on Node, at the exact Pi version in the [workspace catalog](../../pnpm-workspace.yaml), or [@familiar-ai/cloudflare](../cloudflare/README.md) on Workers), registered model providers with a credential store, and an `authenticate` function when it serves HTTP. Only one live workspace may own a storage. Familiars and rooms live in the storage, so a host creates them once, on the first open. Attribution is not authorization: hosts authenticate people, decide who may do what with `createHttpApi`'s `allow`, which is told the Familiar or room each operation is about, and choose each room's audience and each workspace's tools:

```ts
const CHAT = new Set<Operation>([
  'rooms.post',
  'rooms.history',
  'rooms.stop',
  'events.room',
])

const api = createHttpApi(workspace, {
  authenticate: sessionAuthor,
  // Only the room everyone signed in shares.
  allow: (_, operation, resource) =>
    CHAT.has(operation) &&
    !!resource &&
    'room' in resource &&
    resource.room === sharedRoom,
})
```

`allow: () => true` allows everything, only for hosts that only their owner can reach. Everyone who reads a room sees what its Familiars say there, which can draw on anything they remember, and a Familiar carries what it learns in one room into the others. Every tool installed on the workspace is every Familiar's. Tools, or the app APIs behind them, enforce narrower rules with `familiar(context).author()`, the person a call runs for. Separate audiences, such as tenants, need separate workspaces over separate storage. Native tools are trusted code running in your process; Familiar doesn't sandbox them.

Public entry points are `/http`, `/models`, `/models/openai`, `/models/openrouter`, `/models/faux`, `/storage/memory`, `/extensions` and `/diagnostics`; see [package exports](package.json). Core contains no Node-only or Workers-only code.
