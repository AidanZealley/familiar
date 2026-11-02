# @familiar-ai/core

One assistant with one continuing conversation, memory, schedules and tools, built on Pi Durable. The Familiar daemon and Cloudflare host both use this package; it does not start a server or render a UI.

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
  const watch = await familiar.watch()
  console.log(watch.value)
  await watch.stop()
} finally {
  await familiar.dismiss()
}
```

`MemoryStorage` loses everything when discarded. Persistent Node hosts currently use `openNodeSqliteStorage` from `@earendil-works/pi-durable/storage/sqlite/node`, at the exact Pi version in the [workspace catalog](../../pnpm-workspace.yaml). Workers use [@familiar-ai/cloudflare](../cloudflare/README.md). Only one live Familiar may own a storage.

## Models and sign-in

`createModels` does not register providers. Register `openaiProvider()` from `@familiar-ai/core/models/openai` or `openrouterProvider()` from `/models/openrouter` explicitly. Pass a host-owned `CredentialStore` to `createModels({ credentials })`; the provider reads and refreshes credentials there. The daemon's [file store](../../apps/daemon/src/credentials.ts) is a persistent Node example.

For ChatGPT sign-in, create an account over that same models instance:

```ts
import { createAccount } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import { openaiProvider } from '@familiar-ai/core/models/openai'

const models = createModels({ credentials }) // Your persistent CredentialStore.
models.setProvider(openaiProvider())
const account = await createAccount({
  models,
  provider: 'openai',
  login: { getDeviceId: deviceId, agentName: 'Familiar' },
})
```

Here `deviceId` is the host's function returning its stable installation ID. Pass `account`, `models`, storage, `timeZone` and `model: { provider: 'openai', modelId: 'gpt-6.1-sol' }` to `summonFamiliar`. The account exposes sign-in state and actions through `account.api`, then through `familiar.account`. Familiar owns an attached account and closes it on dismissal. Without an account, the host manages credentials itself. Do not put provider credentials in frontend code.

## Serve a client

```ts
import { createHttpApi } from '@familiar-ai/core/http'

const api = createHttpApi(familiar, {
  authenticate: async (request) => sessionAuthor(request),
})
// Mount api.fetch at your server's /api path, stripping that prefix.
```

`sessionAuthor` is your authentication code, returning `{ id, name }` or `undefined` to refuse access. The adapter authenticates every route. The daemon instead supplies a fixed owner and trusts its private network endpoint. Message bodies cannot choose their author. Attribution is not authorization; check permission for tool actions in host code.

For separate access policies, compose the exported Hono route factories. See the [typed host guide](../../docs/typed-host-client.md). Route groups and streamed sources are separate choices.

## Host responsibilities

The host supplies storage, models, credentials, an IANA time zone and any notifications. `persona` replaces the default identity text completely; include the assistant's name and UI capabilities if needed. Core adds instructions for its own capabilities. `chatModels` controls available model and reasoning choices and must include `model`, which also drives memory upkeep.

Plugins receive the host's `fetch` and destination-bound `authorizedFetch`. Hosts with private-network access must block private, loopback and tailnet destinations at connection time and on redirects. Secrets live in the host's `SecretStore`; authenticated responses and tool output are not scrubbed. Owner-configured MCP endpoints use a separate `mcpFetch`; local commands need a host `mcpStdio` factory. See [MCP setup](../../docs/usage.md#mcp-connections).

Ordinary hosts use in-process timers. Evictable hosts supply `onWake`, arm recovery before work starts and call `resume()` on wakeup. Prefer the Cloudflare adapter for Durable Objects.

## Plugins

Import authoring helpers from Familiar rather than installing another Pi copy:

```ts
import { definePlugin, defineTool, Type } from '@familiar-ai/core'

export const greeting = definePlugin({
  name: 'greeting',
  title: 'Greeting',
  extension: () => ({
    tools: [
      defineTool({
        name: 'greet',
        description: 'Greet the person who asked.',
        parameters: Type.Object({}),
        replay: 'safe',
        execute: async (_args, api) => ({
          output: [
            { type: 'text', text: `Hello, ${api.author?.name ?? 'there'}.` },
          ],
        }),
      }),
    ],
  }),
})
```

Pass plugins in `summonFamiliar({ ...options, plugins: [greeting] })`. `api.author` follows the persisted initiating message, including scheduled work with a creator; background work can have no author. Replay defaults to unsafe. Mark a tool safe only when repeating its external effects is safe. Forward the execution context's `abortSignal` to cancellable work.

Optional JSON-safe tool `details` reaches the client's `ToolCall.details`; clients must narrow it before rendering. Text output remains the fallback. Advanced tasks, hooks, documents and extension helpers are exported from `@familiar-ai/core/extensions`. These contracts follow the bundled Pi version, not a separate compatibility layer. Hosts never receive Familiar's running Harness.

## Boundaries and further reading

Core contains no Node-only storage or subprocess code. Source core with faux models and MemoryStorage has run in Chrome, including HTTP/SSE and the client. That does not establish real-provider browser support or published-artifact compatibility. Workers-specific code belongs in the Cloudflare package.

[Memory](../../docs/memory.md) explains recall and nightly upkeep. [Time zone changes](../../docs/usage.md#changing-time-zone) covers reopening existing storage in another zone. Public entry points also include `/http`, `/diagnostics`, `/mcp`, `/extensions`, `/models` and `/storage/memory`; see [package exports](package.json).
