# How Familiar fits together

The layout and rules define the package boundaries. The sections that follow explain how they connect and in what order to read the code.

## Layout

```
packages/core     summonFamiliar(): one assistant over one storage. Portable.
  core/http       The HTTP + SSE API as a fetch handler. Owns the wire types.
  core/account    Optional sign-in to the models' provider: sign-in from any
                  device, sign-out, and noticing when the login stops working.
  core/persona    Who Familiar is: the host's persona or a default, at the
                  stable start of every prompt.
  core/time       The owner's time zone: current_time, and every conversion
                  between an instant and a calendar day or minute.
  core/context    Request budget, compaction and stream settings.
  core/conversation Message format, sending and history paging.
  core/memory     Facts, episodes, exchange search, recall and read_memory,
                  health, and nightly upkeep at 04:00, the only writer of facts.
  core/schedules  Prompts Familiar runs at a time, once or repeating (a reminder
                  is the simplest), each reply sent to the host's notify.
  core/plugins    Plugin installation, credential declarations, authenticated
                  requests and the Connections API.
  core/mcp        Saved MCP connections, tool discovery and lifecycle.
packages/client   A live mirror of the conversation (vanilla Zustand) and
                  toTranscript() for chat UIs. Browser-safe.
packages/plugin-web  web_search through Brave and web_fetch for public pages.
                  First-party, so the daemon installs it.
packages/cloudflare  DurableFamiliar: one Familiar in one SQLite Durable Object,
                  with its alarm and termination. Workers only.
apps/daemon       The Node host: SQLite storage, ChatGPT login, secrets, the
                  guarded fetch, bounded page-conversion workers and plugin list;
                  serves the API (and the built web UI, with a persona that
                  says what it renders).
apps/web          Optional chat UI: Vite, TanStack Router, shadcn (Base UI).
apps/cloudflare   Development Worker: named bots on a scripted model, behind a
                  token, with tests that run it in workerd.
```

The daemon keeps its data outside the repo, in `~/.local/share/familiar` on Linux, `~/Library/Application Support/Familiar` on macOS, or `%LOCALAPPDATA%\Familiar` on Windows: the ChatGPT login (`auth.json`), the conversation (`familiar.sqlite`), this installation's ID, and Web Push's keys (`vapid.json`) and subscribed browsers (`push.json`), and plugins' secrets such as API keys (`secrets.json`). The directory is private to your user. Treat it like a password: it holds a token for your subscription and everything you've told Familiar.

### Rules

