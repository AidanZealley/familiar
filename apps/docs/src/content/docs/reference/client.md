---
title: Client and React API
description: The workspace, Familiar and room stores, their state and commands, the room transcript and the React bindings.
---

Declarations live in [`packages/client/src`](https://github.com/AidanZealley/familiar/tree/main/packages/client/src). The [Connect a frontend](/familiar/build/connect-a-frontend/) guide explains how the pieces fit.

## Stores

Each store mirrors one of the API's [event streams](/familiar/reference/http/#events) and opens it when created. `url` is the API's base URL. `options.fetch` makes every request; it defaults to the platform `fetch`.

| Function                                 | Mirrors                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `createWorkspaceStore(url, options?)`    | Who the Familiars are, the rooms this person sees, and the login |
| `createFamiliarStore(url, id, options?)` | One Familiar's model, memory and schedules                       |
| `createRoomStore(url, id, options?)`     | One room's log, its turns in progress and their transcript       |

Each reads like a Zustand store, with `getState()`, `getInitialState()` and `subscribe(listener)`, but has no `setState`. Its state is plain data from the stream. Commands, and `disconnect()`, are on the store itself and never change identity. `disconnect()` stops the stream and retries, and keeps the last state.

```ts
const workspace = createWorkspaceStore('/api')
const [familiar] = await workspace.familiars.list()
const room = createRoomStore('/api', await workspace.familiars.dm(familiar.id))
await room.send('Hello')
```

## State

Every store has `connection`: `'connecting' | 'open' | 'reconnecting' | 'unauthorized' | 'failed' | 'outdated'`. It goes `open` when the server's handshake matches, before the first values arrive.

| Store     | Field        | Type                                  | Notes                                       |
| --------- | ------------ | ------------------------------------- | ------------------------------------------- |
| Workspace | `familiars`  | `FamiliarsState \| null \| undefined` | `{ familiars }`, who each one is, by ID     |
| Workspace | `rooms`      | `RoomsState \| null \| undefined`     | `{ rooms }`, by ID: named rooms and own DMs |
| Workspace | `account`    | `AccountState \| null \| undefined`   | `null` when the host manages credentials    |
| Familiar  | `model`      | `AgentState \| null \| undefined`     | Its model and reasoning level               |
| Familiar  | `memory`     | `FactsState \| null \| undefined`     |                                             |
| Familiar  | `episodes`   | `EpisodesState \| null \| undefined`  |                                             |
| Familiar  | `schedules`  | `SchedulesState \| null \| undefined` |                                             |
| Room      | `transcript` | `Transcript \| undefined`             | `{ items, busy }`                           |
| Room      | `view`       | `ConversationView \| undefined`       | The room log's view, as streamed            |
| Room      | `history`    | `{ entries, status }`                 | Older entries, oldest first                 |
| Room      | `turns`      | `RoomActivity \| null \| undefined`   | Turns in progress, as streamed              |

Each document is `undefined` until it arrives and `null` when the stream sends none.

## Commands

Commands return promises that reject with the server's error. They aren't retried. Each one calls the [route operation](/familiar/reference/http/) of the same name, except `loadOlder()`, which calls `rooms.history` and never rejects: `history.status` shows its progress and any failure.

| Store     | Group         | Commands                                                                                                |
| --------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| Workspace | `familiars`   | `list()`, `create(identity)`, `update(id, change)`, `dm(id)` (the room ID)                              |
| Workspace | `rooms`       | `list()`, `create(setup)`, `update(id, change)`, `archive(id)`                                          |
| Workspace | `account`     | `signIn()`, `answerSignIn(text)`, `cancelSignIn()`, `signOut()`                                         |
| Workspace | `push`        | `key()` (`undefined` when the host has no push), `subscribe(subscription)`, `unsubscribe(subscription)` |
| Workspace | `connections` | `list()`, `setSecret(connection, secret, value)`, `deleteSecret(connection, secret)`                    |
| Workspace | `mcp`         | `add(server)`, `remove(name)`, `reconnect(name)`                                                        |
| Familiar  | `model`       | `options()`, `set(ref)`, `setThinkingLevel(level)`                                                      |
| Familiar  | `memory`      | `revise(id, text)`, `retire(id)`, `setPinned(id, pinned)`                                               |
| Familiar  | `schedules`   | `cancel(id)`                                                                                            |
| Room      |               | `send(text, mentions?)`, `stop()`, `loadOlder()`                                                        |

`send` generates the `requestId`. `loadOlder()` does nothing while a page is loading or once `history.status` is `start`.

## Transcript

```ts
type TranscriptItem =
  | {
      type: 'message'
      id: string
      author: Author
      text: string
      at: number
      mentions?: Mention[]
    }
  | {
      type: 'reply'
      id: string
      familiar: number
      name?: string // its name when it replied; absent while replying
      text: string
      thinking: string
      toolCalls: ToolCall[]
      at?: number
      streaming: boolean
      stopped: boolean
      error?: string
    }
  | {
      type: 'scheduled'
      id: string
      familiar: number
      prompt: string
      creator?: Author
      due: number
    }
  | {
      type: 'waiting'
      id: string
      familiar: number
      status: 'queued' | 'elsewhere' | 'running'
    }

type ToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  output: string
  details?: unknown
}
```

Times are milliseconds since the epoch. Each turn in progress comes last, as its streaming reply or as `waiting`: `queued` behind work in this room, `elsewhere` while its Familiar works in another room, or `running` before anything shows. While a reply streams, only its current round shows; the whole reply, with every tool call, replaces it when the turn ends.

## Helpers

- `toRoomTranscript(view, history?, turns?)` derives a room's transcript. The room store already does this; use it for other clients.
- `composeMessage(parts)` turns a composer's text and picked names, `{ kind, id, name }`, into `{ text, mentions }`: each pick becomes `@Name` in the text with a mention spanning it. Pass both to `send`.
- `CORE_BUDGET` is core memory's limit in characters, measured as the model sees the facts: `id: text`, one per line.

## React

Import from `@familiar-ai/client/react`. Requires React 18 or 19. The bindings are for a room; use Zustand's `useStore` with the other stores.

| Binding             | Meaning                                                |
| ------------------- | ------------------------------------------------------ |
| `RoomProvider`      | `{ store, children }`. Doesn't open or close the store |
| `useRoom(selector)` | Select from state. Compares with `Object.is`           |
| `useRoomStore()`    | The nearest provider's store, for its commands         |
