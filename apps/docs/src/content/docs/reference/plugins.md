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
  tools: ToolRegistration[] // plain Pi Durable tools
}
```

`definePlugin` returns the object you pass it. It's there so TypeScript checks the plugin where you write it.

## defineTool(tool)

Pi Durable's `defineTool`, re-exported from `@familiar-ai/core` at the version Familiar runs. Familiar adds nothing to the tool itself.

| Field                         | Meaning                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `name`, `description`         | What the model sees                                                    |
| `parameters`                  | A TypeBox schema built with `Type`. Arguments are validated against it |
| `execute(args, api, context)` | Runs the tool. Returns a `ToolResult`                                  |
| `replay`                      | `'safe'` reruns an interrupted call after a crash. Default `'unsafe'`  |
| `structuredOutputSchema`      | Optional schema for output that other tools and code mode read         |

`api` is Pi's `ToolExecutionApi`. `context` is the call's context: `context.abortSignal` is set when the call can be cancelled.

A `ToolResult` has optional `output` (content for the model), `details` (JSON for UIs), `structuredOutput`, `isError` and `diagnostics`.

## familiar(context)

What Familiar gives each call, read from the call's context. It throws if the tool runs anywhere but in a Familiar.

| Member                                  | Meaning                                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `author()`                              | The person the call runs for, as described under [Tool author](/familiar/reference/core/#tool-author). Resolved from storage when you call it, so tools that don't need it pay nothing                                 |
| `fetch(input, init?)`                   | The host's network access. On Node, the default refuses every address that isn't public                                                                                                                                |
| `authorizedFetch(secret, input, init?)` | `fetch`, with the named secret attached, if the request matches the plugin's declaration. Otherwise throws without sending. Throws a "not connected" message when the secret isn't set. Redirects come back unfollowed |
| `notify(notification)`                  | Send a notification through the host. It never carries a schedule's context                                                                                                                                            |
| `timeZone`                              | The owner's IANA zone. Format times with `localMinute`                                                                                                                                                                 |

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

| Export                      | What it does                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `fileSecretStore(path)`     | A `SecretStore` in one private JSON file                                                                                            |
| `fileCredentialStore(path)` | Model credentials, such as a ChatGPT login, in one private JSON file. Refreshed tokens are saved before they're used                |
| `lockDataDir(path)`         | Claims a data directory for this process through a lock file. Throws while another process holds it, and takes over a crashed one's |
| `jsonFile(path, initial)`   | A private JSON file, rewritten whole and atomically by `save()`, for a host's own state                                             |
