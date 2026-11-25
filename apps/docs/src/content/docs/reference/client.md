---
title: Client and React API
description: The workspace, Familiar and room stores, their state and commands, the room transcript and the React bindings.
---

Declarations live in [`packages/client/src`](https://github.com/AidanZealley/familiar/tree/main/packages/client/src). [Connect a frontend](/familiar/build/connect-a-frontend/) shows how the pieces fit.

## Stores

Each store mirrors one of the API's [event streams](/familiar/reference/http/#events) and opens it when created. `url` is the API's base URL. `options.fetch` makes every request, including stream reconnects; it defaults to the platform `fetch`.

| Function                                 | Mirrors                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| `createWorkspaceStore(url, options?)`    | The Familiars, the rooms this person sees, them, the login |
| `createFamiliarStore(url, id, options?)` | One Familiar's model, memory and schedules                 |
| `createRoomStore(url, id, options?)`     | One room's log, its turns in progress and its transcript   |

Each reads like a Zustand store, with `getState()`, `getInitialState()` and `subscribe(listener)`, but has no `setState`. Commands and `disconnect()` are on the store itself and never change identity. `disconnect()` stops the stream and keeps the last state.

```ts
const workspace = createWorkspaceStore('/api')
const [familiar] = await workspace.familiars.list()
const room = createRoomStore('/api', await workspace.familiars.dm(familiar.id))
await room.send('Hello')
```

## State

Every store has `connection`: `'connecting' | 'open' | 'reconnecting' | 'unauthorized' | 'failed' | 'outdated'`.

| Store     | Field        | Type                                  |
| --------- | ------------ | ------------------------------------- |
| Workspace | `familiars`  | `FamiliarsState \| null \| undefined` |
| Workspace | `rooms`      | `RoomsState \| null \| undefined`     |
| Workspace | `me`         | `Author \| null \| undefined`         |
| Workspace | `account`    | `AccountState \| null \| undefined`   |
| Familiar  | `model`      | `AgentState \| null \| undefined`     |
| Familiar  | `memory`     | `MemoryState \| null \| undefined`    |
| Familiar  | `schedules`  | `SchedulesState \| null \| undefined` |
| Room      | `transcript` | `Transcript \| undefined`             |
| Room      | `view`       | `ConversationView \| undefined`       |
| Room      | `turns`      | `RoomActivity \| null \| undefined`   |

Each is `undefined` until it arrives and `null` when the stream sends none, such as `account` when the host manages credentials.

### Rooms list

`rooms.rooms` holds every named room and this person's DMs, by ID, each a `RoomListing` with what a sidebar needs. A list never opens a stream per room.

```ts
type RoomListing = Room & {
  last?: RoomPreview // the newest entry worth showing
  unread?: number // entries since this person's read marker
  turns: { familiar: number; status: 'queued' | 'elsewhere' | 'running' }[]
}

type RoomPreview = {
  entry: number // pass to `read`
  at: number // sort by it for most recent first
  text: string // the start of what it says, on one line
} & (
  | { kind: 'message'; author: Author; images?: number }
  | {
      kind: 'reply'
      familiar: number
      name: string
      outcome: 'answered' | 'failed' | 'stopped'
    }
  | { kind: 'handoff' | 'reminder'; familiar: number; name: string }
  | { kind: 'note' }
)
```

## Commands

Commands return promises that reject with the server's error. They aren't retried. Each calls the [route](/familiar/reference/http/) of the same name.

**Workspace store**

| Group         | Commands                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `familiars`   | `list()`, `create(identity)` (its ID), `update(id, change)`, `remove(id)`, `dm(id)` (the room ID)                                    |
| `rooms`       | `list()`, `create(setup)`, `update(id, change)`, `archive(id)`, `unarchive(id)`                                                      |
| `defaults`    | `models()`, `setModels({ chat?, memory? })`, `capabilities()`, `setCapabilities(change)`                                             |
| `me`          | `rename(name)`                                                                                                                       |
| `account`     | `signIn()`, `answerSignIn(text)`, `cancelSignIn()`, `signOut()`                                                                      |
| `push`        | `key()` (`undefined` without push), `subscribe(subscription)`, `unsubscribe(subscription)`                                           |
| `connections` | `list()`, `setSecret(connection, secret, value)`, `deleteSecret(connection, secret)`, `updateToolSettings(connection, tool, change)` |
| `mcp`         | `add(server)`, `remove(name)`, `reconnect(name)`                                                                                     |

**Familiar store**

| Group          | Commands                                                       |
| -------------- | -------------------------------------------------------------- |
| `model`        | `options()`, `set(ref)`, `setThinkingLevel(level)`             |
| `capabilities` | `get()`, `set(change)`                                         |
| `memory`       | `section()`, `page(subject)`, `journal(month)`, `forget(note)` |
| `schedules`    | `cancel(id)`, `pause(id)`, `resume(id)`                        |

**Room store**

| Command                                          | Meaning                                                |
| ------------------------------------------------ | ------------------------------------------------------ |
| `send(text, { mentions?, images?, requestId? })` | Post a message. Resolves to `{ entry }`                |
| `note(text, { requestId? })`                     | Post a note the Familiars see, which no one replies to |
| `uploadImage(blob, { onProgress?, signal? })`    | Upload an image. Resolves to its `ImageRef`            |
| `imageUrl(id)`                                   | Where a stored image loads from                        |
| `answer(question, answer)`                       | Answer a question a reply is waiting on                |
| `retry(reply)`                                   | Try a failed reply's turn again                        |
| `stop()`                                         | Stop the room's turns                                  |
| `read(entry)`                                    | Mark the room read up to `entry`. Never moves back     |
| `loadOlder()`                                    | Load the page before the transcript's start            |
| `loadGap(gap)`                                   | Load entries missing at a `gap` item                   |

- **Request IDs.** `send` and `note` make a fresh `requestId` unless given one. For a retry, make it once with `createRequestId()` and pass it to every attempt, so the message posts once. The room's view entries carry it in their data, so you can match a pending message to its entry.
- **Image uploads** reject with an `ImageUploadError`. Its `code` is the server's reason; no `code` means it never reached the server and may work if tried again. Progress uses `XMLHttpRequest` unless the store was given its own `fetch`.
- **Retry.** The transcript sets `retry` on a failed reply's last item while it can be retried.
- **Loading.** `loadOlder()` works while `transcript.earlier` is true. Both loads reject on failure, so show it where you call them.
- **Models.** `familiars.update` takes `{ name?, persona?, avatar?, chatModel?, memoryModel? }`; `null` returns one to the default.

## Transcript

`transcript` is `{ items, replying, busy, earlier }`. Times are milliseconds since the epoch, and item IDs are stable keys.

```ts
type TranscriptItem =
  | { type: 'gap'; id: string; gap: TranscriptGap }
  | {
      type: 'message'
      id: string
      author: Author
      text: string // empty for images alone
      images?: (ImageRef | { unavailable: true })[]
      at: number
      mentions?: Mention[]
    }
  | {
      type: 'reply'
      id: string
      familiar: number
      name?: string // its name when it replied
      text: string
      mentions?: Mention[]
      thinking: string
      toolCalls: ToolCall[]
      at?: number
      stopped: boolean
      quiet?: true // it chose to say nothing
      error?: string
      retry?: number // pass to `retry`
    }
  | {
      type: 'handoff'
      id: string
      from: number
      to: number
      note: string
      at: number
    }
  | { type: 'note'; id: string; text: string; at: number }
  | {
      type: 'scheduled'
      id: string
      familiar: number
      prompt: string
      creator?: Author
      due: number
    }

type ReplyingFamiliar = {
  familiar: number
  questions?: Question[] // tool approvals and server questions waiting
  retrying?: { at: number; error: string } // a failed model request, tried again `at`
  tools?: ToolCall[] // this round's live calls
}

type ToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  output: string
  details?: unknown // narrow before rendering
}
```

- `items` is the loaded history. A reply appears, with all its tool calls, when its turn ends.
- `replying` lists the Familiars running a turn here, with their live state.
- `busy` is true while any Familiar has a turn here, queued or running.
- A `gap` marks entries still missing, such as after a long disconnect.

## Helpers

- `composeMessage(parts)` turns a composer's text and picks, `{ kind, id, name }`, into `{ text, mentions }` for `send`.
- `shapeOf(question)` says how to show a question: `approval`, `form` or `unsupported`. `answerFor(question, content?)` builds the accepting `Answer`.
- `createRequestId()` makes a request ID.
- `toRoomTranscript(view, turns?)` turns a Pi `TranscriptView` into a transcript, for clients that assemble their own history with `ConversationTranscript`.

## React

Import from `@familiar-ai/client/react`, with React 18 or 19. The bindings are for a room; use Zustand's `useStore` with the other stores.

| Binding             | Meaning                                                |
| ------------------- | ------------------------------------------------------ |
| `RoomProvider`      | `{ store, children }`. Doesn't open or close the store |
| `useRoom(selector)` | Select from state. Compares with `Object.is`           |
| `useRoomStore()`    | The nearest provider's store, for its commands         |
