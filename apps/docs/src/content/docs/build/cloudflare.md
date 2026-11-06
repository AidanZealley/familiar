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

The factory returns everything `summonFamiliar` takes except storage, the clock and wake handling, which the adapter supplies. The adapter calls it each time the object opens, including after eviction. This scripted model answers once per object opening. A real host registers its provider, credentials, notifications and network policy there.

Configure a SQLite Durable Object binding and migration in Wrangler. The Cloudflare Worker example's [`wrangler.jsonc`](https://github.com/AidanZealley/familiar/blob/main/examples/cloudflare-worker/wrangler.jsonc) is a working configuration.

## Lifecycle

- Reach the assistant through `use()`. It arms recovery before any work starts.
- Don't call the assistant's `dismiss()` yourself.
- `terminate()` permanently refuses that object ID. Its history stays in storage.

While work is running, the adapter keeps a heartbeat alarm. While the assistant sleeps, the alarm is set for its next wake time, such as a reminder.

## Serving HTTP

Serve the API from the object's `fetch` handler, inside `use()`:

```ts
override fetch(request: Request) {
  return this.familiar.use((familiar) =>
    // Your Worker authenticated the request before routing it here.
    createHttpApi(familiar, {
      authenticate: () => author,
      // Your allowlist of operations, as in Serve the API.
      allow: (_, operation) => CHAT.has(operation),
    }).fetch(request),
  )
}
```

`author` is whoever your Worker authenticated. Decide what each person may do as in [Decide who may do what](/familiar/build/serve-the-api/#decide-who-may-do-what); `allow: () => true` allows everything, only when the object's owner is the only person who reaches it. Each object is one Familiar over its own storage, so give each tenant its own object, chosen from the authenticated session as in [One Familiar per tenant](/familiar/build/serve-the-api/#one-familiar-per-tenant). The repository's [Cloudflare Worker example](https://github.com/AidanZealley/familiar/tree/main/examples/cloudflare-worker) routes `/bots/<name>/api/*` to one object per name, behind one shared bearer token.

## What's been verified

Local workerd tests cover reminder delivery after eviction, recovery of an interrupted reply and persistent termination, all with scripted models. ChatGPT sign-in and real models on Workers haven't been verified.
