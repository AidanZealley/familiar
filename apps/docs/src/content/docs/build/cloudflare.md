---
title: Host on Cloudflare
description: Run one Familiar workspace in a SQLite-backed Cloudflare Durable Object.
---

`@familiar-ai/cloudflare` runs one workspace inside one Durable Object. It owns the object's SQLite storage, its alarm and recovery after the object is evicted.

```sh
npm install @familiar-ai/core @familiar-ai/cloudflare
```

## The Durable Object

Construct `DurableWorkspace` with a factory for the workspace's options, and forward the object's alarm to it:

```ts
import { DurableObject } from 'cloudflare:workers'
import { DurableWorkspace } from '@familiar-ai/cloudflare'
import { fauxAssistantMessage } from '@familiar-ai/core/models/faux'
import { scriptedModels } from '@familiar-ai/core/models/scripted'

export class Bot extends DurableObject {
  readonly workspace = new DurableWorkspace(this.ctx, {
    workspace: () => ({
      models: scriptedModels(() =>
        fauxAssistantMessage('Hello from a Worker.'),
      ),
      model: { provider: 'faux', modelId: 'faux-1' },
      timeZone: 'Europe/London',
    }),
    // After each open: make its Familiar the first time.
    setup: async (workspace) => {
      if (!(await workspace.familiars.list()).length) {
        await workspace.familiars.create({ name: 'Bot' })
      }
    },
  })

  override alarm() {
    return this.workspace.alarm()
  }

  async greet() {
    return this.workspace.use(async (workspace) => {
      const [familiar] = await workspace.familiars.list()
      const dm = await workspace.rooms.get(
        await workspace.rooms.dm(familiar.id, 'owner'),
      )
      return dm!.post({
        author: { id: 'owner', name: 'Sam' },
        text: 'Hello',
        requestId: crypto.randomUUID(),
      })
    })
  }
}
```

The factory returns everything `openWorkspace` takes except storage, the clock and wake handling, which the adapter supplies. The adapter calls it each time the object opens, including after eviction, then `setup`, before any request or alarm reaches the workspace. This scripted model answers every request alike. A real host registers its provider, credentials, notifications and network policy in the factory, and makes its Familiars and rooms in `setup`.

Configure a SQLite Durable Object binding and migration in Wrangler. The Cloudflare Worker example's [`wrangler.jsonc`](https://github.com/AidanZealley/familiar/blob/main/examples/cloudflare-worker/wrangler.jsonc) is a working configuration.

## Lifecycle

- Reach the workspace through `use()`. It arms recovery before any work starts.
- Don't call the workspace's `dismiss()` yourself.
- `terminate()` permanently refuses that object ID. Its history stays in storage.

While work is running, the adapter keeps a heartbeat alarm, so work a lost process left resumes soon; `heartbeatMs` sets how often, default one minute. While the workspace sleeps, the alarm is set for its next wake time, such as a reminder.

## Serving HTTP

Serve the API from the object's `fetch` handler, inside `use()`:

```ts
override fetch(request: Request) {
  return this.workspace.use((workspace) =>
    // Your Worker authenticated the request before routing it here.
    createHttpApi(workspace, {
      authenticate: () => author,
      // Your allowlist of operations, as in Serve the API.
      allow: (_, operation) => CHAT.has(operation),
    }).fetch(request),
  )
}
```

`author` is whoever your Worker authenticated. Decide what each person may do as in [Decide who may do what](/familiar/build/serve-the-api/#decide-who-may-do-what); `allow: () => true` allows everything, only when the object's owner is the only person who reaches it. Each object is one workspace over its own storage, so give each tenant its own object, chosen from the authenticated session as in [One workspace per tenant](/familiar/build/serve-the-api/#one-workspace-per-tenant). The repository's [Cloudflare Worker example](https://github.com/AidanZealley/familiar/tree/main/examples/cloudflare-worker) routes `/bots/<name>/api/*` to one object per name, behind one shared bearer token.

## What's been verified

Local workerd tests cover reminder delivery, whether the object was evicted or stayed in memory, recovery of an interrupted reply and persistent termination, all with scripted models. ChatGPT sign-in and real models on Workers haven't been verified.
