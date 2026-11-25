---
title: Plugin API
description: definePlugin, familiar(context), secret declarations, Familiar secrets and the Node building blocks.
---

Declarations live in [`plugins`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src/plugins), [`connections`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src/connections) and [`tools.ts`](https://github.com/AidanZealley/familiar/blob/main/packages/core/src/tools.ts), in `packages/core/src`. [Customise your assistant](/familiar/build/customise/) has worked examples.

## definePlugin(plugin)

```ts
type FamiliarPlugin = {
  name: string // keys its secrets and routes, so keep it stable
  title: string // shown on the Connections page
  secrets?: PluginSecret[]
  familiarSecrets?: string[] // names of values it keeps per Familiar
  tools: FamiliarTool[]
  open?(context: PluginContext): PluginClose | Promise<PluginClose>
  routes?: Hono<PluginEnv> // routes about one Familiar
}
```

`definePlugin` returns what you pass it, so TypeScript checks the plugin where you write it.

### open(context)

For a plugin with background state. `openWorkspace` awaits it before resuming unfinished work, so start slow work without awaiting it. It may return a function, called when the workspace closes.

```ts
type PluginContext = {
  watchFamiliars(listener: (familiars: FamiliarId[]) => void): void
  secretsFor?(familiar: FamiliarId): FamiliarSecrets
}
```

- `watchFamiliars` calls `listener` with the Familiars that have the plugin turned on, then again on each change. Its first call comes before any resumed tool call. If storage can't be read there's no first call, so do nothing until you have one. The listener isn't awaited; handle its errors.
- `secretsFor` is undefined when the host passes no `secrets` store. See [Familiar secrets](#familiar-secrets).

### routes

A [Hono](https://hono.dev) app that `createHttpApi` mounts at `/plugins/<name>/familiars/:familiar`. Requests are authenticated as core's are, then `allow` is asked for `plugins.<name>` with `{ familiar }`, then a missing Familiar is 404. Read the person with `c.get('author')` and the Familiar with `c.get('familiar')`.

```ts
const routes = new Hono<PluginEnv>().get('/status', async (c) =>
  c.json(await host.status(c.get('familiar'))),
)
// GET /plugins/computer/familiars/1/status
```

WebSocket routes need `upgradeWebSocket` passed to `createHttpApi`; without it they answer 501.

## checkPlugins(plugins)

Throws, naming the plugin, unless plugins can run together: unique names, valid secret declarations, distinct `familiarSecrets`, and tool names that clash with no one's. `openWorkspace` runs it. A host that loads plugins one at a time can run it on each to skip a bad one.

## defineTool(tool)

A Pi Durable tool, with one optional field Familiar reads: `annotations`.

| Field                         | Meaning                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `name`, `description`         | What the model sees                                                   |
| `parameters`                  | A JSON Schema built with `schema.obj`, `schema.str` and so on         |
| `execute(args, api, context)` | Runs the tool. Returns a `ToolResult`                                 |
| `replay`                      | `'safe'` reruns an interrupted call after a crash. Default `'unsafe'` |
| `structuredOutputSchema`      | Optional schema for output that other tools and code mode read        |
| `annotations`                 | MCP's `ToolAnnotations`: `title` and the four hints                   |

- `schema.obj` rejects undeclared properties. Use `schema.obj(properties, { open: true })` to accept them.
- A tool with `destructiveHint: true` asks the person first. Others run straight away. The Connections page can change either.
- `context.abortSignal` is set when the call can be cancelled.
- A `ToolResult` has optional `output` (content for the model), `details` (JSON for UIs), `structuredOutput`, `isError` and `diagnostics`.

## familiar(context)

What Familiar gives each tool call. It throws outside a Familiar.

| Member                                  | Meaning                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `author()`                              | The person the call runs for. See [Tool author](/familiar/reference/core/#tool-author) |
| `familiarId()`                          | The Familiar making the call                                                           |
| `fetch(input, init?)`                   | The host's network access. On Node, refuses every address that isn't public            |
| `authorizedFetch(secret, input, init?)` | `fetch` with the named secret attached, if the request matches its declaration         |
| `askPrivately({ message, form })`       | Ask the person for values only this tool gets, such as a password                      |
| `notify(notification)`                  | Send a notification through the host                                                   |
| `timeZone`                              | The owner's IANA zone. Format times with `localMinute`                                 |

- `authorizedFetch` throws without sending a request that doesn't match, and returns redirects unfollowed. Only a plugin's tools can send secrets, and only their own plugin's.
- `askPrivately` resolves `{ action: 'accept', values }`, `{ action: 'decline' }` or `{ action: 'moved-on' }` if the person sent a new message instead. Plugins' tools only. The values are never stored.
- `author()` and `familiarId()` read storage when called, so tools that don't need them pay nothing.

## PluginSecret

```ts
type PluginSecret = {
  name: string
  label: string
  help?: string
  sendAs: {
    header: string // such as 'Authorization'
    prefix?: string // such as 'Bearer '
    origin: string // exact, no subdomains
    requests: { method: string; path: string }[] // exact, no patterns
  }
}
```

The owner sets the value on the Connections page. The plugin's code never sees it.

## Familiar secrets

Values a plugin keeps for each Familiar, such as saved logins. List their names in `familiarSecrets`, then use them through `secretsFor(familiar)`:

```ts
type FamiliarSecrets = {
  get(name: string): Promise<string | undefined>
  // Replaces the value with what change returns; undefined deletes it
  update(
    name: string,
    change: (value: string | undefined) => string | undefined,
  ): Promise<void>
}
```

Unlike a `PluginSecret`, the plugin reads these itself, and the Connections page doesn't show them. Changes for one Familiar run one at a time. Removing the Familiar deletes them. A name that isn't listed throws.

## SecretStore

```ts
type SecretStore = {
  get(connection: Connection, secret: string): Promise<string | undefined>
  set(connection: Connection, secret: string, value: string): Promise<void>
  delete(connection: Connection, secret: string): Promise<void>
}
```

`memorySecrets()` is an in-memory store for tests. Give each workspace its own store: keys don't name the workspace, so two sharing one share their secrets.

## Node building blocks

`@familiar-ai/core/node` has what a Node host needs beyond core. The daemon and the [Node server example](/familiar/examples/node-server/) use it.

| Export                               | What it does                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `fileSecretStore(path, keyPath)`     | A `SecretStore` in one encrypted JSON file                                    |
| `fileCredentialStore(path, keyPath)` | Model credentials, such as a ChatGPT login, in one encrypted JSON file        |
| `lockDataDir(path)`                  | Claims a data directory for this process. Throws while another holds it       |
| `jsonFile(path, initial)`            | A private JSON file, rewritten atomically by `save()`, for a host's own state |
| `createNodePhotonImages()`           | The image processor for `openWorkspace`'s `images`                            |

```ts
import { fileSecretStore, lockDataDir } from '@familiar-ai/core/node'

lockDataDir('/private/app/daemon.lock')
const secrets = fileSecretStore(
  '/private/app/secrets.json',
  '/private/app/vault.key',
)
```

Both stores encrypt with AES-256-GCM under the 32-byte key at `keyPath`, created on the first save. Lock the directory before opening a store, and keep one instance of each. Back up the key with its files: without it they can't be read, and a missing or wrong key stops the store opening.
