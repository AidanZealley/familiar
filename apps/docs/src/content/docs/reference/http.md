---
title: HTTP API and events
description: Every route createHttpApi serves, and the server-sent events each stream sends.
---

`createHttpApi(workspace, options)` serves these routes, relative to wherever you mount it, such as `/api`. [`packages/core/src/http`](https://github.com/AidanZealley/familiar/tree/main/packages/core/src/http) owns the contract, and the client imports its types.

Each request goes through, in order:

1. `authenticate`: `undefined` answers 401.
2. The body limit, `maxBodySize` (default `DEFAULT_MAX_BODY_SIZE`, 20 MiB + 64 KiB, room for one image upload): 413.
3. `allow(author, operation, resource)`: anything but `true` answers 403. The operation is in the tables below, and `resource` is `{ familiar }` or `{ room }` from the path. See [Decide who may do what](/familiar/build/serve-the-api/#decide-who-may-do-what).
4. The route: 404 for a Familiar or room that doesn't exist. Someone else's DM is always 404, whatever `allow` says.

Errors are JSON `{ error }`.

## Familiars

Operations `familiars.*`, `model.*`, `capabilities.*` and `questions.answer`, asked with `{ familiar }` except `list` and `create`. `…` is `/familiars/:familiar`.

| Route                        | Operation                | Body                                                                   | Answers                 |
| ---------------------------- | ------------------------ | ---------------------------------------------------------------------- | ----------------------- |
| `GET /familiars`             | `familiars.list`         |                                                                        | 200 `FamiliarSummary[]` |
| `POST /familiars`            | `familiars.create`       | `{ name, persona?, avatar?, chatModel?, memoryModel?, capabilities? }` | 201 `{ id }`            |
| `PATCH …`                    | `familiars.update`       | `{ name?, persona?, avatar?, chatModel?, memoryModel? }`               | 204                     |
| `DELETE …`                   | `familiars.remove`       |                                                                        | 204                     |
| `POST …/dm`                  | `familiars.dm`           |                                                                        | 200 `{ room }`          |
| `GET …/model/options`        | `model.options`          |                                                                        | 200 `ModelOption[]`     |
| `PUT …/model`                | `model.set`              | `{ provider, modelId }`                                                | 204                     |
| `PUT …/model/thinking-level` | `model.setThinkingLevel` | `{ level }`                                                            | 204                     |
| `GET …/capabilities`         | `capabilities.get`       |                                                                        | 200 `{ plugins, mcp }`  |
| `PUT …/capabilities`         | `capabilities.set`       | `{ plugins?, mcp? }`                                                   | 204                     |
| `POST …/questions/:question` | `questions.answer`       | `Answer`                                                               | 204; 409 already gone   |

- A model must be one of the workspace's `modelChoices`, or the request answers 400. A `memoryModel` may add a `thinkingLevel`. `null` returns a persona, avatar or model to the default.
- An avatar is a string of up to 64 characters that your UI interprets.
- `dm` gets or creates the DM between that Familiar and the person asking.
- Capabilities are plugin and MCP connection names. Each list given replaces that kind. Without `capabilities`, a new Familiar uses the workspace's defaults.
- Removing a Familiar stops its work. Its DMs stay readable but refuse new messages.
- An `Answer` is `{ action: 'accept', content? }` or `{ action: 'decline' }`, for a tool approval, an MCP server's question or a plugin's private form.

**Workspace defaults**, operations `defaults.get` and `defaults.set`:

| Route                        | Body                 | Answers                         |
| ---------------------------- | -------------------- | ------------------------------- |
| `GET /defaults/models`       |                      | 200 `{ chat, memory, options }` |
| `PUT /defaults/models`       | `{ chat?, memory? }` | 204                             |
| `GET /defaults/capabilities` |                      | 200 `{ plugins, mcp }`          |
| `PUT /defaults/capabilities` | `{ plugins?, mcp? }` | 204                             |

Each default model is `{ provider, modelId, thinkingLevel? }`.

## Rooms

Operations `rooms.*`, asked with `{ room }` except `list` and `create`.

| Route                         | Operation       | Body                                      | Answers                |
| ----------------------------- | --------------- | ----------------------------------------- | ---------------------- |
| `GET /rooms`                  | `rooms.list`    |                                           | 200 `RoomListing[]`    |
| `POST /rooms`                 | `rooms.create`  | `{ name, familiars }`                     | 201 `{ id }`           |
| `PATCH /rooms/:room`          | `rooms.update`  | `{ name?, familiars?, archived: false? }` | 204                    |
| `DELETE /rooms/:room`         | `rooms.archive` |                                           | 204                    |
| `POST /rooms/:room/messages`  | `rooms.post`    | `{ text, requestId, mentions?, images? }` | 202 `{ entry }`        |
| `POST /rooms/:room/images`    | `rooms.post`    | the image's bytes                         | 201 `ImageRef`         |
| `GET /rooms/:room/images/:id` | `rooms.history` |                                           | 200 the image          |
| `POST /rooms/:room/notes`     | `rooms.note`    | `{ text, requestId }`                     | 202 `{ entry }`        |
| `POST /rooms/:room/read`      | `rooms.read`    | `{ entry }`                               | 204                    |
| `GET /rooms/:room/history`    | `rooms.history` |                                           | 200 `{ items, next? }` |
| `POST /rooms/:room/retry`     | `rooms.retry`   | `{ reply }`                               | 202                    |
| `POST /rooms/:room/stop`      | `rooms.stop`    |                                           | 202                    |

A refused message, note or room change answers 400.

- **Rooms.** `GET /rooms` lists every named room and the person's own DMs. Archiving hides a named room and closes it to messages; `archived: false` reopens it. A DM can't be archived.
- **Messages.** The author is whoever `authenticate` returned. Make one `requestId` per message and reuse it on every retry: a repeat from the same author posts once and answers the first entry. The entry's data carries the `requestId`, so a client can match its pending message to the entry the stream delivers. Bounds are `MESSAGE_LIMITS` and `IMAGE_LIMITS` in the [Core API](/familiar/reference/core/#types).
- **Mentions** are `{ kind: 'familiar' | 'person', id, start, end }`, the span of an `@Name` in the text. In a named room, a message goes to the Familiars it mentions, or all of them if it mentions none.
- **Notes** are context for the room's Familiars, such as "Sam joined". No one replies to them. They're for the host's code, not people.
- **Read** moves the person's read marker forward to `entry`. Their own messages move it too.
- **Retry** takes a failed reply's entry ID. Its Familiar answers the same entry again; asking twice starts it once.
- **Stop** stops that room's turns only.
- **History** takes Pi's inclusive `minEntryId` and `maxEntryId`, `order` (`ascending` or `descending`, the default) and `limit` (1–200, default 50), and answers Pi's page.

### Images

Upload each image as soon as it's attached, then post the message with the IDs, up to 10.

- The upload body is the raw bytes, up to 20 MB. Any `Content-Type` works: Familiar reads the type from the bytes.
- The host prepares it with Photon, at most 1568 pixels on the longest side. The ID is a hash of the prepared bytes.
- Refusals answer `{ error, code }`: 415 `unsupported` (not PNG, JPEG, GIF or WebP), 422 `too-large` or `unreadable`, and 501 `unavailable` when the host passed no `images` option. A message naming an image that isn't stored answers 400 `missing`.
- An upload no message names is removed after a day. Posting keeps it for good.
- `GET /rooms/:room/images/:id` is cacheable forever, so use it as an `<img src>`.

## Memory and schedules

Asked with `{ familiar }`, under `/familiars/:familiar`.

| Route                              | Operation          | Answers                  |
| ---------------------------------- | ------------------ | ------------------------ |
| `GET …/memory/section`             | `memory.read`      | 200 `{ text }`           |
| `GET …/memory/pages/:subject`      | `memory.read`      | 200 `{ profile, notes }` |
| `GET …/memory/journal/:month`      | `memory.read`      | 200 `{ lines }`          |
| `POST …/memory/notes/:note/forget` | `memory.forget`    | 204                      |
| `DELETE …/schedules/:id`           | `schedules.cancel` | 204                      |
| `POST …/schedules/:id/pause`       | `schedules.pause`  | 204                      |
| `POST …/schedules/:id/resume`      | `schedules.resume` | 204                      |

Each answers 404 for no such subject, note or schedule. A month is `YYYY-MM`. A paused schedule keeps its `next` time; a one-off that falls due meanwhile runs, late, once resumed.

## The person asking

| Route       | Operation   | Body       | Answers            |
| ----------- | ----------- | ---------- | ------------------ |
| `GET /me`   | `me.get`    |            | 200 `{ id, name }` |
| `PATCH /me` | `me.update` | `{ name }` | 204                |

The name set here wins over the one `authenticate` gives, from the person's next message.

## Account

Every route answers 404 when the host passed no `account`.

| Route                          | Operation              | Body       | Answers            |
| ------------------------------ | ---------------------- | ---------- | ------------------ |
| `GET /account`                 | `account.state`        |            | 200 `AccountState` |
| `POST /account/sign-in`        | `account.signIn`       |            | 202                |
| `POST /account/sign-in/answer` | `account.answerSignIn` | `{ text }` | 202                |
| `DELETE /account/sign-in`      | `account.cancelSignIn` |            | 204                |
| `POST /account/sign-out`       | `account.signOut`      |            | 204                |

## Push

Every route answers 404 when the host passes no `push`. Familiar validates the subscription and hands it to the `PushHost` with the authenticated `Author`.

| Route                        | Operation          | Body                        | Answers       |
| ---------------------------- | ------------------ | --------------------------- | ------------- |
| `GET /push/key`              | `push.key`         |                             | 200 `{ key }` |
| `POST /push/subscriptions`   | `push.subscribe`   | `PushSubscription.toJSON()` | 204           |
| `DELETE /push/subscriptions` | `push.unsubscribe` | `PushSubscription.toJSON()` | 204           |

## Connections and MCP

| Route                                                 | Operation                        | Body                   | Answers                |
| ----------------------------------------------------- | -------------------------------- | ---------------------- | ---------------------- |
| `GET /connections`                                    | `connections.list`               |                        | 200 `ConnectionInfo[]` |
| `PUT /connections/:kind/:name/secrets/:secret`        | `connections.setSecret`          | `{ value }`            | 204                    |
| `DELETE /connections/:kind/:name/secrets/:secret`     | `connections.deleteSecret`       |                        | 204                    |
| `PATCH /connections/:kind/:name/tools/:tool/settings` | `connections.updateToolSettings` | part of `ToolSettings` | 204                    |
| `POST /mcp`                                           | `mcp.add`                        | `McpServer`            | 201                    |
| `DELETE /mcp/:name`                                   | `mcp.remove`                     |                        | 204                    |
| `POST /mcp/:name/reconnect`                           | `mcp.reconnect`                  |                        | 202                    |

- `:kind` is `plugin` or `mcp`. A missing connection or server answers 404.
- Secret values must be visible ASCII. No route returns one.
- Tool settings are `{ enabled, askBeforeRunning, runInBackground }`; send any of them.
- `POST /mcp` answers 400 for a malformed server and 404 for a name already taken. Any other server is saved; one that can't connect shows as `failed` in `GET /connections`.

```ts
type McpServer = {
  name: string // lowercase letters, digits and hyphens, up to 32
  transport:
    | { type: 'http'; url: string; auth: { type: 'none' | 'bearer' } }
    | { type: 'stdio'; command: string; args?: string[] }
}
```

## Plugin routes

A plugin's own routes are under `/plugins/<name>/familiars/:familiar`, asked as `plugins.<name>` with `{ familiar }`. See [routes](/familiar/reference/plugins/#routes).

## Events

Three server-sent event streams. Each source is its own `allow` operation:

- `GET /events`: `events.familiars`, `events.rooms`, `events.me` and `events.account`, each sending the document of that name (`account` as its own event).
- `GET /familiars/:familiar/events`: `events.model`, `events.memory` and `events.schedules`.
- `GET /rooms/:room/events`: `events.room`, sending the log's `view` and `ops`, then the `turns` document.

`allow` is asked once per source when a stream connects, so revoking access applies from the next connection. A stream every source refuses answers 403.

| Event          | Data                     | Meaning                                            |
| -------------- | ------------------------ | -------------------------------------------------- |
| `protocol`     | `{ version: 8 }`         | Always first. Stop if you don't speak it           |
| `view`         | Pi's `ConversationView`  | The room log's view, whole                         |
| `ops`          | Chord ops                | Each commit's changes to the view                  |
| `document`     | `{ name, value }`        | A whole document                                   |
| `document.ops` | `{ name, ops }`          | Each commit's changes to that document             |
| `account`      | `AccountState` or `null` | The sign-in state, whole; `null` with no `account` |

- Apply ops in order to the last whole value. After a reconnect, everything arrives whole again.
- A room's view starts at its newest entries, or at `?from=<entry>`, so a reconnecting client misses nothing.
- `rooms` lists each room as `GET /rooms` does, with its newest entry, unread count and turns, so a room list needs no stream per room.
- `turns` holds at most one entry per Familiar: `queued`, `elsewhere` (busy in another room) or `running` with the reply so far.
- The server sends a comment every 15 seconds to keep the connection open.
