# @familiar-ai/cloudflare

Runs one Familiar in one SQLite-backed Cloudflare Durable Object. It owns storage, alarms and recovery after eviction. The [development Worker](../../apps/cloudflare/README.md) exercises it with scripted models. See [Host on Cloudflare](https://aidanzealley.github.io/familiar/build/cloudflare/) (publishes once GitHub Pages deployment is enabled).

```sh
npm install @familiar-ai/core @familiar-ai/cloudflare
```

Use this package only in Workers. Inside your Durable Object, construct the adapter and forward its alarm:

```ts
import { DurableObject } from 'cloudflare:workers'
import { DurableFamiliar } from '@familiar-ai/cloudflare'
import { authorizeSingleOwner } from '@familiar-ai/core'
import { createModels } from '@familiar-ai/core/models'
import {
  fauxProvider,
  fauxAssistantMessage,
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

This scripted model supplies one response per object opening. A lasting host configures its own provider, credentials, notifications, network policy and tool policy (`authorizeTool`) in the factory. Configure a SQLite Durable Object binding and migration in Wrangler; see the [working configuration](../../apps/cloudflare/wrangler.jsonc).

Reach the assistant through `use()` so recovery is armed before work starts, and don't call its `dismiss()`. `terminate()` permanently refuses that object ID while keeping history; `status()` reports lifecycle and alarm state.

Local workerd tests cover reminder delivery after eviction, interrupted-reply recovery and persistent termination. ChatGPT sign-in and real-model operation on Workers have not been verified.