- **One Familiar has one owner and one conversation.** Hosts that serve many owners (a household app, say) open one Familiar per owner, e.g. one Durable Object each. Core never knows about tenants.
- **Pi stays behind `Familiar`.** Hosts never get the Harness. When a feature needs a Pi capability, `Familiar` gains a thin passthrough for it, like `onCommit` over `subscribeCommits`, so every host shares one small, deliberate API.
- **Each capability is a folder.** It exports the Pi extension it adds (tools, prompt sections, hooks, tasks) and, if people act on it directly, an owner API and its HTTP routes. `familiar.ts` installs them; a new tool is a new folder or a file in one. The sections below describe how these pieces connect.
- **Everything beyond core is a plugin.** A plugin is a named factory for a Pi extension, given the clock, `notify`, the host's `fetch` and `authorizedFetch`. Core preserves all extension fields and assigns its name from the plugin name. Familiar owns the authoring import path; advanced extension contracts remain Pi-shaped. First-party extras use the same interface as anyone else's. The daemon installs its own plus any named in `FAMILIAR_PLUGINS`; other hosts choose theirs. Code plugins run in the host's process, so only the owner installs them.
- **Credentials enter through Connections.** The owner sets keys through write-only routes. Plugins receive `authorizedFetch`, which attaches a key only to its declared HTTPS origin, method and path, with redirects unfollowed. Keys are attached at the request boundary; response bodies and tool output pass through unchanged. A service that echoes a key can expose it. The host owns credential storage.
- **Plugins' fetch is the host's.** A model can be talked into fetching any URL, so a host that can reach private, loopback or tailnet addresses must pass a `fetch` that refuses them. The daemon's checks each connection's actual address; a Cloudflare Worker can't reach them and passes its own.
- **Hosts own model credentials.** The host's `Models` holds them and authenticates every request. A host that wants owners to sign in creates an account with `createAccount` and passes it to `summonFamiliar`. Without one, the host keeps the credentials working. See [Model credentials](#model-credentials).
- **Hosts own the persona.** A host may pass `persona`, the text that says who Familiar is, and it replaces the default completely. Core adds what its own features need after it. See [Persona](#persona).
- **Hosts own the time zone.** `summonFamiliar` requires `timeZone`, an IANA name. Core reads every calendar in it and never in the process's zone, so one process can run Familiars in different zones. See [Time zones](#time-zones).
- **Hosts own auth.** `createHttpApi` asks the host who sent each request; core only records the author and shows it to the model. See [Authors](#authors). The daemon trusts its network, so it also refuses requests whose `Host` isn't an IP address, `localhost` or a `*.ts.net` name: a web page that rebinds its own domain to this machine would otherwise reach the whole API.
- **Packages stay portable.** `packages/*` may not import `node:*` or Node-only Pi modules. Node code lives in `apps/daemon`. Workers-only code lives in `packages/cloudflare`, the one package that may import `cloudflare:*` or Pi's Cloudflare modules. ESLint enforces both.
- **Evictable hosts wake Familiar themselves.** A host that passes `onWake` gets no in-process timer for sleeping work. It arms its own wakeup from `wake()` and calls `resume()` when it fires. See [Familiar on Cloudflare](cloudflare.md).
- **Tools never see the data directory.** Tools run as your user, so file permissions don't stop them. When Familiar gets file or shell tools, their environment must exclude `~/.local/share/familiar`, or a prompt injection could leak the login and the conversation.
- **UIs depend only on `@familiar-ai/client`.** The web app gets nothing other apps can't. pnpm's strict resolution enforces this; ESLint also limits the client to type-only imports from core and Pi.

### How the UI stays live

The daemon sends the conversation's committed view once, then each commit's [Chord](https://github.com/earendil-works/pi) operations. Documents such as memory and episodes travel the same way, each under its name. The client applies them with `applyImmutable`, so it mirrors the server exactly and reconnecting just means receiving a fresh view.

### Connecting from another host

`createFamiliarStore(baseUrl, { fetch })` sends every request through the host's `fetch`: API calls, the event stream and each reconnect. The [`eventsource`](https://github.com/EventSource/eventsource) package reads the stream and reconnects. It calls `fetch` again for every attempt, so the host can attach a current credential each time. Without the option, the store uses the platform's `fetch`, and same-origin cookies work as they did with the browser's `EventSource`. `baseUrl` can be relative, like `/api`, or a full URL.

A host that authenticates with a bearer token wraps its own fetch:

```ts
const familiar = createFamiliarStore('https://familiar.example/api', {
  fetch: async (input, init) => {
    // Keeps the method, body, headers and abort signal of the store's request.
    const request = new Request(input, init)
    request.headers.set('Authorization', `Bearer ${await getCurrentToken()}`)
    return fetch(request)
  },
})
```

The returned store exposes `getState()`, `getInitialState()` and `subscribe()` for reads and subscriptions, including Zustand's React adapter. Call explicit commands such as `store.getState().send(text)` to make changes. It does not expose `setState`. The caller owns its lifecycle and calls `store.getState().disconnect()` when finished.

`conversation.ts` owns view, history paging, compaction carryover and transcript derivation. Each conversation transition publishes those values together before notifying subscribers. Transcript references stay stable while the view and history entry references are unchanged. `commands.ts` owns typed HTTP calls and server errors; `events.ts` owns EventSource reconnect and disconnect behavior. `store.ts` assembles them and mirrors other streamed documents.

`getCurrentToken` stands in for the host's own code that returns a valid token, refreshing it first if needed. The store never holds credentials.

`connection` says what the stream is doing:

- `connecting`, then `open` once a full view arrives.
- `reconnecting` after a network error, a stream that ends, or a 5xx or 429 answer. It retries after the server's `retry` delay, 3 seconds by default. The server sends the view and documents whole again, and history carries over as after compaction.
- `outdated` when the stream has an unsupported, malformed or missing protocol handshake. It closes the stream and stops retrying. The host decides when to reload or create a compatible client; the library never reloads the browser.
- `unauthorized` when the stream is answered 401 or 403, and `failed` for any other answer it can't use, such as a 404. Both stop retrying, so a refused stream doesn't keep hitting the server.

Core sends `protocol` with `{ "version": 1 }` as the first event on every
`/events` connection, before opening any watches. This wire version is independent
of package releases. Core owns the advertised version in its HTTP adapter; the
browser-safe client keeps its supported version literal in its events lifecycle.
Update both deliberately when changing compatibility. Sharing a runtime constant
would hide a stale client's supported contract in tests.

The client checks `protocol` through EventSource's event listeners before accepting
any known state event, and resets acceptance on every connection. A legacy server
sending a view first is rejected without applying that view. Silent streams stay
connecting or reconnecting without a deadline. Handshake acceptance alone does not
mean `open`; a full view must arrive. Existing state stays visible on incompatibility.
HTTP commands keep their existing behavior. The host decides when to reload.

The `protocol` event name and JSON `{ "version": number }` framing are a stable
compatibility contract, including across incompatible versions. EventSource has no
wildcard event listener, so unknown event names are ignored, not classified as
incompatible. Future servers must preserve this handshake to announce incompatibility.
Clients predating this handshake cannot retroactively detect an incompatible server:
they ignore the unknown protocol event. This protection starts with clients that
implement the handshake. Reloading may still need a newer server when the server
is the older side.

An open stream keeps the credential it started with. A new token takes effect on the next reconnect. When the owner signs out or switches household, or the stream stops as `unauthorized`, the host calls `disconnect()` and creates a new store. `disconnect()` closes the stream and cancels any pending reconnect. If the host's `fetch` is still waiting for a token, its response is thrown away. The store keeps its last state, so a UI can keep showing it until the new store connects.

Commands reject with the server's reason and are never sent again by the store. Retrying a command is up to its caller. A host's `fetch` that refreshes a token and repeats a refused request repeats writes too, such as a sent message. Commands already sent when `disconnect()` runs still settle with their callers.

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
  account/           createAccount(): the owner's login with the models' provider,
                     as one state: sign-in (a browser page, or a device code
                     where the provider issues one) and sign-out through the
                     host's Models, and a hook that rechecks the login when a
                     request fails. http.ts its routes; the state streams on
                     /events.
  persona/           Who Familiar is: the prompt's preamble, and the default
                     persona for hosts that don't give one.
  time/              current_time, and every conversion between instants and
                     the owner's calendar, in the host's time zone.
  context/           How much conversation fits in a request; compaction; timeouts;
                     which extensions a conversation gets by default.
  conversation/      The message format (message.ts), sending, watching and
                     paging the conversation (api.ts), and how it works, for
                     the prompt (extension.ts).
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
    repeat.ts        RRULE repeats in Familiar's time zone, through rrule.
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
apps/web/src         Chat, Memory, Schedules and Connections, on @familiar-ai/client.
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
2. `http.ts` asks the host who sent it, then calls `familiar.send()` (`conversation/api.ts`), which submits it to the conversation. The entry's data keeps the author and words apart; the model's copy puts a line naming the author above the words.
3. Pi runs a generation task. The request it builds has the system prompt from every extension's sections (the persona, how the conversation works, core facts) and as much recent conversation as the context budget allows; older conversation has been compacted into a summary.
4. Memory's `beforeRequest` hook (`extension.ts`) searches facts outside core and the episodes no rollup covers yet (or any on dates the message names) for the person's words without the author line, and adds at most 8 as a recall note at the end of this request only, memoised so a retried request sees the same note. In the main conversation the note also gets the best two exchanges between the last entry upkeep reviewed and the start of the view, which nothing else would show until upkeep files them. Hooks can't read the transcript, so `createMemory` (`index.ts`) builds the note, in one transaction so upkeep can't file something between reads.
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

Plugins are Pi extensions with metadata and a small context. `plugins/index.ts` installs every extension field unchanged and supplies the installed name. `plugins/tools.ts` reexports tool authoring with thin type aliases; `@familiar-ai/core/extensions` exposes advanced authoring helpers and types. Pi owns validation, transactions, task execution, progress, persistence and replay. Familiar owns the import boundary, while these advanced contracts remain compatible with the pinned Pi version. Hosts do not receive Familiar's Harness instance. `connections.ts` owns credential declarations, the store and the Connections API. `authorized-fetch.ts` checks the destination before loading and attaching a key. It never follows authenticated redirects.

Network restrictions belong to the host. The daemon supplies `guardedFetch`, which checks each connection's destination address; other hosts supply their own fetch. Incoming authentication stays with `createHttpApi` and the host's server.

Responses and tool output are not scrubbed. An upstream service that echoes a key can expose it to the plugin and conversation. There are no masking hooks or output scrubbers. The optional prototype is tracked as later work in the [roadmap](roadmap.md).

## MCP connections

`mcp/manager.ts` owns saved declarations and serializes owner edits. Each connection in `connection.ts` owns its SDK client, runtime status and registry extension. Startup connects servers independently, so an unavailable server does not block chat. Removal aborts the connection and uninstalls its tools; late callbacks cannot reinstall them.

`mcp/index.ts` discovers tools and exposes them as deferred Pi tools through `tool_search`. The SDK owns transport sessions and tool-list notifications; Pi owns tool loading and replay policy. MCP tools use `replay: 'unsafe'`. An ordinary tool error leaves connection status alone; HTTP 401 requests credentials and 404 reconnects an expired session for subsequent calls. Failed calls are never automatically repeated.

Declarations live with the conversation in `McpServers`; bearer tokens stay in the host's secret store. Connections combines declarations with runtime status and discovered tools. The owner can add, remove and reconnect servers and change credentials. Names and transports are immutable, so changing an endpoint requires removing and re-adding it. Setup and API details are in the [usage guide](usage.md#mcp-connections).

The host supplies `mcpFetch` separately from plugins' guarded fetch. The daemon permits owner-configured localhost, LAN and tailnet endpoints, while the HTTP adapter restricts requests and credentials to the exact endpoint and refuses redirects. Node-only stdio transport construction lives in `apps/daemon/src/mcp-stdio.ts`; the SDK owns spawning and termination with its default filtered environment. Commands run as the daemon's user and are trusted owner-installed code. Core stays portable; MCP on Workers is still untested.

## Web fetch

`plugin-web/src/fetch-page.ts` owns the HTTP read, byte limit and deadline. `convert-html.ts` delegates extraction and Markdown conversion to mdream, then clips the returned text. That file is also exported for host-side workers. No parser or charset scanner is maintained here.

The daemon's plugin list supplies a Piscina-backed converter; `page-worker.ts` calls the same portable conversion function. Piscina owns worker lifetimes, concurrency, queue limits and abort handling. A Cloudflare host can use the default converter under its platform CPU limits, without importing any daemon code.

## Schedules and history

A schedule is a prompt submitted to the main conversation at a time in Familiar's zone, once or by RRULE. Its durable task survives restarts. Late repeats deliver the latest missed occurrence once and then resume normally. Cancellation removes the schedule; a task that wakes without one does nothing. Notifications use the reply, falling back to the prompt when no reply was produced. A crash between sending a push and recording completion can cause a duplicate notification.

The daemon owns push subscriptions and VAPID keys. Core only calls the host's `notify`. HTTPS and device setup are described in the README.

History remains in storage after compaction. The client pages older entries and combines them with the active view; the chat scroller preserves the reader's position. Markdown loads separately from the initial chat bundle. The large syntax-highlighting chunks can still trigger a build warning; lazy loading does not make those chunks smaller.

## Model credentials

Pi's `Models` is the one place credentials live. It reads them from the host's credential store and attaches them to every model request. Familiar never sees a token.

A host chooses whether owners can manage the login. These examples use the workspace's own imports; the packages aren't published. The daemon attaches an account, so the web UI walks the owner through ChatGPT's sign-in:

```ts
import { createAccount, summonFamiliar } from '@familiar-ai/core'

const models = createModels({ credentials: fileCredentialStore(path) })
models.setProvider(openaiProvider())

const account = await createAccount({
  models,
  provider: 'openai',
  login: { getDeviceId: deviceId, agentName: 'Familiar' },
})
const familiar = await summonFamiliar({
  storage,
  models,
  model: { provider: 'openai', modelId: 'gpt-6.1-sol' },
  timeZone,
  account,
})
```

A host that supplies credentials itself, from an API key or its own login, leaves `account` out:

```ts
const familiar = await summonFamiliar({ storage, models, model, timeZone })
```

Then `familiar.account` is undefined, the `/account` routes answer 404 and `/events` sends `account` as `null`. The client keeps `account` undefined until that first event, so a UI can tell "not known yet" from "not offered" and shows no sign-in controls for `null`. Chat, upkeep and schedules work the same either way. A request whose credentials fail ends in an error reply, like any other model failure; nothing else tracks credential health.

An account works on its own too, say for a setup screen that signs in before the host opens Familiar. Its `api` has the state, sign-in and sign-out; `close()` cancels an unfinished sign-in and drops its listeners.

Three rules keep the two in step:

- `summonFamiliar` refuses an account made for a different `Models` instance or for another provider than `model`'s. Otherwise the account would report on a login the requests don't use.
- Familiar installs the account's response hook itself, so hosts never handle Pi hooks. It marks the login expired when a request fails and the provider rejects the stored token.
- An account can attach to only one Familiar and cannot attach after closing. Ownership transfers when `summonFamiliar` succeeds. If startup fails, the host keeps the account and can retry or close it.
- Once attached, the Familiar owns the account. `dismiss()` closes it. That cancels an unfinished sign-in but keeps the stored login, and a login that finishes afterwards changes no state.

## Persona

The persona is the start of every prompt: who Familiar is and how it talks. A host passes it to `summonFamiliar` as one string, used exactly as given. Gatherbot, say, would replace it outright:

```ts
const familiar = await summonFamiliar({
  storage,
  models,
  model,
  timeZone,
  name: 'Gatherbot',
  persona: `You are Gatherbot, the assistant for one household in Gather. You help them plan meals, chores and events. Be friendly and keep replies short.`,
})
```

Leave `persona` out and Familiar uses `defaultPersona(name)`, exported from `@familiar-ai/core`: "You are <name>, a personal assistant", and a tone. It promises nothing about how replies look, because only the host knows what its UI draws. The daemon serves the web UI, which draws KaTeX, Mermaid and images, so it passes `webPersona(name)` from `apps/daemon/src/persona.ts`: the default with a paragraph about those added. The demo does the same. The Cloudflare development Worker serves no UI and passes nothing.

`name` is a separate thing. It titles notifications and tells memory upkeep whose memory it keeps, and core never puts it in a host's persona. A persona that should know its name says it, like Gatherbot's.

Core adds its own instructions after the persona, whatever it says: how the one conversation works, what memory holds and how to search it, what a scheduled prompt is, and every tool. A host's persona doesn't repeat them.

The persona is read once when the Familiar opens. A section that changed between requests would resend the prompt and lose the provider's cache, so changing it means reopening.

## Authors

Several people can share one conversation, so the model needs to know who said what. The author is whatever the host's `authenticate` returns for the request. The daemon returns `FAMILIAR_OWNER`; a household app would return the signed-in person's name. Core doesn't look names up, so the host should return a label the model can address, such as a first name.

The entry's data, `{ author, text }`, is the record. `formatMessage` in `conversation/message.ts` writes the model's copy from it: one line naming the author, then the words unchanged.

```
[Message from "Sam"]
Can you move dinner to 7?
```

The name is a JSON string with Unicode line breaks escaped too, so it can't end the line early. Formatting only goes one way, and nothing parses the model's copy back. The transcript, exchange search, `read_memory` and upkeep read the data through `saidBy`.

Automatic recall searches the person's words as well, so an author's name can't match facts about them. `answeredMessage` reads the generation task's checkpoint for the newest entry its request includes, then scans back to the latest input. It skips a compaction summary, which is stored after the entries it kept but read before them, and stops at the start of the view. When that input is a person's message, recall searches its `text`. A scheduled prompt or an upkeep pass is searched as the model sees it.

Pi stores the model's copy in the entry when the message is placed, so later requests and compaction's summary requests show the same line, and the prompt doesn't change with who's speaking. Messages stored before authors were shown keep their bare words as the model's copy. Their data still has the author.

Core's conversation guidance tells the model that only the first line names the sender, and that `[Scheduled for …]` prompts come from no one. The line says who wrote a message; it isn't access control. Someone can type words that claim to be another person, and the model may believe them. What a person may do is the host's decision.

## Time zones

The host passes `timeZone` to `summonFamiliar`: an IANA name such as `Europe/London`. It is required. A name the runtime's `Intl` doesn't know throws a `RangeError` before storage opens. The daemon passes the machine's zone. Tests, the demo and other hosts pass their own.

`time/index.ts` is the only code that turns an instant into a calendar day or minute, or a wall-clock time back into an instant. It uses `Intl.DateTimeFormat`, which every runtime Familiar targets has. Everything zoned goes through it: current_time's default, schedules' times and RRULEs, the days on facts, episodes and exchanges, dates named in searches, the times upkeep is shown, and upkeep's 04:00. Plugins get the zone in their context and write times with core's `localMinute`. Instants (`now()`, every stored `at`) are milliseconds since the epoch and ignore the zone. Arithmetic on `YYYY-MM-DD` days, such as weeks, months and the review's 30 days, needs no zone.

Clock changes follow Temporal's `compatible` rule. A wall time that happens twice, when the clocks go back, means the first. A wall time the clocks skip moves forward by the gap: a daily 01:30 repeat runs at 02:30 on London's spring-forward night, and an hourly repeat runs once during the repeated hour. A one-off for a skipped minute is refused, as before. Upkeep runs at 04:00 on the wall clock, so an upkeep day with a clock change lasts 23 or 25 hours.

### Changing zone

Reopening the same storage with another zone needs no migration. The new zone applies from that open, with these exceptions:

- A one-off schedule is stored as an instant, so it keeps its absolute time. A reminder set for 09:00 in London fires at 04:00 in New York.
- A repeat keeps its RRULE and follows the new zone from its next delivery. The occurrence already stored in `next` keeps its time.
- Upkeep's sleeping task wakes at the instant it was given, so the first pass runs at the old 04:00. Later passes run at 04:00 in the new zone.
- Stored days are not reinterpreted: facts' `since` and `until`, and episodes' `start` and `end`. They are zone-free `YYYY-MM-DD` strings, and nothing records the zone they were written in, so around a move one can be a day off compared with the new zone. Exchange days are worked out from timestamps whenever the index is built, so they follow the new zone.
- Text already in the conversation, such as `[Scheduled for 2026-10-22 07:00]` or a tool result, keeps the times it was written with.

## React clients

React 18 and 19 apps can use the optional `@familiar-ai/client/react` entry.
React is an optional peer dependency; the main client entry has no React imports.
The app supplies its existing React installation.

```tsx
import { createFamiliarStore } from '@familiar-ai/client'
import {
  FamiliarProvider,
  useFamiliar,
  useTranscript,
} from '@familiar-ai/client/react'

// Create once in the host's connection lifecycle, outside render.
const store = createFamiliarStore('/api')

const Chat = () => {
  const connection = useFamiliar((state) => state.connection)
  const transcript = useTranscript()
  return (
    <p>
      {connection}: {transcript?.items.length ?? 0} items
    </p>
  )
}

const App = () => (
  <FamiliarProvider store={store}>
    <Chat />
  </FamiliarProvider>
)
```

The caller owns the store and calls `store.getState().disconnect()` when its
connection is no longer needed. Mounting, replacing or unmounting a provider
never opens or closes a connection. Each hook reads the nearest provider, so
independent or nested providers can use different stores. Hooks throw without a
provider. `useTranscript()` selects `state.transcript`, including `undefined`
before the first view. `useFamiliar(selector)` uses Zustand's React adapter with
the store's read and subscription methods. Selections use `Object.is` comparison;
selectors should return stable values when their inputs have not changed.
