# @familiar-ai/core

One assistant with one continuing conversation, memory, schedules and tools, built on Pi Durable. The Familiar daemon and Cloudflare host both use this package; it does not start a server or render a UI.

Guides and reference: [Build with Familiar](https://aidanzealley.github.io/familiar/build/overview/) and the [core API](https://aidanzealley.github.io/familiar/reference/core/) (the site publishes once GitHub Pages deployment is enabled).

```sh
npm install @familiar-ai/core
```

## Try it without a provider

This runs the real assistant with a scripted response and disposable storage. It needs no credentials or network.

```ts
import { summonFamiliar } from '@familiar-ai/core'
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

const familiar = await summonFamiliar({
  storage: new MemoryStorage(),
  models,
  model: { provider: 'faux', modelId: 'demo' },
  timeZone: 'Europe/London',
})
try {
  await familiar.send({
    author: { id: 'person-123', name: 'Sam' },
    text: 'Hello',
    requestId: crypto.randomUUID(),
  })
  await familiar.idle()
} finally {
  await familiar.dismiss()
}
```

A lasting host supplies persistent storage (Pi Durable's SQLite storage on Node, at the exact Pi version in the [workspace catalog](../../pnpm-workspace.yaml), or [@familiar-ai/cloudflare](../cloudflare/README.md) on Workers), registered model providers with a credential store, and an `authenticate` function when it serves HTTP. Only one live Familiar may own a storage. Attribution is not authorization: hosts authenticate people and check permission for tool actions.

Public entry points are `/http`, `/models`, `/models/openai`, `/models/openrouter`, `/models/faux`, `/storage/memory`, `/extensions`, `/mcp` and `/diagnostics`; see [package exports](package.json). Core contains no Node-only or Workers-only code.
