---
title: Core API
description: summonFamiliar, its options, the Familiar it returns and core's entry points.
---

The TypeScript declarations in [`packages/core/src`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src) are the full contract. This page lists what hosts use.

## Entry points

| Import                                | Contents                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@familiar-ai/core`                   | `summonFamiliar`, `createAccount`, `definePlugin`, `defineTool`, `Type`, `memorySecrets`, `defaultPersona`, `localMinute`, errors and types |
| `@familiar-ai/core/http`              | `createHttpApi`, the route factories, `eventRoutes` and wire types                                                                          |
| `@familiar-ai/core/models`            | Pi's `createModels` and model types, including `CredentialStore`                                                                            |
| `@familiar-ai/core/models/openai`     | `openaiProvider`                                                                                                                            |
| `@familiar-ai/core/models/openrouter` | `openrouterProvider`                                                                                                                        |
| `@familiar-ai/core/models/faux`       | `fauxProvider`, `fauxAssistantMessage` and other scripted-model helpers                                                                     |
| `@familiar-ai/core/storage/memory`    | `MemoryStorage`                                                                                                                             |
| `@familiar-ai/core/extensions`        | Pi Durable's extension types and helpers                                                                                                    |
| `@familiar-ai/core/mcp`               | `connectMcp` and MCP types                                                                                                                  |
| `@familiar-ai/core/diagnostics`       | Memory internals for evaluation tools                                                                                                       |

The model and extension entries re-export Pi at the exact version core depends on.

## summonFamiliar(options)

Opens a Familiar over its storage, resumes unfinished work and starts background work. Returns `Promise<Familiar>`. Use one process per storage, and `dismiss()` it when done.

| Option            | Required | Meaning                                                                                                |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `storage`         | yes      | Pi Durable `Storage`                                                                                   |
| `models`          | yes      | Pi `Models` with providers registered                                                                  |
| `model`           | yes      | `{ provider, modelId }` for upkeep and a new conversation's starting model                             |
| `timeZone`        | yes      | IANA zone. Throws if invalid                                                                           |
| `chatModels`      |          | `{ model, thinkingLevel }[]` people may switch to. Must include `model`. Default: `model` at medium    |
| `name`            |          | Notification titles and upkeep prompts. Default `Familiar`                                             |
| `persona`         |          | Replaces `defaultPersona(name)` completely                                                             |
| `account`         |          | From `createAccount` over the same `models` and `model.provider`                                       |
| `plugins`         |          | `FamiliarPlugin[]`                                                                                     |
| `secrets`         |          | `SecretStore`. Without it, every secret is missing                                                     |
| `fetch`           |          | `PluginFetch` for plugins. Must refuse private destinations where the process can reach them           |
| `mcpFetch`        |          | `PluginFetch` for owner-configured HTTP MCP servers                                                    |
| `mcpStdio`        |          | `McpStdioFactory` for owner-configured local MCP commands                                              |
| `contextBudget`   |          | Tokens per request before older conversation is compacted. Default 64,000                              |
| `notify`          |          | `(notification: { title, body, url? }) => Promise<void>` for scheduled replies                         |
| `onWake`          |          | For evictable hosts. Replaces in-process timers. See [Host on Cloudflare](/familiar/build/cloudflare/) |
| `now`, `setTimer` |          | Clock and timer overrides, mainly for tests                                                            |

## Familiar

**Conversation**

| Member                              | Meaning                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `send({ author, text, requestId })` | Admit a message. `author` is `{ id, name }`. A repeated `requestId` is admitted once    |
| `abort()`                           | Stop the current run and withdraw messages queued behind it                             |
| `idle()`                            | Resolves when every sent message has an answer                                          |
| `watch()`                           | `ConversationWatch`: the committed view as `value`, then `start(listener)` and `stop()` |
| `history(before, limit)`            | `{ entries, more }`: committed entries older than `before`, newest first                |
| `models()`                          | `ModelOption[]`: each chat model with its `name` and supported `thinkingLevels`         |
| `setModel(ref)`                     | Switch model. Throws `ModelError` if it isn't offered                                   |
| `setThinkingLevel(level)`           | Change the current model's level. Throws `ModelError` if unsupported                    |

**Memory, schedules and connections**

| Member                                                       | Meaning                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `memory.watch()`, `memory.watchEpisodes()`                   | Document watches for facts and episodes                             |
| `memory.revise(id, text)`                                    | Save a new version of a fact, true from today                       |
| `memory.retire(id)`                                          | Mark a fact no longer true from today                               |
| `memory.setPinned(id, pinned)`                               | Pin a fact into core or unpin it                                    |
| `memory.health()`                                            | Numbers that show whether memory upkeep is keeping up               |
| `schedules.watch()`                                          | Document watch for schedules                                        |
| `schedules.cancel(id)`                                       | Cancel a schedule. Rejects if there's no such schedule              |
| `connections.list()`                                         | Plugin and MCP connections, with whether each secret is set         |
| `connections.setSecret(connection, name, value)`             | Store a secret. `connection` is `{ kind: 'plugin' \| 'mcp', name }` |
| `connections.deleteSecret(connection, name)`                 | Remove a secret                                                     |
| `mcp.add(server)`, `mcp.remove(name)`, `mcp.reconnect(name)` | Manage owner-configured MCP servers                                 |
| `account`                                                    | The attached account's API, if any                                  |

Memory edits reject, changing nothing, when the fact is missing or already past.

**Lifecycle**

| Member               | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `onCommit(listener)` | Called synchronously after every commit. Returns an unsubscribe function      |
| `usage()`            | Pi's usage totals for this Familiar                                           |
| `wake()`, `resume()` | For hosts that pass `onWake`                                                  |
| `closed`             | Settles on dismissal or a storage failure. A failed instance must be reopened |
| `dismiss()`          | Close the assistant, its account and its MCP connections                      |

## createAccount(options)

`createAccount({ models, provider, login })` returns an `Account` for one provider's login. `login` is Pi's `LoginOptions`; OpenAI needs `getDeviceId`. Pass the account to `summonFamiliar`. See [Models and sign-in](/familiar/build/models-and-sign-in/).

## Types

`Author` is `{ id: string; name: string }`. Both must be non-empty. `id` is stable and owned by the host. `name` is captured when the message is sent.

`Message`, `HistoryPage`, `ChatModel`, `ModelOption`, `Notification`, `MemoryApi`, `SchedulesApi`, `ConnectionsApi`, `McpApi`, `McpServer`, `AccountState` and the plugin types are all exported from `@familiar-ai/core`.
