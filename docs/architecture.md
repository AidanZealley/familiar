# How Familiar fits together

A guide for reading the code end to end. The README's Layout and Rules say what each part is for; this says how they connect and in what order to read them.

## Four Pi ideas first

Familiar is a thin layer over [Pi Durable](../packages/core/node_modules/@earendil-works/pi-durable/README.md). Most of the code is Familiar using these four things, so read their sections of Pi's README before Familiar's code:

- **The Harness** owns one storage and runs everything durably: a restart picks up where the last process stopped.
- **Conversations and entries.** Familiar has one conversation. Each message, reply, tool result and compaction summary is an entry in it.
- **Documents** (`defineDoc`) are typed JSON state stored beside the transcript and changed inside transactions (`tx.doc(...)`), so a fact and the tool result that saved it commit together. Familiar's are `Facts`, `MemoryUsage`, `Episodes`, `Upkeep`, `Schedules` and `McpServers`.
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
                     start of each search, notes where the latest compaction
                     starts the model's view, and is rebuilt after a restart.
    tools.ts         recall and read_memory, the tools that read memory. The
                     conversation and upkeep both have them.
    recall.ts        Search and ranking: automatic recall over facts,
                     episodes and unfiled exchanges, and the recall tool's
                     groups, exchanges too.
    read.ts          What read_memory shows behind an ID.
    health.ts        Health numbers from real data, and recent search times.
    episodes.ts      The episode shape, the Episodes document, dates in messages,
                     and when weeks and months are due to roll up.
    extension.ts     What memory adds to a request: core facts in the prompt, and
                     the recall note added before each request.
    upkeep/          The nightly pass, the only writer of facts: schedule.ts
                     (when), transcript.ts (what's new), prompts.ts (what it's
                     told), tools.ts (remember, revise_memory, retire: each
                     calls a rule in facts.ts), index.ts (the task).
    api.ts, http.ts  The owner's corrections and health, and their routes.
    testing.ts       Test helpers: storage seeded as upkeep would leave it.
    index.ts         createMemory(): wires the above together.
  schedules/
    schedules.ts     The Schedules document and its rules: adding, cancelling,
                     what's due and what's next. Pure, like facts.ts.
    repeat.ts        RRULE repeats in local time, through rrule.
    task.ts          One task per schedule: sleeps until due, submits the prompt
                     to the main conversation, notifies the host with the reply.
    tools.ts         schedule, list_schedules and cancel_schedule.
    index.ts         createSchedules(): the extension, its prompt section and
                     the owner's API; http.ts its route.
  plugins/
    types.ts         Plugin context and connection types.
    index.ts         Install Pi extensions with credential access.
    connections.ts   Credential declarations, missing-key errors and the owner API.
    authorized-fetch.ts  Attach a key only to its declared destination and request.
    secrets.ts       Storage contract and the in-memory store for tests and demos.
    http.ts          Write-only Connections routes.
  mcp/
    servers.ts       Saved server declarations in the McpServers document.
    manager.ts       Owner edits and connection lifetimes.
    connection.ts    One server's client, status and installed tools.
    index.ts         SDK discovery and deferred Pi tool definitions.
    http-transport.ts  Endpoint-restricted HTTP transport.
    tool-result.ts   MCP result blocks mapped to Pi output.
    http.ts          Add, remove and reconnect routes.
packages/client/src
  store.ts           A live mirror of the conversation and every streamed document.
  transcript.ts      Turns entries into chat items: messages, replies, tool calls.
apps/daemon/src      The Node host: storage, sign-in, serving and the eval.
  demo/main.ts       In-memory demo startup, separate from the real daemon.
  demo/model.ts      Scripted model routing over an explicit list of scenarios.
  demo/scenarios/    Feature-specific model responses and fake external services.
  demo/seed.ts       Sample memory data and the tools that load it.
