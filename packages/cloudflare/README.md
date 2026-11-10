# @familiar-ai/cloudflare

Runs one Familiar workspace in one SQLite-backed Cloudflare Durable Object. It owns storage, alarms and recovery after eviction. The [Cloudflare Worker example](../../examples/cloudflare-worker/README.md) hosts it with a scripted model. See [Host on Cloudflare](https://aidanzealley.github.io/familiar/build/cloudflare/) (publishes once GitHub Pages deployment is enabled).

```sh
npm install @familiar-ai/core @familiar-ai/cloudflare
```

Use this package only in Workers. Inside your Durable Object, construct the adapter and forward its alarm:

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

This scripted model answers every request alike. A lasting host configures its own provider, credentials, notifications, network policy and tools in the factory, and its Familiars and rooms in `setup`. Configure a SQLite Durable Object binding and migration in Wrangler; see the [example's configuration](../../examples/cloudflare-worker/wrangler.jsonc).

Reach the workspace through `use()` so recovery is armed before work starts, and don't call its `dismiss()`. `terminate()` permanently refuses that object ID while keeping history.

Local workerd tests cover reminder delivery, whether the object was evicted or stayed in memory, interrupted-reply recovery and persistent termination. ChatGPT sign-in and real-model operation on Workers have not been verified.
