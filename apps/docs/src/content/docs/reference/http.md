---
title: HTTP API and events
description: Every route createHttpApi can serve, and the server-sent events at /events.
---

`createHttpApi` serves the routes below that its `routes` option chooses, each by the operation name in its table, and `routes: true` serves them all. Every other path answers 404. See [Choose routes](/familiar/build/serve-the-api/#choose-routes).

Paths are relative to wherever you mount the API, such as `/api`. Every request passes through `authenticate` first and answers `401 { "error": "unauthorized" }` when it returns `undefined`. A request body over `maxBodySize` (default `DEFAULT_MAX_BODY_SIZE`, 1 MiB) then answers 413 before any route reads it. A route whose check refuses the request answers `403 { "error": "forbidden" }`. Other errors are JSON `{ "error": string }`.

[`packages/core/src/http.ts`](https://github.com/AidanZealley/familiar/blob/main/packages/core/src/http.ts) owns the contract. The client imports its types, so a change on one side is a type error on the other.

## Routes

**Conversation**, in `routes.conversation`

| Operation          | Method and path             | Body                    | Success                           | Errors           |
| ------------------ | --------------------------- | ----------------------- | --------------------------------- | ---------------- |
| `send`             | `POST /messages`            | `{ text, requestId }`   | 202                               | 400 refused      |
| `abort`            | `POST /abort`               |                         | 202                               |                  |
| `history`          | `GET /history?before=<id>`  |                         | 200 `{ entries, more }`, up to 50 | 400 bad `before` |
| `modelOptions`     | `GET /model/options`        |                         | 200 `ModelOption[]`               |                  |
| `setModel`         | `PUT /model`                | `{ provider, modelId }` | 204                               | 400 not offered  |
| `setThinkingLevel` | `PUT /model/thinking-level` | `{ level }`             | 204                               | 400 unsupported  |

The author of `POST /messages` comes from `authenticate`, never the body.

**Memory and schedules**, in `routes.memory` and `routes.schedules`

| Operation          | Method and path           | Body         | Success            | Errors                   |
| ------------------ | ------------------------- | ------------ | ------------------ | ------------------------ |
| `memory.health`    | `GET /memory/health`      |              | 200 `MemoryHealth` |                          |
| `memory.revise`    | `PUT /memory/:id`         | `{ text }`   | 204                | 400, 404 missing or past |
| `memory.retire`    | `POST /memory/:id/retire` |              | 204                | 404                      |
| `memory.setPinned` | `PUT /memory/:id/pin`     | `{ pinned }` | 204                | 400, 404                 |
| `schedules.cancel` | `DELETE /schedules/:id`   |              | 204                | 404                      |

**Account**, in `routes.account`. Every route answers 404 when no account is attached.

| Operation      | Method and path                | Body       | Success            |
| -------------- | ------------------------------ | ---------- | ------------------ |
| `state`        | `GET /account`                 |            | 200 `AccountState` |
| `signIn`       | `POST /account/sign-in`        |            | 202                |
| `answerSignIn` | `POST /account/sign-in/answer` | `{ text }` | 202                |
| `cancelSignIn` | `DELETE /account/sign-in`      |            | 204                |
| `signOut`      | `POST /account/sign-out`       |            | 204                |

**Push**, in `routes.push`. Every route answers 404 when the host passes no `push`.

| Operation     | Method and path              | Body                        | Success       |
| ------------- | ---------------------------- | --------------------------- | ------------- |
| `key`         | `GET /push/key`              |                             | 200 `{ key }` |
| `subscribe`   | `POST /push/subscriptions`   | `PushSubscription.toJSON()` | 204           |
| `unsubscribe` | `DELETE /push/subscriptions` | `PushSubscription.toJSON()` | 204           |

**Connections and MCP**, in `routes.connections` and `routes.mcp`

| Operation                  | Method and path                                   | Body        | Success                | Errors                      |
| -------------------------- | ------------------------------------------------- | ----------- | ---------------------- | --------------------------- |
| `connections.list`         | `GET /connections`                                |             | 200 `ConnectionInfo[]` |                             |
| `connections.setSecret`    | `PUT /connections/:kind/:name/secrets/:secret`    | `{ value }` | 204                    | 400, 404                    |
| `connections.deleteSecret` | `DELETE /connections/:kind/:name/secrets/:secret` |             | 204                    | 404                         |
| `mcp.add`                  | `POST /mcp`                                       | `McpServer` | 201                    | 400 refused, 404 name taken |
| `mcp.remove`               | `DELETE /mcp/:name`                               |             | 204                    | 404                         |
| `mcp.reconnect`            | `POST /mcp/:name/reconnect`                       |             | 202                    | 404                         |

`POST /messages` answers 400 when `send` refuses the message: see `MESSAGE_LIMITS` in [Core API](/familiar/reference/core/#types). A `requestId` is scoped to the authenticated author, so a retry from the same author is admitted once and another author's same ID is a separate message.

`:kind` is `plugin` or `mcp`. Secret values must be visible ASCII. No route returns a secret's value.

`POST /mcp` answers 400, saving nothing, for a server of the wrong shape or one Familiar won't connect to: a transport the host didn't pass (`mcpFetch` or `mcpStdio`), fields over `MCP_LIMITS`, or a bearer token over plain HTTP to anywhere but `localhost`, `127.0.0.0/8` or `[::1]`.

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

`GET /events` is a server-sent event stream. Each event's `data` is JSON.

| Event          | Data                     | When                                                  |
| -------------- | ------------------------ | ----------------------------------------------------- |
| `protocol`     | `{ version: 2 }`         | First, on every connection                            |
| `view`         | Pi's `ConversationView`  | The whole conversation view                           |
| `ops`          | Chord ops                | Each commit's changes to the view                     |
| `document`     | `{ name, value }`        | A whole document: `memory`, `episodes` or `schedules` |
| `document.ops` | `{ name, ops }`          | Each commit's changes to that document                |
| `account`      | `AccountState` or `null` | The whole sign-in state, each time it changes         |

Apply ops in order to the last whole value. After a reconnect, everything arrives whole again. The server sends a comment every 15 seconds to keep the connection open.

`protocol` always comes first. The rest come only from the sources `routes.events` chooses and allows for that request when it connects: `conversation` sends `view` and `ops`, `memory`, `episodes` and `schedules` each send their `document` and `document.ops`, and `account` sends `account`. A stream built with `eventRoutes` sends only the sources it was given. See [Choose event sources](/familiar/build/serve-the-api/#choose-event-sources).
