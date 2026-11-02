---
title: Plugin API
description: definePlugin, defineTool, the plugin context and secret declarations.
---

Declarations live in [`packages/core/src/plugins`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src/plugins). [Customise your assistant](/familiar/build/customise/) has worked examples.

## definePlugin(plugin)

```ts
type FamiliarPlugin = {
  name: string // keys its secrets, so keep it stable
  title: string // shown on the Connections page
  secrets?: PluginSecret[]
  extension: (context: PluginContext) => PluginExtension
}
```

`PluginExtension` is a Pi Durable `Extension` without its `name`. Core names it `familiar.plugin.<name>`. It can provide tools and any other extension capability Pi supports.

## PluginContext

| Member                                  | Meaning                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `now()`                                 | Familiar's clock                                                                                                                                                                                 |
| `timeZone`                              | The owner's IANA zone. Format times with `localMinute`                                                                                                                                           |
| `notify(notification)`                  | Send a notification through the host                                                                                                                                                             |
| `fetch(input, init?)`                   | The host's plugin fetch                                                                                                                                                                          |
| `authorizedFetch(secret, input, init?)` | A request with the named secret attached, if it matches the declaration. Otherwise throws without sending. Throws a "not connected" message when the secret isn't set. Redirects aren't followed |

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

## defineTool(tool)

Takes a Pi tool registration and adds `api.author`.

| Field                         | Meaning                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `name`, `description`         | What the model sees                                                    |
| `parameters`                  | A TypeBox schema built with `Type`. Arguments are validated against it |
| `execute(args, api, context)` | Runs the tool. Returns a `ToolResult`                                  |
| `replay`                      | `'safe'` reruns an interrupted call after a crash. Default `'unsafe'`  |
| `structuredOutputSchema`      | Optional schema for output that other tools and code mode read         |

`api` is Pi's `ToolExecutionApi` plus `author: Author | undefined`. `context.abortSignal` is set when the call can be cancelled.

A `ToolResult` has optional `output` (content for the model), `details` (JSON for UIs), `structuredOutput`, `isError` and `diagnostics`.

## SecretStore

```ts
type SecretStore = {
  get(connection: Connection, secret: string): Promise<string | undefined>
  set(connection: Connection, secret: string, value: string): Promise<void>
  delete(connection: Connection, secret: string): Promise<void>
}
```

`memorySecrets()` is an in-memory store for tests.
