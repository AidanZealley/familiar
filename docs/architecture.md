# How Familiar fits together

A guide for reading the code end to end. The README's Layout and Rules say what each part is for; this says how they connect and in what order to read them.

## Four Pi ideas first

Familiar is a thin layer over [Pi Durable](../packages/core/node_modules/@earendil-works/pi-durable/README.md). Most of the code is Familiar using these four things, so read their sections of Pi's README before Familiar's code:

- **The Harness** owns one storage and runs everything durably: a restart picks up where the last process stopped.
- **Conversations and entries.** Familiar has one conversation. Each message, reply, tool result and compaction summary is an entry in it.
- **Documents** (`defineDoc`) are typed JSON state stored beside the transcript and changed inside transactions (`tx.doc(...)`), so a fact and the reply that saved it commit together. Familiar's are `Facts`, `MemoryUsage`, `Episodes` and `Upkeep`.
- **Extensions** add to what the model sees and can do: **sections** (parts of the system prompt), **tools**, **hooks** (code that runs around a request, such as adding recalled facts), and **tasks** (durable background work, such as the nightly pass).

## The map

```
packages/core/src
  familiar.ts        summonFamiliar(): installs every capability, opens the Harness,
                     returns the Familiar API. The one place to see the whole.
  http.ts            The HTTP + SSE API and every wire type clients use.
  diagnostics.ts     For tools around Familiar (the demo, the eval), not hosts.
  persona/           Who Familiar is: the prompt's preamble.
  time/              current_time, and how dates are written (local days).
  context/           How much conversation fits in a request; compaction; timeouts;
                     which extensions a conversation gets by default.
  conversation/      The message format (message.ts) and sending, watching and
                     paging the conversation (api.ts).
  memory/
    facts.ts         The fact shape, the Facts and MemoryUsage documents and
                     every rule for changing facts. Pure: no model, no Pi
                     beyond the documents.
    exchanges.ts     The in-memory search index over exchanges (a message and
                     its replies). It catches up with the transcript at the
                     start of each search and is rebuilt after a restart.
    tools.ts         recall and read_memory, the tools that read memory. The
                     conversation and upkeep both have them.
    recall.ts        Search and ranking: automatic recall over facts and
                     episodes, and the recall tool's groups, exchanges too.
    read.ts          What read_memory shows behind an ID.
    episodes.ts      The episode shape, the Episodes document, dates in messages,
                     and when weeks and months are due to roll up.
    extension.ts     What memory adds to a request: core facts in the prompt, and
                     the recall note added before each request.
    upkeep/          The nightly pass, the only writer of facts: schedule.ts
                     (when), transcript.ts (what's new), prompts.ts (what it's
                     told), tools.ts (remember, revise_memory, retire: each
                     calls a rule in facts.ts), index.ts (the task).
    api.ts, http.ts  The owner's corrections, and their routes.
    index.ts         createMemory(): wires the above together.
packages/client/src
  store.ts           A live mirror of the conversation and every streamed document.
  transcript.ts      Turns entries into chat items: messages, replies, tool calls.
apps/daemon/src      The Node host: storage, sign-in, serving, the demo, the eval.
apps/web/src         The chat and Memory pages, built on @familiar/client.
```

## Reading order

1. `core/familiar.ts`, about 100 lines. Everything else hangs off it.
2. `persona`, `time` and `context`: small, and they show the extension pattern plainly.
3. `conversation/message.ts`, then `conversation/api.ts`.
4. Memory, from the rules out (for how it works and why, read [memory.md](memory.md)): `facts.ts`, `tools.ts`, `recall.ts`, `episodes.ts`, `extension.ts`, `upkeep/`, then `api.ts`, `http.ts` and `index.ts`.
5. `http.ts`, then `packages/client/src/store.ts` and `transcript.ts`, then `apps/web`.
6. `apps/daemon`: `main.ts`, `serve.ts`, `config.ts`, `credentials.ts`. The demo and the eval last.

Read each test file beside its source. They run the real Harness with a scripted model and, for upkeep, a fake clock, so they show what each part is meant to do: `memory.test.ts`, `upkeep/upkeep.test.ts` and `recall.test.ts` especially.

## One message, end to end

1. The composer calls `store.send()`, which posts to `/api/messages`.
2. `http.ts` asks the host who sent it, then calls `familiar.send()` (`conversation/api.ts`), which submits it to the conversation.
3. Pi runs a generation task. The request it builds has the system prompt from every extension's sections (the preamble, core facts) and as much recent conversation as the context budget allows; older conversation has been compacted into a summary.
4. Memory's `beforeRequest` hook (`extension.ts`) searches facts and episodes for the latest message and adds a recall note at the end of this request only.
5. The model may call a tool, say `recall`, which searches facts and episodes. It can't change memory: nothing said is filed until upkeep runs that night.
6. Each commit reaches `/api/events` as operations: the conversation's, and those of any document that changed. The client applies them, `toTranscript()` turns entries into chat items, and React renders them.
7. At 04:00, upkeep (`upkeep/index.ts`) files unreviewed message text oldest first with the writing tools only its conversation is given (`upkeep/tools.ts`), citing each person's message by its exchange ID. Batches stop at each 04:00 day boundary or the transcript budget, whichever comes first. Each completed batch saves an episode and its review position, so a failed later batch can resume without repeating earlier ones. Once the backlog is clear, upkeep rolls up finished weeks and months. A single message larger than the budget is truncated and reported to the host; ordinary batch overflow is left for the next batch.

## Where new things go

- **A tool**: a capability folder (new, or the one it belongs to) exports an extension with it, and `familiar.ts` installs it. If people act on it directly, the folder also exports an owner API and routes, mounted in `http.ts` as memory's are.
- **State clients should see**: a document, added to the `Documents` table and the `documents` list in `http.ts`. The client mirrors it by name.
- **Anything that varies per request**: a tool or a hook, never a prompt section. A section that changes resends the prompt and loses the provider's prompt cache.
- **Node-only code**: `apps/daemon`. Packages stay portable.
