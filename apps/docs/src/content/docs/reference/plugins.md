---
title: Plugin API
description: definePlugin, familiar(context), secret declarations and the Node building blocks.
---

Declarations live in [`plugins`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src/plugins), [`connections`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src/connections) for secrets and `authorizedFetch`, and [`tools.ts`](https://github.com/AidanZealley/familiar/blob/main/packages/core/src/tools.ts) for `familiar(context)`, all in `packages/core/src`. [Customise your assistant](/familiar/build/customise/) has worked examples.

## definePlugin(plugin)

```ts
type FamiliarPlugin = {
  name: string // keys its secrets, so keep it stable
  title: string // shown on the Connections page
  secrets?: PluginSecret[]
  tools: FamiliarTool[] // Pi Durable tools, with optional annotations
}
```

`definePlugin` returns the object you pass it. It's there so TypeScript checks the plugin where you write it.

## checkPlugins(plugins)

Throws, naming the plugin, unless the plugins can run together: unique plugin names, secret declarations that can be sent, and tool names that aren't core's or another plugin's. `openWorkspace` runs it on its `plugins`. A host that loads plugins one at a time, as the daemon does, can run it on each to skip a bad one instead of failing to start.

## defineTool(tool)

A Pi Durable tool, at the version Familiar runs, with one optional field Familiar reads: `annotations`.

| Field                         | Meaning                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `name`, `description`         | What the model sees                                                                                |
| `parameters`                  | A JSON Schema built with Pi builders such as `schema.obj` and `schema.str`. Pi validates arguments |
| `execute(args, api, context)` | Runs the tool. Returns a `ToolResult`                                                              |
| `replay`                      | `'safe'` reruns an interrupted call after a crash. Default `'unsafe'`                              |
| `structuredOutputSchema`      | Optional schema for output that other tools and code mode read                                     |
| `annotations`                 | `{ readOnlyHint?, destructiveHint? }`, as MCP tools declare them                                   |

Tool schemas use Pi's native builders. `schema.obj` rejects undeclared properties by default; use `schema.obj(properties, { open: true })` when a tool intentionally accepts them.

A plugin's tool runs at once when it says `readOnlyHint: true` or `destructiveHint: false`. Otherwise it asks the person first, and a declined call returns `Tool call blocked: The person declined this call.` to the model. The owner's choice on the Connections page, per connection or per tool, overrides either. Core's own tools never ask.

`api` is Pi's `ToolExecutionApi`. `context` is the call's context: `context.abortSignal` is set when the call can be cancelled.

A `ToolResult` has optional `output` (content for the model), `details` (JSON for UIs), `structuredOutput`, `isError` and `diagnostics`.

## familiar(context)

What Familiar gives each call, read from the call's context. It throws if the tool runs anywhere but in a Familiar.

| Member                                  | Meaning                                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `author()`                              | The person the call runs for, as described under [Tool author](/familiar/reference/core/#tool-author). Resolved from storage when you call it, so tools that don't need it pay nothing                                 |
| `familiarId()`                          | The Familiar making the call. Resolved from storage when you call it, never from the tool's arguments. Throws in a conversation no Familiar owns                                                                       |
| `askPrivately(request, receive)`        | Asks the person in the call's chat for values only the plugin gets, such as a password. See [Private questions](#private-questions)                                                                                    |
| `fetch(input, init?)`                   | The host's network access. On Node, the default refuses every address that isn't public                                                                                                                                |
| `authorizedFetch(secret, input, init?)` | `fetch`, with the named secret attached, if the request matches the plugin's declaration. Otherwise throws without sending. Throws a "not connected" message when the secret isn't set. Redirects come back unfollowed |
| `notify(notification)`                  | Send a notification through the host. It never carries a schedule's context                                                                                                                                            |
| `timeZone`                              | The owner's IANA zone. Format times with `localMinute`                                                                                                                                                                 |

Familiar puts these on every tool it runs, core's and plugins'. Only a plugin's tools can send secrets, and only their own plugin's, or ask privately.

### Private questions

```ts
const result = await familiar(context).askPrivately(
  {
    message: 'Your login for example.com',
    form: [
      { name: 'username', type: 'string', required: true },
      { name: 'password', type: 'string', format: 'password', required: true },
    ],
  },
  async (values) => logins.save('example.com', values),
)
// 'provided' or 'declined'
```

The question shows in the chat like a server's form, with `format: 'password'` fields hidden as they're typed. When the person submits, `receive` gets the values before the question is answered, and they're never stored with the question, sent to the chat's clients or shown to the model. Return only `result` to the model. If `receive` throws, the person stays asked and sees why when it's a `QuestionError`. While `receive` runs, the question takes no other answer, and a new message or a stopped call waits for it: saved values count as `provided`. Otherwise a new message instead of an answer, or a stopped call, ends as `declined`.

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

## SecretStore

```ts
type SecretStore = {
  get(connection: Connection, secret: string): Promise<string | undefined>
  set(connection: Connection, secret: string, value: string): Promise<void>
  delete(connection: Connection, secret: string): Promise<void>
}
```

`memorySecrets()` is an in-memory store for tests.

## Node building blocks

`@familiar-ai/core/node` has what a Node host needs beyond core. The daemon and the [Node server example](/familiar/examples/node-server/) both use it.

| Export                                               | What it does                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fileSecretStore(path, keyPath)`                     | A `SecretStore` in one encrypted JSON file                                                                                                            |
| `fileCredentialStore(path, keyPath)`                 | Model credentials, such as a ChatGPT login, in one encrypted JSON file. Refreshed tokens are saved before they're used                                |
| `lockDataDir(path)`                                  | Claims a data directory for this process through a lock file. Throws while another process holds it, and takes over a crashed one's                   |
| `jsonFile(path, initial)`                            | A private JSON file, rewritten whole and atomically by `save()`, for a host's own state                                                               |
| `encryptedJsonFile(path, keyPath, purpose, initial)` | `jsonFile`, encrypted as the stores below are, for a plugin's own secrets. Its `purpose` binds the file to its use, so one can't stand in for another |

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