apps/web/src         Chat, Memory, Schedules and Connections, on @familiar/client.
```

## Reading order

1. `core/familiar.ts`. Everything else hangs off it.
2. `persona`, `time` and `context`: small, and they show the extension pattern plainly.
3. `conversation/message.ts`, then `conversation/api.ts`.
4. Memory, from the rules out (for how it works and why, read [memory.md](memory.md)): `facts.ts`, `episodes.ts`, `exchanges.ts`, `recall.ts`, `read.ts`, `tools.ts`, `extension.ts`, `upkeep/`, then `health.ts`, `api.ts`, `http.ts` and `index.ts`.
5. Schedules, the same way: `schedules.ts`, `repeat.ts`, `task.ts`, `tools.ts`, then `index.ts`.
6. Plugins: `plugins/types.ts`, `plugins/index.ts`, `plugins/connections.ts`, then `plugins/authorized-fetch.ts`.
7. MCP: `mcp/servers.ts`, `manager.ts`, `connection.ts`, then `index.ts` and `http-transport.ts`.
8. `http.ts`, then `packages/client/src/store.ts` and `transcript.ts`, then `apps/web`.
9. `apps/daemon`: `main.ts`, `serve.ts`, `config.ts`, `credentials.ts`. The demo and the eval last.

Read each test file beside its source. They run the real Harness with a scripted model and, for upkeep and schedules, a fake clock, so they show what each part is meant to do: `memory.test.ts`, `upkeep/upkeep.test.ts`, `schedules.test.ts`, `recall.test.ts` and `read.test.ts` especially. `pnpm eval:recall` measures exchange search against years of extra conversation without a model, and `pnpm eval:unfiled` measures what automatic recall shows of conversation compacted out of view before upkeep files it.

## One message, end to end

1. The composer calls `store.send()`, which posts to `/api/messages`.
2. `http.ts` asks the host who sent it, then calls `familiar.send()` (`conversation/api.ts`), which submits it to the conversation.
3. Pi runs a generation task. The request it builds has the system prompt from every extension's sections (the preamble, core facts) and as much recent conversation as the context budget allows; older conversation has been compacted into a summary.
4. Memory's `beforeRequest` hook (`extension.ts`) searches facts outside core and the episodes no rollup covers yet (or any on dates the message names) and adds at most 8 as a recall note at the end of this request only, memoised so a retried request sees the same note. In the main conversation the note also gets the best two exchanges between the last entry upkeep reviewed and the start of the view, which nothing else would show until upkeep files them. Hooks can't read the transcript, so `createMemory` (`index.ts`) builds the note, in one transaction so upkeep can't file something between reads.
5. The model may call a tool, say `recall`, which catches the exchange index up with the transcript and searches facts, episodes and exchanges in three groups; `read_memory` opens what lies behind an ID, down to the original messages. Neither changes facts: nothing said is filed until upkeep runs that night, though automatic recall finds it in the meantime once it leaves the view.
6. Each commit reaches `/api/events` as operations: the conversation's, and those of any document that changed. The client applies them, `toTranscript()` turns entries into chat items, and React renders them.
7. At 04:00, upkeep (`upkeep/index.ts`) files unreviewed message text oldest first with the writing tools only its conversation is given (`upkeep/tools.ts`), citing each person's message by its exchange ID. Batches stop at each 04:00 day boundary or the transcript budget, whichever comes first. Each completed batch saves an episode and its review position, so a failed later batch can resume without repeating earlier ones. Once the backlog is clear, upkeep rolls up finished weeks and months, then rechecks the 20 current facts that have gone longest without a check against the last 30 days' episodes, stamping them checked in the usage document only if that review succeeds. A single message larger than the budget is truncated and reported to the host; ordinary batch overflow is left for the next batch.

## Memory storage

Facts live in the session document `familiar.facts`, version 1, and recall and review timestamps in `familiar.memory-usage`, version 1. The fact document is streamed to clients as `memory`; usage is not streamed. The earlier `familiar.memory` fact document is not migrated or read by the current implementation. The transcript and episodes remain stored separately.

## Where new things go

- **A tool**: a capability folder (new, or the one it belongs to) exports an extension with it, and `familiar.ts` installs it. If people act on it directly, the folder also exports an owner API and routes, mounted in `http.ts` as memory's are.
- **State clients should see**: a document, added to the `Documents` table and the `documents` list in `http.ts`. The client mirrors it by name.
- **Anything that varies per request**: a tool or a hook, never a prompt section. A section that changes resends the prompt and loses the provider's prompt cache.
- **Node-only code**: `apps/daemon`. Packages stay portable.

## Credential and network boundaries

Plugins are Pi extensions with metadata and a small context. `plugins/index.ts` installs them without wrapping their tools. `connections.ts` owns credential declarations, the store and the Connections API. `authorized-fetch.ts` checks the destination before loading and attaching a key. It never follows authenticated redirects.

Network restrictions belong to the host. The daemon supplies `guardedFetch`, which checks each connection's destination address; other hosts supply their own fetch. Incoming authentication stays with `createHttpApi` and the host's server.

Responses and tool output are not scrubbed. An upstream service that echoes a key can expose it to the plugin and conversation. There are no masking hooks or output scrubbers. The optional prototype is tracked as later work in the [roadmap](roadmap.md).

## MCP connections

`mcp/manager.ts` owns saved declarations and serializes owner edits. Each connection in `connection.ts` owns its SDK client, runtime status and registry extension. Startup connects servers independently, so an unavailable server does not block chat. Removal aborts the connection and uninstalls its tools; late callbacks cannot reinstall them.

`mcp/index.ts` discovers tools and exposes them as deferred Pi tools through `tool_search`. The SDK owns transport sessions and tool-list notifications; Pi owns tool loading and replay policy. MCP tools use `replay: 'unsafe'`. An ordinary tool error leaves connection status alone; HTTP 401 requests credentials and 404 reconnects an expired session for subsequent calls. Failed calls are never automatically repeated.

Declarations live with the conversation in `McpServers`; bearer tokens stay in the host's secret store. Connections combines declarations with runtime status and discovered tools. The owner can add, remove and reconnect servers and change credentials. Names and transports are immutable, so changing an endpoint requires removing and re-adding it. Setup and API details are in the [README](../README.md#mcp-connections).

The host supplies `mcpFetch` separately from plugins' guarded fetch. The daemon permits owner-configured localhost, LAN and tailnet endpoints, while the HTTP adapter restricts requests and credentials to the exact endpoint and refuses redirects. Node-only stdio transport construction lives in `apps/daemon/src/mcp-stdio.ts`; the SDK owns spawning and termination with its default filtered environment. Commands run as the daemon's user and are trusted owner-installed code. Core stays portable; Cloudflare runtime testing is deferred until a Cloudflare host is built.

## Web fetch

`plugin-web/src/fetch-page.ts` owns the HTTP read, byte limit and deadline. `convert-html.ts` delegates extraction and Markdown conversion to mdream, then clips the returned text. That file is also exported for host-side workers. No parser or charset scanner is maintained here.

The daemon's plugin list supplies a Piscina-backed converter; `page-worker.ts` calls the same portable conversion function. Piscina owns worker lifetimes, concurrency, queue limits and abort handling. A Cloudflare host can use the default converter under its platform CPU limits, without importing any daemon code.

## Schedules and history

A schedule is a prompt submitted to the main conversation at a local time, once or by RRULE. Its durable task survives restarts. Late repeats deliver the latest missed occurrence once and then resume normally. Cancellation removes the schedule; a task that wakes without one does nothing. Notifications use the reply, falling back to the prompt when no reply was produced. A crash between sending a push and recording completion can cause a duplicate notification.

The daemon owns push subscriptions and VAPID keys. Core only calls the host's `notify`. HTTPS and device setup are described in the README.

History remains in storage after compaction. The client pages older entries and combines them with the active view; the chat scroller preserves the reader's position. Markdown loads separately from the initial chat bundle. The large syntax-highlighting chunks can still trigger a build warning; lazy loading does not make those chunks smaller.
