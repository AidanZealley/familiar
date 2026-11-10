---
title: Core API
description: openWorkspace, its options, the workspace it returns, its Familiars and rooms, and core's entry points.
---

The TypeScript declarations in [`packages/core/src`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src) are the full contract. This page lists what hosts use.

## Entry points

| Import                                | Contents                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@familiar-ai/core`                   | `openWorkspace`, `definePlugin`, `defineTool`, `familiar`, `Type`, `memorySecrets`, `defaultPersona`, `localMinute`, errors and types                          |
| `@familiar-ai/core/http`              | `createHttpApi`, `HttpApi`, `Operation`, `Allow` and wire types                                                                                                |
| `@familiar-ai/core/models`            | Pi's `createModels` and model types, including `CredentialStore`                                                                                               |
| `@familiar-ai/core/models/openai`     | `openaiProvider`                                                                                                                                               |
| `@familiar-ai/core/models/openrouter` | `openrouterProvider`                                                                                                                                           |
| `@familiar-ai/core/models/faux`       | `fauxProvider`, `fauxAssistantMessage` and other scripted-model helpers                                                                                        |
| `@familiar-ai/core/models/scripted`   | `scriptedModels`: faux models that answer each request with a script, read as a message, tool result, schedule or background work                              |
| `@familiar-ai/core/storage/memory`    | `MemoryStorage`                                                                                                                                                |
| `@familiar-ai/core/extensions`        | Pi Durable's extension types and helpers                                                                                                                       |
| `@familiar-ai/core/node`              | Node building blocks: `fileSecretStore`, `fileCredentialStore`, `lockDataDir`, `jsonFile`. See [Plugin API](/familiar/reference/plugins/#node-building-blocks) |
| `@familiar-ai/core/diagnostics`       | Memory internals for evaluation tools                                                                                                                          |

The model and extension entries re-export Pi at the exact version core depends on.

## openWorkspace(options)

Opens a workspace over its storage, resumes unfinished work and starts background work. Returns `Promise<Workspace>`. Use one process per storage, and `dismiss()` it when done.

A workspace holds Familiars and the rooms where people talk to them. Each Familiar has its own memory, schedules, model and one working context it carries across all its rooms; plugins, MCP servers, secrets and the model login are shared. Familiars and rooms are stored, so a host creates them once, on the first open.

| Option             | Required | Meaning                                                                                                                                                                                     |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`          | yes      | Pi Durable `Storage`                                                                                                                                                                        |
| `models`           | yes      | Pi `Models` with providers registered                                                                                                                                                       |
| `model`            | yes      | `{ provider, modelId }` for upkeep and a new Familiar's starting model                                                                                                                      |
| `timeZone`         | yes      | IANA zone. Throws if invalid                                                                                                                                                                |
| `chatModels`       |          | `{ model, thinkingLevel }[]` people may switch to. Must include `model`. Default: `model` at medium                                                                                         |
| `hostInstructions` |          | What the host adds after each Familiar's persona, such as what its UI renders                                                                                                               |
| `account`          |          | `{ login }`: lets the owner sign in to `model.provider`. `login` is Pi's `LoginOptions`; OpenAI needs `getDeviceId`                                                                         |
| `plugins`          |          | `FamiliarPlugin[]`                                                                                                                                                                          |
| `secrets`          |          | `SecretStore`. Without it, every secret is missing                                                                                                                                          |
| `fetch`            |          | `PluginFetch` for tools, used as given. Refuse private destinations the process can reach. Default: on Node, a fetch that refuses every address that isn't public; elsewhere, the runtime's |
| `mcpFetch`         |          | `PluginFetch` for owner-configured HTTP MCP servers                                                                                                                                         |
| `mcpStdio`         |          | `McpStdioFactory` for owner-configured local MCP commands                                                                                                                                   |
| `contextBudget`    |          | Tokens per request before a Familiar's older context is compacted. Default 64,000                                                                                                           |
| `notify`           |          | `Notify`: delivers scheduled replies and plugins' notifications. See [Notifications](#notifications)                                                                                        |
| `maxSchedules`     |          | Most schedules each Familiar keeps at once, a positive whole number. Default `DEFAULT_MAX_SCHEDULES`, 50                                                                                    |
| `onWake`           |          | For evictable hosts. Replaces in-process timers. See [Host on Cloudflare](/familiar/build/cloudflare/)                                                                                      |
| `now`, `setTimer`  |          | Clock and timer overrides, mainly for tests                                                                                                                                                 |

