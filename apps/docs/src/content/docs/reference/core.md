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
| `maxSchedules`    |          | Most schedules kept at once, a positive whole number. Default `DEFAULT_MAX_SCHEDULES`, 50              |
| `onWake`          |          | For evictable hosts. Replaces in-process timers. See [Host on Cloudflare](/familiar/build/cloudflare/) |
| `now`, `setTimer` |          | Clock and timer overrides, mainly for tests                                                            |

## Familiar

**Conversation**

| Member                              | Meaning                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `send({ author, text, requestId })` | Admit a message. A repeated `requestId` from the same author is admitted once           |
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
| `mcp.add(server)`, `mcp.remove(name)`, `mcp.reconnect(name)` | Manage owner-configured MCP servers. `add` throws `McpConfigError`  |
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

`send` throws a `MessageError`, sending nothing, unless the author's `id` and `name` and the `text` are non-empty and within `MESSAGE_LIMITS` (256, 128 and 128,000 characters) and `requestId` is 1 to 128 characters. Familiar namespaces each `requestId` by the author's `id`, so it only needs to be unique per author and can never match one of Familiar's own submissions, such as a schedule's. Messages already queued by a version before this namespacing keep their raw IDs, so a client retrying one of those across the upgrade has it admitted again.

Schedules are bounded too: a prompt is at most `SCHEDULE_LIMITS.prompt` (2,000) characters, and a repeat is a five-field cron expression of at most `SCHEDULE_LIMITS.repeat` (256) characters, read in Familiar's time zone, such as `0 7 * * 1-5` for 07:00 on weekdays. [Croner](https://croner.56k.guru/) reads it, including its extensions such as `L` and `#`, and decides daylight saving: a time the clock skips runs when the clock resumes. When a time is shown twice, a daily or less frequent repeat runs only the first time, while an hourly one such as `30 * * * *` runs at both. A repeat runs at most hourly: each occurrence is at least an hour after the one before, and closer ones, such as most of `*/5 * * * *`, are skipped.

A stored repeat that isn't valid cron is kept with `refused` set to the reason and never runs, including a delivery that was under way when Familiar stopped. The owner can still see and cancel it.

MCP servers are checked twice: `parseServer` checks a server's shape, and admission checks whether Familiar will connect to it on this host. `add` refuses a server that fails either check before saving anything. A saved server that today's rules refuse still appears in `connections.list()` with status `{ type: 'refused', error }`, and it's checked again on every reconnect. Bearer tokens need `https://` except to `localhost`, `127.0.0.0/8` or `[::1]`, for development. Tailnet and LAN names get no exception.

`Message`, `HistoryPage`, `ChatModel`, `ModelOption`, `Notification`, `MemoryApi`, `SchedulesApi`, `ConnectionsApi`, `McpApi`, `McpServer`, `AccountState` and the plugin types are all exported from `@familiar-ai/core`, with `MESSAGE_LIMITS`, `MessageError`, `SCHEDULE_LIMITS`, `DEFAULT_MAX_SCHEDULES`, `MCP_LIMITS` and `McpConfigError`.
