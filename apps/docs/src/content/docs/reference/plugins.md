---
title: Plugin API
description: definePlugin, familiar(context), secret declarations, Familiar secrets and the Node building blocks.
---

Declarations live in [`plugins`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src/plugins), [`connections`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src/connections) for secrets and `authorizedFetch`, and [`tools.ts`](https://github.com/AidanZealley/familiar/blob/main/packages/core/src/tools.ts) for `familiar(context)`, all in `packages/core/src`. [Customise your assistant](/familiar/build/customise/) has worked examples.

## definePlugin(plugin)

```ts
type FamiliarPlugin = {
  name: string // keys its secrets and routes, so keep it stable
  title: string // shown on the Connections page
  secrets?: PluginSecret[]
  familiarSecrets?: string[] // names of values it keeps per Familiar
  tools: FamiliarTool[] // Pi Durable tools, with optional annotations
  open?(context: PluginContext): PluginClose | Promise<PluginClose>
  routes?: Hono<PluginEnv> // routes about one Familiar
}
```

`definePlugin` returns the object you pass it. It's there so TypeScript checks the plugin where you write it.

### open(context)

For a plugin with background state or clean-up. `openWorkspace` calls it once the workspace is open, before it resumes the work the last process left unfinished, and waits for it, so start slow work without awaiting it. No resumed tool call reaches a plugin before its `open` has settled. It may return a function, which is called when the workspace closes, by `dismiss()` or a storage failure.

```ts
type PluginContext = {
  watchFamiliars(listener: (familiars: FamiliarId[]) => void): void
  secretsFor?(familiar: FamiliarId): FamiliarSecrets
}
```

`watchFamiliars` calls `listener` with the Familiars that use the plugin, those that have it turned on, then again when that changes: one turns it on or off, or is created with it or removed. Called from `open`, its first call comes before the workspace resumes any work, so a plugin knows who uses it before a resumed call arrives; later calls come asynchronously. If storage can't be read, as when it fails, there's no first call and opening goes on without one, so a plugin that acts on the list should do nothing until it has one. Changes close together may come as one call; the last call is always who uses it now. A promise `listener` returns isn't awaited, so handle its errors.

`secretsFor` is the plugin's private values for one Familiar, by the names in its `familiarSecrets`. It's undefined when the host passes no `secrets` store. See [Familiar secrets](#familiar-secrets).

### routes

A [Hono](https://hono.dev) app about one Familiar, which `createHttpApi` mounts at `/plugins/<name>/familiars/:familiar`. Each request is authenticated as core's are, then `allow` is asked for `plugins.<name>` with that Familiar's ID, then a Familiar that doesn't exist is 404. The routes read who is asking with `c.get('author')` and the Familiar with `c.get('familiar')`.

```ts
const routes = new Hono<PluginEnv>().get('/status', async (c) =>
  c.json(await host.status(c.get('familiar'))),
)
// GET /plugins/computer/familiars/1/status
```

## checkPlugins(plugins)

Throws, naming the plugin, unless the plugins can run together: unique plugin names, secret declarations that can be sent and don't start with `familiar/`, `familiarSecrets` names that are distinct, non-empty and without a `/`, and tool names that aren't core's or another plugin's. `openWorkspace` runs it on its `plugins`. A host that loads plugins one at a time, as the daemon does, can run it on each to skip a bad one instead of failing to start.

## defineTool(tool)

A Pi Durable tool, at the version Familiar runs, with one optional field Familiar reads: `annotations`.

| Field                         | Meaning                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `name`, `description`         | What the model sees                                                                                |
| `parameters`                  | A JSON Schema built with Pi builders such as `schema.obj` and `schema.str`. Pi validates arguments |
| `execute(args, api, context)` | Runs the tool. Returns a `ToolResult`                                                              |
| `replay`                      | `'safe'` reruns an interrupted call after a crash. Default `'unsafe'`                              |
| `structuredOutputSchema`      | Optional schema for output that other tools and code mode read                                     |
| `annotations`                 | `{ destructiveHint? }`, as MCP tools declare them                                                  |

Tool schemas use Pi's native builders. `schema.obj` rejects undeclared properties by default; use `schema.obj(properties, { open: true })` when a tool intentionally accepts them.

A plugin's tool asks the person first when it says `destructiveHint: true`. Other tools run by default. A declined call returns `Tool call blocked: The person declined this call.` to the model. The Connections page has separate controls for approval and availability on each tool. Core's own tools never ask.

`api` is Pi's `ToolExecutionApi`. `context` is the call's context: `context.abortSignal` is set when the call can be cancelled.

A `ToolResult` has optional `output` (content for the model), `details` (JSON for UIs), `structuredOutput`, `isError` and `diagnostics`.

## familiar(context)

What Familiar gives each call, read from the call's context. It throws if the tool runs anywhere but in a Familiar.

| Member                                  | Meaning                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `author()`                              | The person the call runs for, as described under [Tool author](/familiar/reference/core/#tool-author). Resolved from storage when you call it, so tools that don't need it pay nothing                                                                                                                    |
| `familiarId()`                          | The Familiar making the call. Resolved from storage when you call it, never from the tool's arguments. Throws in a conversation no Familiar owns                                                                                                                                                          |
| `fetch(input, init?)`                   | The host's network access. On Node, the default refuses every address that isn't public                                                                                                                                                                                                                   |
| `authorizedFetch(secret, input, init?)` | `fetch`, with the named secret attached, if the request matches the plugin's declaration. Otherwise throws without sending. Throws a "not connected" message when the secret isn't set. Redirects come back unfollowed                                                                                    |
| `askPrivately({ message, form })`       | Asks the person in a form in the chat for values only this tool gets, such as a password or an API key, and waits. Resolves `{ action: 'accept', values }`, or `{ action: 'decline' }` or `{ action: 'moved-on' }` when they sent a new message instead. The values are never stored. Plugins' tools only |
| `notify(notification)`                  | Send a notification through the host. It never carries a schedule's context                                                                                                                                                                                                                               |
| `timeZone`                              | The owner's IANA zone. Format times with `localMinute`                                                                                                                                                                                                                                                    |

Familiar puts these on every tool it runs, core's and plugins'. Only a plugin's tools can send secrets, and only their own plugin's.

The context key is a global symbol, so a plugin bundled with its own copy of `@familiar-ai/core` still finds the services.

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

## Familiar secrets

Values a plugin keeps for each Familiar, such as its saved logins or an API key it asked for with `askPrivately`. List their names in `familiarSecrets`, then use them through `secretsFor(familiar)` from `open`:

```ts
type FamiliarSecrets = {
  get(name: string): Promise<string | undefined>
  // Replaces the value with what change returns (undefined deletes it)
  update(
    name: string,
    change: (value: string | undefined) => string | undefined,
  ): Promise<void>
}
```

Unlike a `PluginSecret`, the plugin reads these values itself, and the Connections page doesn't show them, so the plugin gives the person whatever UI it needs. A name that isn't listed throws.

They're kept in the host's `SecretStore` under the plugin's connection, as `familiar/<id>/<name>`. Each Familiar's reads and changes run one at a time, so two changes never lose each other. Removing a Familiar deletes all of its secrets before it's removed, after any change already under way, and refuses changes from then on.

## SecretStore

```ts
type SecretStore = {
  get(connection: Connection, secret: string): Promise<string | undefined>
  set(connection: Connection, secret: string, value: string): Promise<void>
  delete(connection: Connection, secret: string): Promise<void>
}
```

`memorySecrets()` is an in-memory store for tests.

Give each workspace its own store. Nothing in a secret's key names its workspace, so two workspaces sharing a store would share their secrets.

## Node building blocks

`@familiar-ai/core/node` has what a Node host needs beyond core. The daemon and the [Node server example](/familiar/examples/node-server/) both use it.

| Export                               | What it does                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `fileSecretStore(path, keyPath)`     | A `SecretStore` in one encrypted JSON file                                                                                              |
| `fileCredentialStore(path, keyPath)` | Model credentials, such as a ChatGPT login, in one encrypted JSON file. Refreshed tokens are saved before they're used                  |
| `lockDataDir(path)`                  | Claims a data directory for this process through an operating-system lock, which a crash lets go. Throws while another process holds it |
| `jsonFile(path, initial)`            | A private JSON file, rewritten whole and atomically by `save()`, for a host's own state                                                 |

Both credential stores encrypt their file with AES-256-GCM under the 32-byte key
at `keyPath`, which they create on the first save. The two can share a key. Any
plaintext file is encrypted the next time it's opened.
A missing or wrong key, or a damaged file, stops the store opening and changes
nothing.

```ts
import { fileSecretStore, lockDataDir } from '@familiar-ai/core/node'

lockDataDir('/private/app/daemon.lock')
const secrets = fileSecretStore(
  '/private/app/secrets.json',
  '/private/app/vault.key',
)
```

Lock the directory before opening a store, and keep one instance of each. Back
up the key with the files it encrypts: without it they can't be read. The
running host can decrypt them, so its machine stays trusted.
