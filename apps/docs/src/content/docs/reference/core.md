---
title: Core API
description: openWorkspace, its options, the workspace it returns, its Familiars and rooms, and core's entry points.
---

The TypeScript declarations in [`packages/core/src`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src) are the full contract. This page lists what hosts use.

## Entry points

| Import                                | Contents                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `@familiar-ai/core`                   | `openWorkspace`, plugin and tool helpers, errors and types                                |
| `@familiar-ai/core/http`              | `createHttpApi`, `HttpApi`, `Operation`, `Allow` and wire types                           |
| `@familiar-ai/core/models`            | Pi's `createModels` and model types, including `CredentialStore`                          |
| `@familiar-ai/core/models/openai`     | `openaiProvider`                                                                          |
| `@familiar-ai/core/models/openrouter` | `openrouterProvider`                                                                      |
| `@familiar-ai/core/models/faux`       | `fauxProvider`, `fauxAssistantMessage` and other scripted-model helpers                   |
| `@familiar-ai/core/models/scripted`   | `scriptedModels`: faux models that answer each request with a script                      |
| `@familiar-ai/core/storage/memory`    | `MemoryStorage`                                                                           |
| `@familiar-ai/core/extensions`        | Pi Durable's extension types and helpers                                                  |
| `@familiar-ai/core/node`              | Node building blocks. See [Plugin API](/familiar/reference/plugins/#node-building-blocks) |
| `@familiar-ai/core/diagnostics`       | Memory internals for evaluation tools                                                     |

The model and extension entries re-export Pi at the exact version core depends on.

## openWorkspace(options)

Opens a workspace over its storage, resumes unfinished work and starts background work. Returns `Promise<Workspace>`. Use one process per storage, and `dismiss()` it when done.

A workspace holds Familiars and the rooms people talk to them in. Each Familiar has its own memory, schedules and model; plugins, MCP servers, secrets and the model login are shared. Familiars and rooms are stored, so create them once, on the first open.

| Option                | Required | Meaning                                                                                                  |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `storage`             | yes      | Pi Durable `Storage`                                                                                     |
| `models`              | yes      | Pi `Models` with providers registered                                                                    |
| `chatModel`           | yes      | `{ provider, modelId }`, the default chat model. Must be in `modelChoices`                               |
| `timeZone`            | yes      | IANA zone, for memory's dates and schedules. Throws if invalid                                           |
| `memoryModel`         |          | The default model for memory's filing, which can be cheaper. Default `chatModel`                         |
| `modelChoices`        |          | `{ model, thinkingLevel }[]` on offer. Must include both defaults. Default `chatModel` at medium         |
| `hostInstructions`    |          | Added after each Familiar's persona, such as what your UI renders                                        |
| `account`             |          | `{ login }`: lets the owner sign in to `chatModel.provider`. OpenAI needs `getDeviceId`                  |
| `plugins`             |          | `FamiliarPlugin[]`                                                                                       |
| `defaultCapabilities` |          | `{ plugins?, mcp? }` a new Familiar uses. Used on the first open only                                    |
| `secrets`             |          | `SecretStore`, one per workspace. Without it, every secret is missing                                    |
| `fetch`               |          | Tools' network access. Default on Node: refuses every address that isn't public; elsewhere the runtime's |
| `mcpFetch`            |          | Fetch for owner-configured HTTP MCP servers                                                              |
| `mcpStdio`            |          | Factory for owner-configured local MCP commands. Without it, they show as failed                         |
| `images`              |          | `{ processor, maxPixels? }`. Without it, uploads are refused as `unavailable`. See [Images](#images)     |
| `codemodeSandbox`     |          | A JavaScript runner. With it, chats also get Code Mode                                                   |
| `contextBudget`       |          | Tokens per request before older context is compacted. Default 64,000                                     |
| `notify`              |          | Delivers scheduled replies and plugins' notifications. See [Notifications](#notifications)               |
| `maxSchedules`        |          | Schedules each Familiar keeps at once. Default 50                                                        |
| `people`              |          | `Author[]`: what people are called at first. Used on the first open only                                 |
| `onWake`              |          | For evictable hosts; replaces in-process timers. See [Host on Cloudflare](/familiar/build/cloudflare/)   |
| `now`, `setTimer`     |          | Clock and timer overrides, for tests                                                                     |

### Notifications

`notify(notification, context?)` receives `{ title, body, url? }`. A scheduled run also passes `{ scheduleId, creator }`, where `creator` is the `Author` who made the schedule, or `undefined`. A plugin's notification has no context.

Familiar never chooses recipients; your host does. The creator is attribution, not a recipient. [Serve the API](/familiar/build/serve-the-api/#notifications) has an example.

### Tool author

`await familiar(context).author()` is the person a tool call runs for: the message's author, or a scheduled run's creator. A chain of Familiar replies keeps the person who started it, and so do nested calls and calls rerun after a crash. It's `undefined` for memory filing and other work no person asked for. MCP tools don't receive it.

Familiar stores no permissions; a tool, or the API behind it, checks the author. See [Identity is not permission](/familiar/build/serve-the-api/#identity-is-not-permission).

## Workspace

**Familiars**

| Member                                                    | Meaning                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `familiars.list()`, `familiars.watch()`                   | `FamiliarSummary[]`: each `id`, `name`, and any `persona` and `avatar`                       |
| `familiars.create(identity)`                              | `{ name, persona?, avatar?, chatModel?, memoryModel?, capabilities? }`. Returns the Familiar |
| `familiars.update(id, change)`                            | Change any of those but `capabilities`; `null` returns one to the default                    |
| `familiars.get(id)`                                       | Its `WorkspaceFamiliar`, or `undefined`                                                      |
| `familiars.remove(id)`                                    | Remove it and stop its work                                                                  |
| `modelOptions()`                                          | Every model a Familiar may run on                                                            |
| `modelDefaults()`, `setModelDefaults({ chat?, memory? })` | The default chat and memory models, each with its `thinkingLevel`                            |
| `defaultCapabilities()`, `setDefaultCapabilities(change)` | The plugins and MCP connections new Familiars use                                            |

- Without a `persona`, a Familiar uses `defaultPersona(name)`. Its name also titles its notifications.
- An `avatar` is a string of up to 64 characters that your UI interprets; core never reads it.
- Without `capabilities`, a new Familiar uses the defaults. A plugin added to the workspace later is off for every Familiar until turned on.
- A removed Familiar leaves its named rooms, its DMs stay readable but refuse new messages, and rooms keep its replies.

**Rooms**

| Member                       | Meaning                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `rooms.list(person?)`        | `RoomListing[]`. With a host author ID: every named room and only that person's DMs |
| `rooms.watch(person?)`       | Watch of the same, by ID                                                            |
| `rooms.create(setup)`        | A named room, `{ name, familiars }`. Returns its ID                                 |
| `rooms.update(id, change)`   | Change a named room's name or Familiars. `archived: false` unarchives it            |
| `rooms.archive(id)`          | Hide a named room and close it to messages, keeping its history                     |
| `rooms.dm(familiar, person)` | The DM between a Familiar and a person, by host author ID, created if new           |
| `rooms.get(id, person?)`     | A `RoomApi`. With a host author ID, `undefined` for someone else's DM               |

A `RoomListing` is the room's setup plus `last`, its newest entry worth showing; `unread`, the entries the person hasn't read; and `turns`, each turn in progress as `{ familiar, status }`. The [client reference](/familiar/reference/client/#rooms-list) has the full type.

Each `RoomApi` has:

| Member                                                  | Meaning                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `post({ author, text, requestId, mentions?, images? })` | Post a message and start the turns it causes. Returns its entry ID             |
| `note({ text, requestId })`                             | Post a note: context the Familiars see on their next turn, with no reply       |
| `watch(window?)`                                        | The log's view, then each commit. Default the newest 50 entries, or `{ from }` |
| `watchTurns()`                                          | Activity by Familiar: `queued`, `elsewhere` or `running` with the reply so far |
| `read(person, entry)`                                   | Move a person's read marker forward to `entry`                                 |
| `history(query, limit)`                                 | Pi's `{ items, next? }` page                                                   |
| `retry(reply)`                                          | Try a failed reply's turn again, by its entry ID                               |
| `stop()`                                                | Stop this room's turns                                                         |

- **Who answers.** A DM's message goes to its Familiar. In a named room, it goes to the Familiars it mentions, or all of them if it mentions none. Each decides whether to reply, and can call `stay_quiet` to post nothing.
- **Mentions** are `{ kind: 'familiar' | 'person', id, start, end }`, spanning an `@Name` in the text. A mention of a Familiar outside the room throws `MessageError`.
- **Request IDs.** A repeated `requestId` from the same author posts once and returns the first entry. It's stored in the entry's data, so a client can match a pending message to it.
- **Familiars talking to each other.** A reply goes to the other Familiars it mentions, or all of them. A chain stops being delivered at depth 10 since a person last spoke.
- **One input at a time.** Each Familiar handles one input at a time across all its rooms. A reply, with its tool calls, is posted once its run ends.
- An archived room, or a removed Familiar's DM, throws `RoomError` on `post`.

**Each Familiar**, a `WorkspaceFamiliar`

| Member                                            | Meaning                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `id`                                              | Its `FamiliarId`                                                      |
| `models()`                                        | Each chat model with its `name` and supported `thinkingLevels`        |
| `watchModel()`                                    | Its model and level, Pi's `AgentState`                                |
| `setModel(ref)`, `setThinkingLevel(level)`        | Its own chat model, and the current model's level. Throw `ModelError` |
| `capabilities()`, `setCapabilities(change)`       | `{ plugins, mcp }` it uses. Each list given replaces that kind        |
| `watch()`                                         | Its working context across every room, for inspection. Never show it  |
| `memory.watch()`                                  | Its memory's subjects                                                 |
| `memory.page(subject)`, `memory.journal(month)`   | A subject's `{ profile, notes }`, and a month's journal lines         |
| `memory.section()`                                | The memory section of the prompt, as the model sees it                |
| `memory.forget(note)`                             | Forget a note; its page's profile is cleared until that night         |
| `schedules.watch()`                               | Its schedules                                                         |
| `schedules.cancel(id)`, `pause(id)`, `resume(id)` | A paused one-off whose time passes runs, late, once resumed           |

**Shared**

| Member                                                       | Meaning                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `people.get(author)`, `people.watch(author)`                 | An `Author` with the name they chose, if any                            |
| `people.rename(id, name)`                                    | What Familiars call a person, from their next message                   |
| `connections.list()`                                         | Plugin and MCP connections, their tools, and whether each secret is set |
| `connections.setSecret(connection, name, value)`             | Store a secret. `connection` is `{ kind, name }`                        |
| `connections.deleteSecret(connection, name)`                 | Remove a secret                                                         |
| `connections.updateToolSettings(connection, tool, change)`   | `{ enabled?, askBeforeRunning?, runInBackground? }`                     |
| `mcp.add(server)`, `mcp.remove(name)`, `mcp.reconnect(name)` | Owner-configured MCP servers. `add` throws `McpConfigError`             |
| `images.upload(bytes)`, `images.get(id)`                     | See [Images](#images)                                                   |
| `questions.answer(familiar, id, answer)`                     | Answer a tool approval, an MCP server's question or a private form      |
| `account`                                                    | The account's API, if `account` was passed                              |

**Lifecycle**

| Member               | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `usage()`            | Pi's usage totals                                                             |
| `wake()`, `resume()` | For hosts that pass `onWake`                                                  |
| `closed`             | Settles on dismissal or a storage failure. A failed instance must be reopened |
| `dismiss()`          | Close the workspace, its account, MCP connections and plugins                 |
| `plugins`            | The plugins it was opened with, whose routes `createHttpApi` mounts           |

## Images

Pass `images: { processor }` to take them: `createNodePhotonImages()` from `@familiar-ai/core/node`, or `createCloudflarePhotonImages()` from `@familiar-ai/cloudflare/images`. `maxPixels` refuses larger images before decoding; default 40 million.

`images.upload(bytes)` prepares an image (upright, at most 1568 pixels on its longest side) and stores it, returning an `ImageRef`, `{ id, mimeType, width, height }`. It rejects with an `ImageError` whose `code` is `unsupported`, `too-large`, `unreadable` or `unavailable`, for your host to word. Post the IDs with the message; `post` throws `ImageError` `missing` for one that isn't stored. An upload no message claims is removed after a day.

Only the Familiars a message is delivered to see its images. Others, and memory, see how many there were.

## Types

`Author` is `{ id, name }`, both non-empty. `id` is stable and yours. `name` is captured when each message is posted.

| Limit                                   | Value    | Bounds                                                    |
| --------------------------------------- | -------- | --------------------------------------------------------- |
| `MESSAGE_LIMITS.text`                   | 128,000  | Characters of a message or note. May be empty with images |
| `MESSAGE_LIMITS.authorId`, `authorName` | 256, 128 | Characters of an `Author`                                 |
| `MESSAGE_LIMITS.requestId`              | 128      | Characters. Unique per author                             |
| `IMAGE_LIMITS.count`                    | 10       | Images per message                                        |
| `IMAGE_LIMITS.upload`                   | 20 MB    | Bytes an upload may be before it's prepared               |
| `SCHEDULE_LIMITS.prompt`                | 2,000    | Characters of a schedule's prompt                         |
| `SCHEDULE_LIMITS.repeat`                | 256      | Characters of a repeat's cron expression                  |

A message outside these throws `MessageError`, posting nothing.

A repeat is a five-field cron expression in the workspace's time zone, read by [Croner](https://croner.56k.guru/), such as `0 7 * * 1-5` for 07:00 on weekdays. It runs at most hourly: closer occurrences are skipped.

**MCP.** One connection is one session under one account, shared by every Familiar that uses it. For separate accounts, add separate named connections. `mcp.add` saves any well-shaped server and connects through `mcpFetch` or `mcpStdio`, which decide what's allowed. One that fails shows `{ type: 'failed', error }` in `connections.list()`; an HTTP server missing its bearer token shows `needs-auth`.

Every type and error named on this page is exported from `@familiar-ai/core`. The `schema` namespace re-exports the pinned `@earendil-works/pi-schema`, including `schema.obj`, `schema.str`, `schema.opt` and `schema.oneOf`.
