---
title: HTTP API and events
description: Every route createHttpApi can serve, and the server-sent events at /events.
---

`createHttpApi(workspace, options)` serves every route below, for three resources: the workspace, each Familiar and each room. Its `allow` policy is asked about each request by the operation named in the tables, as `group.name` such as `rooms.post`, and for a Familiar's or a room's operation with its ID: `allow(author, 'rooms.post', { room: 12 })`. See [Decide who may do what](/familiar/build/serve-the-api/#decide-who-may-do-what).

Paths are relative to wherever you mount the API, such as `/api`. Every request passes through `authenticate` first and answers `401 { "error": "unauthorized" }` when it returns `undefined`. A request body over `maxBodySize` (default `DEFAULT_MAX_BODY_SIZE`, 1 MiB) then answers 413 before any route reads it. A request `allow` refuses answers `403 { "error": "forbidden" }`. Only then does a route look up its Familiar or room, answering 404 when there's none. Other errors are JSON `{ "error": string }`.

[`packages/core/src/http/index.ts`](https://github.com/AidanZealley/familiar/blob/main/packages/core/src/http/index.ts) owns the contract. The client imports its types, so a change on one side is a type error on the other.

## Routes

People talk to Familiars only in rooms. A DM is a room with one Familiar and one person, and only that person can reach it: to anyone else every `/rooms/:room` route answers 404, whatever `allow` says, as if it didn't exist. A named room has one or more Familiars and is open to everyone `allow` lets in.

**Familiars**, `familiars.*` and each Familiar's `model.*` and `capabilities.*`, asked with `{ familiar }` except `list` and `create`

| Operation                | Method and path                                 | Body                           | Success                 | Errors          |
| ------------------------ | ----------------------------------------------- | ------------------------------ | ----------------------- | --------------- |
| `familiars.list`         | `GET /familiars`                                |                                | 200 `FamiliarSummary[]` |                 |
| `familiars.create`       | `POST /familiars`                               | `{ name, persona?, avatar? }`  | 201 `{ id }`            | 400 blank       |
| `familiars.update`       | `PATCH /familiars/:familiar`                    | `{ name?, persona?, avatar? }` | 204                     | 400 blank       |
| `familiars.remove`       | `DELETE /familiars/:familiar`                   |                                | 204                     | 404             |
| `familiars.dm`           | `POST /familiars/:familiar/dm`                  |                                | 200 `{ room }`          |                 |
| `model.options`          | `GET /familiars/:familiar/model/options`        |                                | 200 `ModelOption[]`     |                 |
| `model.set`              | `PUT /familiars/:familiar/model`                | `{ provider, modelId }`        | 204                     | 400 not offered |
| `model.setThinkingLevel` | `PUT /familiars/:familiar/model/thinking-level` | `{ level }`                    | 204                     | 400 unsupported |
| `capabilities.get`       | `GET /familiars/:familiar/capabilities`         |                                | 200 `{ plugins, mcp }`  |                 |
| `capabilities.set`       | `PUT /familiars/:familiar/capabilities`         | `{ plugins?, mcp? }`           | 204                     | 400 unknown     |

`POST /familiars/:familiar/dm` gets or creates the DM between that Familiar and the person `authenticate` returned. A `null` persona or avatar returns a Familiar to its default. An avatar is a short string, at most 64 characters, that your UI interprets, such as an index into its portraits. `DELETE /familiars/:familiar` removes it and stops its work: it leaves its named rooms, its DMs stay readable but refuse new messages, and rooms keep its replies. Capabilities are plugin and MCP connection names; each list given replaces what the Familiar uses of that kind. Familiars opt in: `POST /familiars` takes optional `capabilities`, else the new Familiar uses the workspace's defaults (`GET` and `PUT /defaults/capabilities`, operations `defaults.get` and `defaults.set`), and one added to the workspace later is off for every Familiar until turned on. One MCP connection is one shared session, so Familiars using it share its account and state.

**Rooms**, `rooms.*`, asked with `{ room }` except `list` and `create`

| Operation       | Method and path                   | Body                                      | Success                           | Errors                  |
| --------------- | --------------------------------- | ----------------------------------------- | --------------------------------- | ----------------------- |
| `rooms.list`    | `GET /rooms`                      |                                           | 200 `RoomSummary[]`               |                         |
| `rooms.create`  | `POST /rooms`                     | `{ name, familiars, lead? }`              | 201 `{ id }`                      | 400 refused             |
| `rooms.update`  | `PATCH /rooms/:room`              | `{ name?, familiars?, lead?, archived? }` | 204                               | 400 refused             |
| `rooms.archive` | `DELETE /rooms/:room`             |                                           | 204                               | 400 a DM                |
| `rooms.post`    | `POST /rooms/:room/messages`      | `{ text, requestId, mentions? }`          | 202                               | 400 refused or archived |
| `rooms.note`    | `POST /rooms/:room/notes`         | `{ text, requestId }`                     | 202                               | 400 refused or archived |
| `rooms.read`    | `POST /rooms/:room/read`          | `{ entry }`                               | 204                               | 400 bad `entry`         |
| `rooms.history` | `GET /rooms/:room/history?before` |                                           | 200 `{ entries, more }`, up to 50 | 400 bad `before`        |
| `rooms.retry`   | `POST /rooms/:room/retry`         | `{ reply }`                               | 202                               | 400 not a failed reply  |
| `rooms.stop`    | `POST /rooms/:room/stop`          |                                           | 202                               |                         |

`GET /rooms` lists every named room and the person's own DMs, never anyone else's, each as a `RoomListing`: its setup, `last`, its newest entry worth showing, `unread`, how many entries the person hasn't read, and `turns`, its turns in progress as `{ familiar, status }` (see [the client's rooms list](/familiar/reference/client/#rooms-list)). Archiving hides a named room and closes it to new messages, keeping its history; `PATCH` with `archived: false`, the only value it takes, unarchives it. `POST /rooms/:room/read` marks the room read by the person asking up to `entry`, the newest they've seen, and never moves their marker back; their own messages move it too.

The author of `POST /rooms/:room/messages` comes from `authenticate`, never the body. It answers 400 when the message is refused: see `MESSAGE_LIMITS` in [Core API](/familiar/reference/core/#types). A `requestId` is scoped to the authenticated author, so a retry from the same author is posted once and another author's same ID is a separate message. Each mention is `{ kind: 'familiar' | 'person', id, start, end }`, the span of an `@Name` in the text, and a Familiar it names must be in the room. In a DM its Familiar answers; in a named room each Familiar mentioned answers, or the room's `lead` when none is. A room with no `lead`, or one updated with `lead: null`, is open: each of its Familiars takes a turn in order. `POST /rooms/:room/notes` is for the host's own code or tools, not for people, so it has its own operation to `allow`: a note is context such as "Sam joined" that each Familiar in the room is shown on its next turn, and no one replies to it. It has no author, and takes the same bounds as a message. `POST /rooms/:room/retry` tries a failed reply's turn again: `reply` is the failed reply's entry ID, its Familiar answers the same entry anew, and the new reply follows the failed one, which stays. Asking again while that turn is under way, or once it has replied, starts nothing. `POST /rooms/:room/stop` stops that room's turns, and nothing in other rooms.

**Memory and schedules**, `memory.*` and `schedules.*`, asked with `{ familiar }`

| Operation          | Method and path                                  | Body         | Success | Errors                   |
| ------------------ | ------------------------------------------------ | ------------ | ------- | ------------------------ |
| `memory.revise`    | `PUT /familiars/:familiar/memory/:id`            | `{ text }`   | 204     | 400, 404 missing or past |
| `memory.retire`    | `POST /familiars/:familiar/memory/:id/retire`    |              | 204     | 404                      |
| `memory.setPinned` | `PUT /familiars/:familiar/memory/:id/pin`        | `{ pinned }` | 204     | 400, 404                 |
| `schedules.cancel` | `DELETE /familiars/:familiar/schedules/:id`      |              | 204     | 404                      |
| `schedules.pause`  | `POST /familiars/:familiar/schedules/:id/pause`  |              | 204     | 404                      |
| `schedules.resume` | `POST /familiars/:familiar/schedules/:id/resume` |              | 204     | 404                      |

A paused schedule doesn't run until resumed, and keeps showing its `next` time: a repeat skips the times that fall due meanwhile, and a one-off whose time passes runs, late, once resumed.

**The person asking**, `me.*`

| Operation   | Method and path | Body       | Success            | Errors    |
| ----------- | --------------- | ---------- | ------------------ | --------- |
| `me.get`    | `GET /me`       |            | 200 `{ id, name }` |           |
| `me.update` | `PATCH /me`     | `{ name }` | 204                | 400 blank |

`GET /me` is the person `authenticate` returned as Familiars know them: their author ID, and the name they chose with `PATCH /me`, else the one `authenticate` gives. Their messages carry that name from then on, in the room log and in what Familiars are shown.

**Account**, `account.*`. Every route answers 404 when the host passed no `account`.

| Operation      | Method and path                | Body       | Success            |
| -------------- | ------------------------------ | ---------- | ------------------ |
| `state`        | `GET /account`                 |            | 200 `AccountState` |
| `signIn`       | `POST /account/sign-in`        |            | 202                |
| `answerSignIn` | `POST /account/sign-in/answer` | `{ text }` | 202                |
| `cancelSignIn` | `DELETE /account/sign-in`      |            | 204                |
| `signOut`      | `POST /account/sign-out`       |            | 204                |

**Push**, `push.*`. Every route answers 404 when the host passes no `push`. Familiar validates the subscription, then calls the `PushHost`'s `subscribe(subscription, subscriber)` or `unsubscribe(subscription, subscriber)` with the `Author` that `authenticate` returned. The body can't name a subscriber, and only `endpoint`, `expirationTime` and `keys` reach the host.

| Operation     | Method and path              | Body                        | Success       |
| ------------- | ---------------------------- | --------------------------- | ------------- |
| `key`         | `GET /push/key`              |                             | 200 `{ key }` |
| `subscribe`   | `POST /push/subscriptions`   | `PushSubscription.toJSON()` | 204           |
| `unsubscribe` | `DELETE /push/subscriptions` | `PushSubscription.toJSON()` | 204           |

**Connections and MCP**, `connections.*` and `mcp.*`

| Operation                  | Method and path                                   | Body        | Success                | Errors                      |
| -------------------------- | ------------------------------------------------- | ----------- | ---------------------- | --------------------------- |
| `connections.list`         | `GET /connections`                                |             | 200 `ConnectionInfo[]` |                             |
| `connections.setSecret`    | `PUT /connections/:kind/:name/secrets/:secret`    | `{ value }` | 204                    | 400, 404                    |
| `connections.deleteSecret` | `DELETE /connections/:kind/:name/secrets/:secret` |             | 204                    | 404                         |
| `mcp.add`                  | `POST /mcp`                                       | `McpServer` | 201                    | 400 invalid, 404 name taken |
| `mcp.remove`               | `DELETE /mcp/:name`                               |             | 204                    | 404                         |
| `mcp.reconnect`            | `POST /mcp/:name/reconnect`                       |             | 202                    | 404                         |

`:kind` is `plugin` or `mcp`. Secret values must be visible ASCII. No route returns a secret's value. Each connection lists its `tools` with the `description` the model is given; an MCP server's tool has one only if the server gives it.

`POST /mcp` answers 400, saving nothing, for a server of the wrong shape. Any other server is saved and tried through the host's transport; one that can't connect shows as `failed` in `GET /connections`.

An `McpServer` is:

```ts
type McpServer = {
  name: string // lowercase letters, digits and hyphens, up to 32
  transport:
    | { type: 'http'; url: string; auth: { type: 'none' | 'bearer' } }
    | { type: 'stdio'; command: string; args?: string[] }
}
```

## Events

Three server-sent event streams: the workspace's `GET /events`, a Familiar's `GET /familiars/:familiar/events` and a room's `GET /rooms/:room/events`. Each event's `data` is JSON.

| Event          | Data                     | When                                          |
| -------------- | ------------------------ | --------------------------------------------- |
| `protocol`     | `{ version: 4 }`         | First, on every connection                    |
| `view`         | Pi's `ConversationView`  | The room log's whole view                     |
| `ops`          | Chord ops                | Each commit's changes to the view             |
| `document`     | `{ name, value }`        | A whole document                              |
| `document.ops` | `{ name, ops }`          | Each commit's changes to that document        |
| `account`      | `AccountState` or `null` | The whole sign-in state, each time it changes |

Apply ops in order to the last whole value. After a reconnect, everything arrives whole again. The server sends a comment every 15 seconds to keep the connection open.

`protocol` always comes first. The rest come only from the sources `allow` agrees to for that request when it connects, each asked once:

- The workspace's: `events.familiars` sends the `familiars` document, who each Familiar is; `events.rooms` the `rooms` document, the rooms the person sees, each as `GET /rooms` lists it, with its newest entry, what they haven't read and whose turns are in progress, so a list needs no stream per room; `events.me` the `me` document, the person as `GET /me` says; and `events.account` sends `account`, or `null` once when the host manages credentials itself.
- A Familiar's, asked with `{ familiar }`: `events.model` sends the `model` document, its model and reasoning level, and `events.memory`, `events.episodes` and `events.schedules` their documents.
- A room's, asked with `{ room }`: `events.room` sends the log's `view` and `ops`, then the `turns` document, its turns in progress by task ID. Each turn is `queued` behind work in this room or not yet delivered, `elsewhere` while its Familiar works in another room, or `running`, with the reply so far (`generation`) and the current round's tool calls (`tools`). Nothing from a Familiar's other rooms is sent, and a reply's earlier rounds show once the turn ends and its reply is copied into the log.
