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

| Option             | Required | Meaning                                                                                                                                                                                                     |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`          | yes      | Pi Durable `Storage`                                                                                                                                                                                        |
| `models`           | yes      | Pi `Models` with providers registered                                                                                                                                                                       |
| `chatModel`        | yes      | `{ provider, modelId }` a new Familiar's chat starts on. Must be in `modelChoices`                                                                                                                          |
| `memoryModel`      |          | `{ provider, modelId }` memory upkeep runs on, at its level in `modelChoices`, unless a Familiar picks another. Background memory work can use a cheaper model than the chat. Default: `chatModel`          |
| `timeZone`         | yes      | IANA zone. Throws if invalid                                                                                                                                                                                |
| `modelChoices`     |          | `{ model, thinkingLevel }[]` the installation offers: what people may switch a chat to, and what a Familiar's memory may run on. Must include `chatModel` and `memoryModel`. Default: `chatModel` at medium |
| `hostInstructions` |          | What the host adds after each Familiar's persona, such as what its UI renders                                                                                                                               |
| `account`          |          | `{ login }`: lets the owner sign in to `chatModel.provider`. `login` is Pi's `LoginOptions`; OpenAI needs `getDeviceId`                                                                                     |
| `plugins`          |          | `FamiliarPlugin[]`                                                                                                                                                                                          |
| `secrets`          |          | `SecretStore`. Without it, every secret is missing                                                                                                                                                          |
| `fetch`            |          | `PluginFetch` for tools, used as given. Refuse private destinations the process can reach. Default: on Node, a fetch that refuses every address that isn't public; elsewhere, the runtime's                 |
| `mcpFetch`         |          | `PluginFetch` for owner-configured HTTP MCP servers                                                                                                                                                         |
| `mcpStdio`         |          | `McpStdioFactory` for owner-configured local MCP commands                                                                                                                                                   |
| `contextBudget`    |          | Tokens per request before a Familiar's older context is compacted. Default 64,000                                                                                                                           |
| `notify`           |          | `Notify`: delivers scheduled replies and plugins' notifications. See [Notifications](#notifications)                                                                                                        |
| `maxSchedules`     |          | Most schedules each Familiar keeps at once, a positive whole number. Default `DEFAULT_MAX_SCHEDULES`, 50                                                                                                    |
| `maxHandoffs`      |          | Most handoffs in a row between a room's Familiars before `hand_off` refuses, a positive whole number. Default `DEFAULT_MAX_HANDOFFS`, 3                                                                     |
| `people`           |          | `Author[]`: what people are called at first, by host author ID, such as an owner. Used on the first open only; after that, each person's name is theirs to change with `people.rename`                      |
| `onWake`           |          | For evictable hosts. Replaces in-process timers. See [Host on Cloudflare](/familiar/build/cloudflare/)                                                                                                      |
| `now`, `setTimer`  |          | Clock and timer overrides, mainly for tests                                                                                                                                                                 |

### Notifications

`notify(notification, context?)` receives `{ title, body, url? }`, the same for everyone who sees it. A scheduled run also passes a `NotificationContext`, `{ scheduleId, creator }`. `creator` is the `Author` stored with the schedule when it was made, unchanged by restarts or later renames, and `undefined` when no person asked for it. A plugin's notification has no context.

Familiar never chooses recipients. Your host decides who sees each notification, in which tenant, and how: through Web Push with `PushHost`, or its own notification preferences and delivery. The creator is attribution, not a recipient: a reminder's turn answers it in the room it was made in, where others may also want it, and the host may send it to none of them.

[Serve the API](/familiar/build/serve-the-api/#notifications) has a tenant's `notify` that delivers through the app's own preferences.

### Tool author

A workspace's plugins and MCP connections are assigned to Familiars, which opt in: a new one uses what `familiars.create` was given, else the workspace's default tools (`defaultCapabilities()`, `setDefaultCapabilities()`, and the `openWorkspace` option `defaultCapabilities`, used on the first open only), and one added to the workspace later is off until it's turned on with `setCapabilities`. Core's own tools are always on, and tool search comes with any MCP connection. A Familiar's tools are available for everyone who talks to it. A tool reads the person a call runs for with `await familiar(context).author()`, an `Author` or `undefined`, resolved from the stored input that started the call, never from its arguments. It is the message's author, or a scheduled run's creator. A turn handed on with `hand_off` runs for whoever started the chain, since the Familiar that handed it on already acted for them. Nested calls and calls rerun after a crash keep it, and a message queued later can't replace it. It's `undefined` for memory upkeep and any other input with no person behind it. MCP tools don't receive it.

Familiar stores no permissions. A tool, or the app API behind it, enforces narrower rules about its data and actions against that author. See [Serve the API](/familiar/build/serve-the-api/#identity-is-not-permission).

## Workspace

**Familiars**

| Member                                        | Meaning                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `familiars.list()`                            | `FamiliarSummary[]`: each Familiar's `id`, `name`, and any `persona` and `avatar`        |
| `familiars.watch()`                           | Watch of who each Familiar is                                                            |
| `familiars.create({ name, persona, avatar })` | Create one, returning its `WorkspaceFamiliar`. Throws a `TypeError` for a blank one      |
| `familiars.update(id, change)`                | Change its name, persona or avatar; a `null` persona or avatar returns it to the default |
| `familiars.get(id)`                           | Its `WorkspaceFamiliar`, or `undefined`                                                  |
| `familiars.remove(id)`                        | Remove it, stopping its work. Throws for no such Familiar                                |

Without a `persona`, a Familiar introduces itself with `defaultPersona(name)`. Its name also titles its notifications and its memory upkeep's prompts. An `avatar` is a short string, at most 64 characters, that your UI interprets, such as an index into its set of portraits; core keeps it and never reads it, and without one your UI derives one from the ID.

Removing a Familiar stops its turns in every room, its chat's queue, its schedules and its memory upkeep, and retires its memory, schedules and settings. It leaves every named room: a room it led becomes open, and one it leaves with no Familiars is archived. Its DMs stay readable but `post` throws a `RoomError` there. Rooms keep its replies, under its name at the time, and shared plugins, connections and secrets stay.

**Rooms**

| Member                       | Meaning                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `rooms.list(person?)`        | `RoomSummary[]`, each room as a list shows it; with a host author ID, only that person's DMs and every named room, with what they haven't read |
| `rooms.watch(person?)`       | Watch of the same, by ID                                                                                                                       |
| `rooms.create(setup)`        | A named room, `{ name, familiars, lead? }`, returning its ID. Throws `RoomError` when refused                                                  |
| `rooms.update(id, change)`   | Change a named room's name, Familiars or lead; `lead: null` opens it, and `archived: false` unarchives it                                      |
| `rooms.archive(id)`          | Hide a named room and close it to new messages, keeping its history                                                                            |
| `rooms.dm(familiar, person)` | The DM between a Familiar and a person, by host author ID, created if new                                                                      |
| `rooms.get(id, person?)`     | A room's API; with a host author ID, undefined for someone else's DM, as the HTTP API uses it                                                  |

A list shows each room as a `RoomListing`: its setup, with `last`, its newest entry worth showing (`{ entry, at, text }` and who it's from by `kind`: a person's `message`, a Familiar's `reply` with its `outcome`, a `handoff` or `reminder`, or a host's `note`), `unread`, how many entries the person hasn't read, and `turns`, each turn in progress as `{ familiar, status }`. A reply that stayed quiet is never `last`, and a `last` reply whose `outcome` is `failed` means the room's last turn failed. `last` and the read markers are kept as each entry is posted; `turns` is derived from the turns in progress and the Familiars' chats, never stored. Unarchiving checks the room's setup, so one its last Familiar left needs Familiars in the same change.

`lead` answers a named room's messages that mention no Familiar. A room without one is open: every Familiar in it takes a turn on such a message, one after another in the room's order, each shown the replies before it. Each `RoomApi` has:

| Member                                         | Meaning                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `post({ author, text, requestId, mentions? })` | Post a message and start the turns it causes, returning its entry ID. A repeated `requestId` posts once                                     |
| `note({ text, requestId })`                    | Post a host's note: shown to each Familiar in the room on its next turn, with no turn of its own. Returns its entry ID                      |
| `watch()`                                      | The log's committed view as `value`, then `start(listener)` and `stop()`                                                                    |
| `watchTurns()`                                 | Its turns in progress: each one `queued`, `elsewhere` or `running`, with the reply so far                                                   |
| `read(person, entry)`                          | Mark it read by a person, by host author ID, up to `entry`, the newest they've seen; never back. Their own messages mark it read up to them |
| `history(before, limit)`                       | `{ entries, more }`: committed entries older than `before`, newest first                                                                    |
| `retry(reply)`                                 | Try a failed reply's turn again, by its entry ID: its Familiar answers the same entry anew, after it. Asking twice starts it once           |
| `stop()`                                       | Stop this room's turns, leaving other rooms' work alone                                                                                     |

A DM's Familiar answers every message; in a named room, each Familiar a message mentions answers it, else the lead, else, in an open room, each Familiar in turn. A mention is `{ kind: 'familiar' | 'person', id, start, end }`, the span of an `@Name` in the text; `post` throws a `MessageError` for one that doesn't span an `@` or names a Familiar not in the room, and a `RoomError` for an archived room. A Familiar works one turn at a time, across all its rooms, and is shown what it missed in a room when it next takes a turn there. Its reply, with its tool calls, is copied into the room's log as a `familiar.reply` entry when the turn ends.

A note is a `familiar.note` entry, `{ text, at }`: context for the room's Familiars, such as "Sam joined" or "the board was updated", that causes no turn, so no one replies to it. It reads in catch-up as `[Note]: …`, and takes the same text bounds as a message. It is for short passing context; a Familiar sees it once, and then it lives in that Familiar's working context only.

Familiars take part with two tools of their own. `stay_quiet` ends a turn without a word, for one that wasn't addressed directly and has nothing to add; its reply's `outcome` is `quiet`, and it shows nothing in catch-up. `hand_off({ to, note })` asks another Familiar in the same room to take a turn: it posts a `familiar.handoff` entry, `{ from, to, note, hops, cause, at }`, and the Familiar it names answers the note in the room. A chain of handoffs longer than `maxHandoffs` is refused, and the room's Stop stops handoff turns like any other.

**Each Familiar**, a `WorkspaceFamiliar`

| Member                                        | Meaning                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                          | Its `FamiliarId`                                                                                                                      |
| `models()`                                    | `ModelOption[]`: each chat model with its `name` and supported `thinkingLevels`                                                       |
| `watchModel()`                                | Watch of its model and level, Pi's `AgentState`                                                                                       |
| `setModel(ref)`                               | Switch model. Throws `ModelError` if it isn't offered                                                                                 |
| `setThinkingLevel(level)`                     | Change the current model's level. Throws `ModelError` if unsupported                                                                  |
| `capabilities()`                              | `{ plugins, mcp }`: the plugin and MCP connection names it uses                                                                       |
| `setCapabilities({ plugins?, mcp? })`         | Each list given replaces what it uses of that kind, from its next request. Throws a `CapabilityError` for a name the workspace hasn't |
| `watch()`                                     | Its working context across every room, for inspection: never show it to people                                                        |
| `memory.watch()`, `memory.watchEpisodes()`    | Document watches for facts and episodes                                                                                               |
| `memory.revise(id, text)`                     | Save a new version of a fact, true from today                                                                                         |
| `memory.retire(id)`                           | Mark a fact no longer true from today                                                                                                 |
| `memory.setPinned(id, pinned)`                | Pin a fact into core or unpin it                                                                                                      |
| `schedules.watch()`                           | Document watch for schedules                                                                                                          |
| `schedules.cancel(id)`                        | Cancel a schedule. Rejects if there's no such schedule                                                                                |
| `schedules.pause(id)`, `schedules.resume(id)` | Stop a schedule running, keeping its `next`, and run it again. Rejects as `cancel`                                                    |

Memory edits reject, changing nothing, when the fact is missing or already past. A paused schedule has `paused: true`. A paused repeat skips the times that fall due, so its `next` stays the time it would run; a paused one-off whose time passes runs, late, once resumed.

**Shared**

| Member                                                       | Meaning                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `connections.list()`                                         | Plugin and MCP connections, with their tools' descriptions and whether each secret is set                       |
| `people.get(author)`, `people.watch(author)`                 | An `Author` as Familiars know them: with the name they chose, if any                                            |
| `people.rename(id, name)`                                    | What Familiars call a person, by host author ID, from their next message. Throws a `TypeError` for a blank name |
| `connections.setSecret(connection, name, value)`             | Store a secret. `connection` is `{ kind: 'plugin' \| 'mcp', name }`                                             |
| `connections.deleteSecret(connection, name)`                 | Remove a secret                                                                                                 |
| `mcp.add(server)`, `mcp.remove(name)`, `mcp.reconnect(name)` | Manage owner-configured MCP servers. `add` throws `McpConfigError`                                              |
| `account`                                                    | The account's API, if `account` was passed                                                                      |

**Lifecycle**

| Member               | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `onCommit(listener)` | Called synchronously after every commit. Returns an unsubscribe function      |
| `usage()`            | Pi's usage totals for the workspace                                           |
| `wake()`, `resume()` | For hosts that pass `onWake`                                                  |
| `closed`             | Settles on dismissal or a storage failure. A failed instance must be reopened |
| `dismiss()`          | Close the workspace, its account and its MCP connections                      |

## Types

`Author` is `{ id: string; name: string }`. Both must be non-empty. `id` is stable and owned by the host. `name` is captured when the message is posted: the name the person chose with `people.rename`, if they have, else the host's.

`post` throws a `MessageError`, posting nothing, unless the author's `id` and `name` and the `text` are non-empty and within `MESSAGE_LIMITS` (256, 128 and 128,000 characters) and `requestId` is 1 to 128 characters. Familiar namespaces each `requestId` by the author's `id`, so it only needs to be unique per author and can never match one of Familiar's own submissions, such as a schedule's.

Schedules are bounded too: a prompt is at most `SCHEDULE_LIMITS.prompt` (2,000) characters, and a repeat is a five-field cron expression of at most `SCHEDULE_LIMITS.repeat` (256) characters, read in Familiar's time zone, such as `0 7 * * 1-5` for 07:00 on weekdays. [Croner](https://croner.56k.guru/) reads it, including its extensions such as `L` and `#`, and decides daylight saving: a time the clock skips runs when the clock resumes. When a time is shown twice, a daily or less frequent repeat runs only the first time, while an hourly one such as `30 * * * *` runs at both. A repeat runs at most hourly: each occurrence is at least an hour after the one before, and closer ones, such as most of `*/5 * * * *`, are skipped.

