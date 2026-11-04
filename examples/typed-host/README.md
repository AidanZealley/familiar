# Typed host client example

A compile-checked example of a frontend typed from the Familiar routes its host mounts. It is a library integration fixture, not a running demo or server.

`host.ts` composes conversation and memory routes plus a conversation stream by hand, and selects participants' routes with `createHttpApi`. `api.ts` exports only types. `frontend.ts` creates the typed client and React bindings; `frontend.typecheck.ts` checks rejected API shapes. The constant author is sample attribution, not authentication.

From the repository root:

```sh
pnpm --filter @familiar-example/host typecheck
pnpm test:packages
```

The package check also compiles the frontend against packed packages outside the workspace.

Export the inferred Hono app type from the host through a type-only entry, then use it in the frontend:

```ts
import { createFamiliarStore } from '@familiar-ai/client'
import { createFamiliarBindings } from '@familiar-ai/client/react'
import type { HostApi } from './api.ts'

const store = createFamiliarStore<HostApi>('/api')
const { FamiliarProvider, useFamiliar, useTranscript } =
  createFamiliarBindings<HostApi>()
```

Keep route paths relative to the store URL and preserve the inferred app type instead of widening it to `Hono`. The type argument is required. Each client command is present only when the host has its route, with the standard inputs and a typed response. Streamed data is a separate choice: mounting memory commands does not make the event stream include memory.

The type argument narrows the public TypeScript API; it does not remove runtime handlers or enforce permissions. The host must authenticate requests and authorize actions. The caller owns store creation and `disconnect()`.