### Notifications

`notify(notification, context?)` receives `{ title, body, url? }`, the same for everyone who sees it. A scheduled run also passes a `NotificationContext`, `{ scheduleId, creator }`. `creator` is the `Author` stored with the schedule when it was made, unchanged by restarts or later renames, and `undefined` when no person asked for it. A plugin's notification has no context.

Familiar never chooses recipients. Your host decides who sees each notification, in which tenant, and how: through Web Push with `PushHost`, or its own notification preferences and delivery. The creator is attribution, not a recipient: a reminder's turn answers it in the room it was made in, where others may also want it, and the host may send it to none of them.

[Serve the API](/familiar/build/serve-the-api/#notifications) has a tenant's `notify` that delivers through the app's own preferences.

### Tool author

Every tool in a workspace is available to every Familiar, for everyone who talks to it. A tool reads the person a call runs for with `await familiar(context).author()`, an `Author` or `undefined`, resolved from the stored input that started the call, never from its arguments. It is the message's author, or a scheduled run's creator. Nested calls and calls rerun after a crash keep it, and a message queued later can't replace it. It's `undefined` for memory upkeep and any other input with no person behind it. MCP tools don't receive it.

Familiar stores no permissions. A tool, or the app API behind it, enforces narrower rules about its data and actions against that author. See [Serve the API](/familiar/build/serve-the-api/#identity-is-not-permission).

## Workspace

**Familiars**

| Member                                | Meaning                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `familiars.list()`                    | `FamiliarSummary[]`: each Familiar's `id`, `name` and any `persona`                 |
| `familiars.watch()`                   | Watch of who each Familiar is                                                       |
| `familiars.create({ name, persona })` | Create one, returning its `WorkspaceFamiliar`. Throws a `TypeError` for a blank one |
| `familiars.update(id, change)`        | Rename it or change its persona; a `null` persona returns it to the default         |
| `familiars.get(id)`                   | Its `WorkspaceFamiliar`, or `undefined`                                             |

Without a `persona`, a Familiar introduces itself with `defaultPersona(name)`. Its name also titles its notifications and its memory upkeep's prompts.

**Rooms**

| Member                       | Meaning                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `rooms.list(person?)`        | `RoomSummary[]`; with a host author ID, only that person's DMs and every named room           |
| `rooms.watch(person?)`       | Watch of the same                                                                             |
| `rooms.create(setup)`        | A named room, `{ name, familiars, lead }`, returning its ID. Throws `RoomError` when refused  |
| `rooms.update(id, change)`   | Change a named room's name, Familiars or lead                                                 |
| `rooms.archive(id)`          | Hide a named room and close it to new messages, keeping its history                           |
| `rooms.dm(familiar, person)` | The DM between a Familiar and a person, by host author ID, created if new                     |
| `rooms.get(id, person?)`     | A room's API; with a host author ID, undefined for someone else's DM, as the HTTP API uses it |

`lead` answers a named room's messages that mention no Familiar. Each `RoomApi` has:

| Member                                         | Meaning                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `post({ author, text, requestId, mentions? })` | Post a message and start the turns it causes, returning its entry ID. A repeated `requestId` posts once |
| `replyTo(entry)`                               | The first reply to an entry, once there is one, for a host that waits on an answer                      |
| `watch()`                                      | The log's committed view as `value`, then `start(listener)` and `stop()`                                |
| `watchTurns()`                                 | Its turns in progress: each one `queued`, `elsewhere` or `running`, with the reply so far               |
| `history(before, limit)`                       | `{ entries, more }`: committed entries older than `before`, newest first                                |
| `stop()`                                       | Stop this room's turns, leaving other rooms' work alone                                                 |

A DM's Familiar answers every message; in a named room, each Familiar a message mentions answers it, else the lead. A mention is `{ kind: 'familiar' | 'person', id, start, end }`, the span of an `@Name` in the text; `post` throws a `MessageError` for one that doesn't span an `@` or names a Familiar not in the room, and a `RoomError` for an archived room. A Familiar works one turn at a time, across all its rooms, and is shown what it missed in a room when it next takes a turn there. Its reply, with its tool calls, is copied into the room's log as a `familiar.reply` entry when the turn ends.

**Each Familiar**, a `WorkspaceFamiliar`

| Member                                     | Meaning                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `id`                                       | Its `FamiliarId`                                                                |
| `models()`                                 | `ModelOption[]`: each chat model with its `name` and supported `thinkingLevels` |
| `watchModel()`                             | Watch of its model and level, Pi's `AgentState`                                 |
| `setModel(ref)`                            | Switch model. Throws `ModelError` if it isn't offered                           |
| `setThinkingLevel(level)`                  | Change the current model's level. Throws `ModelError` if unsupported            |
| `watch()`                                  | Its working context across every room, for inspection: never show it to people  |
| `memory.watch()`, `memory.watchEpisodes()` | Document watches for facts and episodes                                         |
| `memory.revise(id, text)`                  | Save a new version of a fact, true from today                                   |
| `memory.retire(id)`                        | Mark a fact no longer true from today                                           |
| `memory.setPinned(id, pinned)`             | Pin a fact into core or unpin it                                                |
| `schedules.watch()`                        | Document watch for schedules                                                    |
| `schedules.cancel(id)`                     | Cancel a schedule. Rejects if there's no such schedule                          |

Memory edits reject, changing nothing, when the fact is missing or already past.

**Shared**

| Member                                                       | Meaning                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `connections.list()`                                         | Plugin and MCP connections, with whether each secret is set         |
| `connections.setSecret(connection, name, value)`             | Store a secret. `connection` is `{ kind: 'plugin' \| 'mcp', name }` |
| `connections.deleteSecret(connection, name)`                 | Remove a secret                                                     |
| `mcp.add(server)`, `mcp.remove(name)`, `mcp.reconnect(name)` | Manage owner-configured MCP servers. `add` throws `McpConfigError`  |
| `account`                                                    | The account's API, if `account` was passed                          |

**Lifecycle**

| Member               | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `onCommit(listener)` | Called synchronously after every commit. Returns an unsubscribe function      |
| `usage()`            | Pi's usage totals for the workspace                                           |
| `wake()`, `resume()` | For hosts that pass `onWake`                                                  |
| `closed`             | Settles on dismissal or a storage failure. A failed instance must be reopened |
| `dismiss()`          | Close the workspace, its account and its MCP connections                      |

## Types

`Author` is `{ id: string; name: string }`. Both must be non-empty. `id` is stable and owned by the host. `name` is captured when the message is posted.

`post` throws a `MessageError`, posting nothing, unless the author's `id` and `name` and the `text` are non-empty and within `MESSAGE_LIMITS` (256, 128 and 128,000 characters) and `requestId` is 1 to 128 characters. Familiar namespaces each `requestId` by the author's `id`, so it only needs to be unique per author and can never match one of Familiar's own submissions, such as a schedule's.

Schedules are bounded too: a prompt is at most `SCHEDULE_LIMITS.prompt` (2,000) characters, and a repeat is a five-field cron expression of at most `SCHEDULE_LIMITS.repeat` (256) characters, read in Familiar's time zone, such as `0 7 * * 1-5` for 07:00 on weekdays. [Croner](https://croner.56k.guru/) reads it, including its extensions such as `L` and `#`, and decides daylight saving: a time the clock skips runs when the clock resumes. When a time is shown twice, a daily or less frequent repeat runs only the first time, while an hourly one such as `30 * * * *` runs at both. A repeat runs at most hourly: each occurrence is at least an hour after the one before, and closer ones, such as most of `*/5 * * * *`, are skipped.

`add` throws `McpConfigError`, saving nothing, for a server of the wrong shape: a bad name, an unknown transport, or a URL that isn't `http://` or `https://` or carries credentials, a query or a fragment. Familiar saves any server of the right shape and connects through the transport the host passed, `mcpFetch` or `mcpStdio`. The host owns which protocols, destinations and commands those transports allow. A server whose transport the host didn't pass, or whose connection fails, shows `{ type: 'failed', error }` in `connections.list()` and never stops Familiar opening. An HTTP server with a bearer token and no token set shows `needs-auth`.

`Workspace`, `WorkspaceFamiliar`, `RoomApi`, `RoomsApi`, `Room`, `RoomMessage`, `Mention`, `ReplyData`, `HistoryPage`, `ChatModel`, `ModelOption`, `Notification`, `NotificationContext`, `Notify`, `MemoryApi`, `SchedulesApi`, `ConnectionsApi`, `McpApi`, `McpServer`, `AccountState` and the plugin types are all exported from `@familiar-ai/core`, with `MESSAGE_LIMITS`, `MessageError`, `RoomError`, `SCHEDULE_LIMITS`, `DEFAULT_MAX_SCHEDULES` and `McpConfigError`.