One MCP connection is one session with its server, under one account, shared by every Familiar that uses it, so they share its state. For separate accounts, add separate named connections and assign each to its Familiar.

`add` throws `McpConfigError`, saving nothing, for a server of the wrong shape: a bad name, an unknown transport, or a URL that isn't `http://` or `https://` or carries credentials, a query or a fragment. Familiar saves any server of the right shape and connects through the transport the host passed, `mcpFetch` or `mcpStdio`. The host owns which protocols, destinations and commands those transports allow. A server whose transport the host didn't pass, or whose connection fails, shows `{ type: 'failed', error }` in `connections.list()` and never stops Familiar opening. An HTTP server with a bearer token and no token set shows `needs-auth`.

`Workspace`, `WorkspaceFamiliar`, `RoomApi`, `RoomsApi`, `Room`, `RoomMessage`, `Mention`, `ReplyData`, `HistoryPage`, `ModelChoice`, `ModelOption`, `Notification`, `NotificationContext`, `Notify`, `MemoryApi`, `SchedulesApi`, `ConnectionsApi`, `McpApi`, `McpServer`, `AccountState` and the plugin types are all exported from `@familiar-ai/core`, with `MESSAGE_LIMITS`, `MessageError`, `RoomError`, `CapabilityError`, `SCHEDULE_LIMITS`, `DEFAULT_MAX_SCHEDULES` and `McpConfigError`.
