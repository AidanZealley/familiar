---
title: Client and React API
description: createFamiliarStore, its state and commands, the transcript and the React bindings.
---

Declarations live in [`packages/client/src`](https://github.com/AidanZealley/familiar/tree/main/packages/client/src). The [Connect a frontend](/familiar/build/connect-a-frontend/) guide explains how the pieces fit.

## createFamiliarStore(url, options?)

Returns a `FamiliarStore` and opens the event stream. `url` is the API's base URL. `options.fetch` makes every request; it defaults to the platform `fetch`.

The store reads like a Zustand store, with `getState()`, `getInitialState()` and `subscribe(listener)`, but has no `setState`. Its state is plain data from the stream. Commands, and `disconnect()`, are on the store itself and never change identity. `disconnect()` stops the stream and retries, and keeps the last state.

```ts
const store = createFamiliarStore('/api')
await store.conversation.send('Hello')
store.getState().memory?.facts
```

## State

| Field        | Type                                                                                   | Notes                                    |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| `connection` | `'connecting' \| 'open' \| 'reconnecting' \| 'unauthorized' \| 'failed' \| 'outdated'` |                                          |
| `transcript` | `Transcript \| undefined`                                                              | `{ items, busy }`                        |
| `view`       | `ConversationView \| undefined`                                                        | Pi's view as streamed                    |
| `history`    | `{ entries, status }`                                                                  | Older entries, oldest first              |
| `account`    | `AccountState \| null \| undefined`                                                    | `null` when the host manages credentials |
| `memory`     | `FactsState \| null \| undefined`                                                      |                                          |
| `episodes`   | `EpisodesState \| null \| undefined`                                                   |                                          |
| `schedules`  | `SchedulesState \| null \| undefined`                                                  |                                          |

Each document is `undefined` until it arrives and `null` when the stream sends none.

## Commands

Commands return promises that reject with the server's error. They aren't retried. Each one has the name of the [route operation](/familiar/reference/http/) it calls, except `loadOlder()`, which calls `history` and never rejects: `history.status` shows its progress and any failure.

| Group          | Commands                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `conversation` | `send(text)`, `abort()`, `loadOlder()`, `modelOptions()`, `setModel(ref)`, `setThinkingLevel(level)`    |
| `memory`       | `revise(id, text)`, `retire(id)`, `setPinned(id, pinned)`                                               |
| `schedules`    | `cancel(id)`                                                                                            |
| `account`      | `signIn()`, `answerSignIn(text)`, `cancelSignIn()`, `signOut()`                                         |
| `push`         | `key()` (`undefined` when the host has no push), `subscribe(subscription)`, `unsubscribe(subscription)` |
| `connections`  | `list()`, `setSecret(connection, secret, value)`, `deleteSecret(connection, secret)`                    |
| `mcp`          | `add(server)`, `remove(name)`, `reconnect(name)`                                                        |

`send` generates the `requestId`. `loadOlder()` does nothing while a page is loading or once `history.status` is `start`.

## Transcript

```ts
type TranscriptItem =
  | {
      type: 'message'
      id: string
      author: Author
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

Times are milliseconds since the epoch.

## Helpers

- `toTranscript(view, history?)` derives a transcript. The store already does this; use it for other clients.
- `agentOf(view)` reads the conversation's current model and reasoning level.
- `CORE_BUDGET` is core memory's limit in characters, measured as the model sees the facts: `id: text`, one per line.

## React

Import from `@familiar-ai/client/react`. Requires React 18 or 19.

| Binding                 | Meaning                                                |
| ----------------------- | ------------------------------------------------------ |
| `FamiliarProvider`      | `{ store, children }`. Doesn't open or close the store |
| `useFamiliar(selector)` | Select from state. Compares with `Object.is`           |
| `useFamiliarStore()`    | The nearest provider's store, for its commands         |
