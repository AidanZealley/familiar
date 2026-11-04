---
title: Client and React API
description: createFamiliarStore, its state and commands, the transcript and the React bindings.
---

Declarations live in [`packages/client/src`](https://github.com/AidanZealley/familiar/tree/main/packages/client/src). The [Connect a frontend](/familiar/build/connect-a-frontend/) guide explains how the pieces fit.

## createFamiliarStore(url, options?)

Returns a read-only Zustand store, `FamiliarStore`, and opens the event stream. `url` is the API's base URL. `options.fetch` makes every request; it defaults to the platform `fetch`.

Every command is present. One the host's `allow` refuses rejects with the server's 403.

The store exposes `getState()`, `getInitialState()` and `subscribe(listener)`. It has no `setState`.

## State

| Field                  | Type                                                                                   | Notes                                              |
| ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `connection`           | `'connecting' \| 'open' \| 'reconnecting' \| 'unauthorized' \| 'failed' \| 'outdated'` |                                                    |
| `transcript`           | `Transcript \| undefined`                                                              | `{ items, busy }`                                  |
| `conversation.view`    | `ConversationView \| undefined`                                                        | Pi's view as streamed                              |
| `conversation.history` | `{ entries, status }`                                                                  | Older entries, oldest first                        |
| `memory.facts`         | `FactsState \| null \| undefined`                                                      |                                                    |
| `memory.episodes`      | `EpisodesState \| null \| undefined`                                                   |                                                    |
| `schedules.items`      | `SchedulesState \| null \| undefined`                                                  |                                                    |
| `account.state`        | `AccountState \| null \| undefined`                                                    | `null` when the host manages credentials           |
| `disconnect()`         |                                                                                        | Stops the stream and retries, keeps the last state |

## Commands

Commands return promises that reject with the server's error. They aren't retried. Each one has the name of the [route operation](/familiar/reference/http/) it calls, except `loadOlder()`, which calls `history`.

| Group          | Commands                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `conversation` | `send(text)`, `abort()`, `loadOlder()`, `modelOptions()`, `setModel(ref)`, `setThinkingLevel(level)`    |
| `memory`       | `revise(id, text)`, `retire(id)`, `setPinned(id, pinned)`, `health()`                                   |
| `schedules`    | `cancel(id)`                                                                                            |
| `account`      | `signIn()`, `answerSignIn(text)`, `cancelSignIn()`, `signOut()`                                         |
| `push`         | `key()` (`undefined` when the host has no push), `subscribe(subscription)`, `unsubscribe(subscription)` |
| `connections`  | `list()`, `setSecret(connection, secret, value)`, `deleteSecret(connection, secret)`                    |
| `mcp`          | `add(server)`, `remove(name)`, `reconnect(name)`                                                        |

`send` generates the `requestId`. `loadOlder()` resolves to whether it loaded anything; concurrent callers share one request.

## Transcript

```ts
type TranscriptItem =
  | {
      type: 'message'
      id: string
      author: Author | string
      text: string
      at?: number
      queued: boolean
    }
  | {
      type: 'reply'
      id: string
      text: string
      thinking: string
      toolCalls: ToolCall[]
      at: number
      streaming: boolean
      stopped: boolean
      error?: string
    }
  | {
      type: 'scheduled'
      id: string
      prompt: string
      creator?: Author
      due: number
      queued: boolean
    }
  | { type: 'waiting'; id: string }
  | { type: 'compaction'; id: string }

type ToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  output: string
  details?: unknown
}
```

Times are milliseconds since the epoch. A message's `author` is a plain name string only for messages stored before authors had IDs.

## Helpers

- `toTranscript(view, history?)` derives a transcript. The store already does this; use it for other clients.
- `agentOf(view)` reads the conversation's current model and reasoning level.
- `startOf(view)` and `carryOver(history, before, after)` are the history bookkeeping the store uses.

## React

Import from `@familiar-ai/client/react`. Requires React 18 or 19.

| Binding                 | Meaning                                                  |
| ----------------------- | -------------------------------------------------------- |
| `FamiliarProvider`      | `{ store, children }`. Doesn't open or close the store   |
| `useFamiliar(selector)` | Select from state. Compares with `Object.is`             |
| `useTranscript()`       | Shorthand for `useFamiliar((state) => state.transcript)` |
