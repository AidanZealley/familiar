# Type a frontend from its host API

A host can compose standard Familiar route factories and export the inferred
API type. The frontend imports `@familiar-ai/client`, optionally
`@familiar-ai/client/react`, and a type-only host module. It needs no direct
Hono import or dependency.

The compile-checked example is in [examples/typed-host](../examples/typed-host).
Its host uses the real `conversationRoutes(familiar, author)` callback API:

```ts
import { Hono } from 'hono'
import {
  conversationRoutes,
  memoryRoutes,
  eventRoutes,
} from '@familiar-ai/core/http'
import type { Familiar } from '@familiar-ai/core'

export const createHostApi = (familiar: Familiar) =>
  new Hono()
    .route(
      '/',
      conversationRoutes(familiar, () => ({
        id: 'owner',
        name: 'Example owner',
      })),
    )
    .route('/memory', memoryRoutes(familiar.memory))
    .route('/', eventRoutes({ conversation: familiar.watch }))

export type HostApi = ReturnType<typeof createHostApi>
```

The constant author is just for the example. Real hosts authenticate requests
with middleware and derive the author from their session. Mount the returned
app at the store URL, such as `/api`. Preserve the chained return value so
Hono retains its route schema.

Publish a separate type-only module with `export type { HostApi } from './host.js'`.
Its package export can be `{ "./api": { "types": "./dist/api.d.ts" } }`.
Generate the host declarations with TypeScript, and ship all declarations they
reference. There is no runtime entry for this export.

```ts
import { createFamiliarStore } from '@familiar-ai/client'
import { createFamiliarBindings } from '@familiar-ai/client/react'
import type { HostApi } from '@your-host/api'

export const store = createFamiliarStore<HostApi>('/api', { fetch })
export const { FamiliarProvider, useFamiliar, useTranscript } =
  createFamiliarBindings<HostApi>()

store.getState().conversation.send('Hello')
store.getState().memory.revise('fact-1', 'Corrected')
// No mcp or model commands in this host's public store type.
```

Create bindings once at module scope. Pass `store` explicitly to their provider.
Hooks select from that factory's nearest provider using Zustand subscriptions.
Each factory has its own context, so different host APIs can coexist. Stores
with different API types cannot be passed to the same typed provider. The
caller owns connection creation, replacement and `disconnect()`.

## Migration and limits

Existing `createFamiliarStore(url, options)`, `FamiliarStore`, `FamiliarProvider`,
`useFamiliar` and `useTranscript` retain the full standard API. Add the host type
argument and use the corresponding bindings factory to narrow a custom host.

This is a compile-time mounted-route check. It does not check authentication,
permissions, server availability, or which routes middleware might refuse.
There is no feature handshake or runtime permission list. The implementation
still creates the existing runtime handlers; narrowing hides commands in the
public TypeScript API, without removing them from JavaScript objects.

The supported contract is Familiar's standard paths relative to the store URL
and unchanged standard route schemas. Incompatible standard endpoint schemas,
unknown types, erased types and APIs with no recognized paths are rejected.
Nonstandard paths are ignored when accompanied by recognized paths and never
grant commands. Do not widen an inferred app to `Hono` or erase it to `any`.
A host that wraps handlers with additional typed response variants may need
to preserve a separate standard composition type rather than change the schema.

Checks derive endpoint contracts from `HttpApi`, not a second feature list.
Commands are exposed by complete route group: conversation, model, memory,
account, schedules, push, connections and MCP. Conversation and model are
independent even though their commands share `state.conversation`. A partial
group exposes none of that group's commands, including `loadOlder` for an
incomplete conversation group. This deliberately favors a small type definition
over a second method-to-endpoint registry.

Routes do not guarantee streamed sources. The example mounts memory commands
but streams only the conversation. Facts, episodes, schedules, account and
conversation view retain their existing optional types. Data groups remain
readable even when their commands are absent. Always handle missing stream data.
The client still attempts `/events`, so mount compatible `eventRoutes` for a live
connection. Generic typing alone does not promise a working stream.

`pnpm test:packages` packs the libraries and a generated host declaration package,
then compiles this frontend outside the workspace and bundles it for browsers.
The vanilla entry stays React-free. Model setup is described in the [core README](../packages/core/README.md).
