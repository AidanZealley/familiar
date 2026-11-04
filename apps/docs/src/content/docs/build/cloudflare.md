---
title: Host on Cloudflare
description: Run one Familiar in a SQLite-backed Cloudflare Durable Object.
---

`@familiar-ai/cloudflare` runs one Familiar inside one Durable Object. It owns the object's SQLite storage, its alarm and recovery after the object is evicted.

```sh
npm install @familiar-ai/core @familiar-ai/cloudflare
```

## The Durable Object

Construct `DurableFamiliar` with a factory for the assistant's options, and forward the object's alarm to it:

```ts
import { DurableObject } from 'cloudflare:workers'
import { DurableFamiliar } from '@familiar-ai/cloudflare'
import { authorizeSingleOwner } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import {
  fauxAssistantMessage,
  fauxProvider,
} from '@familiar-ai/core/models/faux'

export class Bot extends DurableObject {
  readonly familiar = new DurableFamiliar(this.ctx, {
    familiar: () => {
      const faux = fauxProvider({ models: [{ id: 'demo' }] })
      const models = createModels()
      models.setProvider(faux.provider)
      faux.setResponses([fauxAssistantMessage('Hello from a Worker.')])
      return {
        models,
        model: { provider: 'faux', modelId: 'demo' },
        timeZone: 'Europe/London',
        // One owner per object, who may run every tool.
        authorizeTool: authorizeSingleOwner,
      }
    },
  })

  override alarm() {
    return this.familiar.alarm()
  }

  async greet() {
    return this.familiar.use((assistant) =>
      assistant.send({
        author: { id: 'owner', name: 'Sam' },
        text: 'Hello',
        requestId: crypto.randomUUID(),
      }),
    )
  }
}
```

The factory returns everything `summonFamiliar` takes except storage, the clock and wake handling, which the adapter supplies. That includes `authorizeTool`: pass your own policy when more than the owner can reach the object. See [Identity is not permission](/familiar/build/serve-the-api/#identity-is-not-permission). The adapter calls it each time the object opens, including after eviction. This scripted model answers once per object opening. A real host registers its provider, credentials, notifications and network policy there.

Configure a SQLite Durable Object binding and migration in Wrangler. The development Worker's [`wrangler.jsonc`](https://github.com/AidanZealley/familiar/blob/main/apps/cloudflare/wrangler.jsonc) is a working configuration.

## Lifecycle

- Reach the assistant through `use()`. It arms recovery before any work starts.
- Don't call the assistant's `dismiss()` yourself.
- `status()` reports the lifecycle and alarm state.
- `terminate()` permanently refuses that object ID. Its history stays in storage.

While work is running, the adapter keeps a heartbeat alarm. While the assistant sleeps, the alarm is set for its next wake time, such as a reminder.

The package also exports `openDurableObjectSqliteStorage`, `DurableObjectSqliteDatabase` and `SqliteStorage` for hosts that manage the lifecycle themselves. Prefer `DurableFamiliar` unless you need that control.

## Serving HTTP

Serve the API from the object's `fetch` handler, inside `use()`:

```ts
override fetch(request: Request) {
  return this.familiar.use((familiar) =>
    // Your Worker authenticated the request before routing it here.
    createHttpApi(familiar, {
      authenticate: () => author,
      routes: { conversation: { send: true, history: true, abort: true } },
    }).fetch(request),
  )
}
```

`author` is whoever your Worker authenticated. Choose the routes as in [Choose routes](/familiar/build/serve-the-api/#choose-routes); `routes: true` serves everything, only when the object's owner is the only person who reaches it. The repository's [development Worker](https://github.com/AidanZealley/familiar/tree/main/apps/cloudflare) routes `/bots/<name>/api/*` to one object per name, behind a bearer token.

## What's been verified

Local workerd tests cover reminder delivery after eviction, recovery of an interrupted reply and persistent termination, all with scripted models. ChatGPT sign-in and real models on Workers haven't been verified.
