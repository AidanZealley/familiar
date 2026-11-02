---
title: HTTP API and events
description: Every route createHttpApi mounts, and the server-sent events at /events.
---

Paths are relative to wherever you mount the API, such as `/api`. Every route passes through `authenticate` first and answers `401 { "error": "unauthorized" }` when it returns `undefined`. Errors are JSON `{ "error": string }`.

[`packages/core/src/http.ts`](https://github.com/AidanZealley/familiar/blob/main/packages/core/src/http.ts) owns the contract. The client imports its types, so a change on one side is a type error on the other.

## Routes

**Conversation**

| Method and path             | Body                    | Success                           | Errors            |
| --------------------------- | ----------------------- | --------------------------------- | ----------------- |
| `POST /messages`            | `{ text, requestId }`   | 202                               | 400 missing field |
| `POST /abort`               |                         | 202                               |                   |
| `GET /history?before=<id>`  |                         | 200 `{ entries, more }`, up to 50 | 400 bad `before`  |
| `GET /model/options`        |                         | 200 `ModelOption[]`               |                   |
| `PUT /model`                | `{ provider, modelId }` | 204                               | 400 not offered   |
| `PUT /model/thinking-level` | `{ level }`             | 204                               | 400 unsupported   |

The author of `POST /messages` comes from `authenticate`, never the body.

**Memory and schedules**

| Method and path           | Body         | Success            | Errors                   |
| ------------------------- | ------------ | ------------------ | ------------------------ |
| `GET /memory/health`      |              | 200 `MemoryHealth` |                          |
| `PUT /memory/:id`         | `{ text }`   | 204                | 400, 404 missing or past |
| `POST /memory/:id/retire` |              | 204                | 404                      |
| `PUT /memory/:id/pin`     | `{ pinned }` | 204                | 400, 404                 |
| `DELETE /schedules/:id`   |              | 204                | 404                      |

**Account**. Every route answers 404 when no account is attached.

| Method and path                | Body       | Success            |
| ------------------------------ | ---------- | ------------------ |
| `GET /account`                 |            | 200 `AccountState` |
| `POST /account/sign-in`        |            | 202                |
| `POST /account/sign-in/answer` | `{ text }` | 202                |
| `DELETE /account/sign-in`      |            | 204                |
| `POST /account/sign-out`       |            | 204                |

**Push**. Every route answers 404 when the host passes no `push`.

| Method and path              | Body                        | Success       |
| ---------------------------- | --------------------------- | ------------- |
| `GET /push/key`              |                             | 200 `{ key }` |
| `POST /push/subscriptions`   | `PushSubscription.toJSON()` | 204           |
| `DELETE /push/subscriptions` | `PushSubscription.toJSON()` | 204           |

**Connections and MCP**

| Method and path                                   | Body        | Success                | Errors                      |
| ------------------------------------------------- | ----------- | ---------------------- | --------------------------- |
| `GET /connections`                                |             | 200 `ConnectionInfo[]` |                             |
| `PUT /connections/:kind/:name/secrets/:secret`    | `{ value }` | 204                    | 400, 404                    |
| `DELETE /connections/:kind/:name/secrets/:secret` |             | 204                    | 404                         |
| `POST /mcp`                                       | `McpServer` | 201                    | 400 invalid, 404 name taken |
| `DELETE /mcp/:name`                               |             | 204                    | 404                         |
| `POST /mcp/:name/reconnect`                       |             | 202                    | 404                         |

`:kind` is `plugin` or `mcp`. Secret values must be visible ASCII. No route returns a secret's value.

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

The full API sends every source. A stream built with `eventRoutes` sends only the sources it was given. See [Choose event sources](/familiar/build/serve-the-api/#choose-event-sources).
