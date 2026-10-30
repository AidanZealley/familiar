# Familiar

A personal assistant built on [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable). It keeps one never-ending conversation that survives crashes and restarts, and runs either standalone (this repo's daemon and web UI) or embedded in another app that hosts it.

## Layout

```
packages/core     summonFamiliar(): one assistant over one storage. Portable.
  core/http       The HTTP + SSE API as a fetch handler. Owns the wire types.
  core/account    The owner's login with the models' provider: device-code
                  sign-in, sign-out, and noticing when the login stops working.
  core/persona    Who Familiar is: the stable start of every prompt.
  core/time       The current_time tool, and how dates are written.
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
apps/daemon       The Node host: SQLite storage, ChatGPT login, secrets, the
                  guarded fetch, bounded page-conversion workers and plugin list;
                  serves the API (and the built web UI).
apps/web          Optional chat UI: Vite, TanStack Router, shadcn (Base UI).
```

The daemon keeps everything it stores in `~/.local/share/familiar`, outside the repo: the ChatGPT login (`auth.json`), the conversation (`familiar.sqlite`), this installation's ID, and Web Push's keys (`vapid.json`) and subscribed browsers (`push.json`), and plugins' secrets such as API keys (`secrets.json`). The directory is private to your user. Treat it like a password: it holds a token for your subscription and everything you've told Familiar.

### Rules

- **One Familiar has one owner and one conversation.** Hosts that serve many owners (a household app, say) open one Familiar per owner, e.g. one Durable Object each. Core never knows about tenants.
- **Pi stays behind `Familiar`.** Hosts never get the Harness. When a feature needs a Pi capability, `Familiar` gains a thin passthrough for it, like `onCommit` over `subscribeCommits`, so every host shares one small, deliberate API.
- **Each capability is a folder.** It exports the Pi extension it adds (tools, prompt sections, hooks, tasks) and, if people act on it directly, an owner API and its HTTP routes. `familiar.ts` installs them; a new tool is a new folder or a file in one. See [docs/architecture.md](docs/architecture.md).
- **Everything beyond core is a plugin.** A plugin is a named factory for a Pi extension, given the clock, `notify`, the host's `fetch` and `authorizedFetch`. Core assigns its extension name from the plugin name. First-party extras use the same interface as anyone else's. The daemon installs its own plus any named in `FAMILIAR_PLUGINS`; other hosts choose theirs. Code plugins run in the host's process, so only the owner installs them.
- **Credentials enter through Connections.** The owner sets keys through write-only routes. Plugins receive `authorizedFetch`, which attaches a key only to its declared HTTPS origin, method and path, with redirects unfollowed. Keys are attached at the request boundary; response bodies and tool output pass through unchanged. A service that echoes a key can expose it. The host owns credential storage.
- **Plugins' fetch is the host's.** A model can be talked into fetching any URL, so a host that can reach private, loopback or tailnet addresses must pass a `fetch` that refuses them. The daemon's checks each connection's actual address; a Cloudflare Worker can't reach them and passes its own.
- **Hosts own auth.** `createHttpApi` asks the host who sent each request; core only records the author. The daemon trusts its network, so it also refuses requests whose `Host` isn't an IP address, `localhost` or a `*.ts.net` name: a web page that rebinds its own domain to this machine would otherwise reach the whole API.
- **Packages stay portable.** `packages/*` may not import `node:*` or Node-only Pi modules. Node code lives in `apps/daemon`. ESLint enforces this.
- **Tools never see the data directory.** Tools run as your user, so file permissions don't stop them. When Familiar gets file or shell tools, their environment must exclude `~/.local/share/familiar`, or a prompt injection could leak the login and the conversation.
- **UIs depend only on `@familiar/client`.** The web app gets nothing other apps can't. pnpm's strict resolution enforces this; ESLint also limits the client to type-only imports from core and Pi.

### How the UI stays live

The daemon sends the conversation's committed view once, then each commit's [Chord](https://github.com/earendil-works/pi) operations. Documents such as memory and episodes travel the same way, each under its name. The client applies them with `applyImmutable`, so it mirrors the server exactly and reconnecting just means receiving a fresh view.

## Use it

```sh
pnpm install
pnpm sign-in          # Sign in with ChatGPT, once
pnpm service:install  # build, then run as a systemd user service
```

If you sign in on a different device from this machine, the browser's redirect to `127.0.0.1:1455` won't arrive. Paste the URL it ended on into the terminal instead.

Once the service runs, sign in from the web UI instead: whenever Familiar isn't signed in, or its login stops working, the chat offers a device code to enter on ChatGPT from any device, and the new login applies without a restart. Settings signs out. `pnpm sign-in` refuses while the service runs, since the running daemon wouldn't see its login.

The service starts at boot (with `loginctl enable-linger`), restarts if it crashes, and serves the API and web UI on `127.0.0.1:4317`. Rerun `pnpm service:install` to deploy changes; `pnpm service:logs` follows its output.

To reach it from your devices over HTTPS, which the home-screen app and notifications need, publish it on your tailnet only:

```sh
sudo tailscale serve --bg --https=10000 http://127.0.0.1:4317
```

Then open `https://<machine>.<tailnet>.ts.net:10000` and add it to your home screen.

Ask Familiar for reminders and anything regular in chat ("remind me at 6 to call Mum", "every weekday at 7, brief me on my day"). Each one runs at its time in the conversation, and its reply arrives as a notification on every device you enabled with **Enable** on the Schedules page:

- **iPhone:** only from the home-screen app, iOS 16.4 or later.
- **Brave on macOS:** turn on "Use Google services for push messaging" in `brave://settings/privacy`, and allow Brave in System Settings → Notifications.

### Developing

Only one daemon may own the data directory; a second one refuses to start.

- **UI work:** `pnpm dev:web` runs Vite on `:5173` (LAN and tailnet) against the running service.
- **Daemon or core work:** `systemctl --user stop familiar`, then `pnpm dev` runs both with reloading. Start the service again when done.

Both use your real conversation and memory. For UI work that shouldn't, use the demo:

```sh
pnpm dev:demo
```

It runs a demo daemon on `:4318` and Vite on `:5174` (LAN and tailnet), alongside the service. The demo's model is scripted and needs no sign-in, and its conversation lives in memory, so every restart starts fresh; it never opens the data directory. It starts with sample memory, a year of facts, history and episodes about Rowan from the memory eval, so the Memory pages have something to show. Its two scripted models answer alike, so the model picker has a choice. A word in your message picks what it does:

| Word      | Familiar                                                                                    |
| --------- | ------------------------------------------------------------------------------------------- |
| (none)    | Replies with headings, lists, a table and code                                              |
| `tool`    | Pauses, streams expandable demo reasoning, calls `current_time`, pauses again, then replies |
| `memory`  | Calls `recall` for the morning drink, then replies with what it found                       |
| `remind`  | Schedules a reminder for the next minute, which then notifies                               |
| `key`     | Checks that a pretend service received the demo key without returning it                    |
| `mcp`     | Finds an MCP `echo` tool through tool search and calls it                                   |
| `slow`    | Writes a long reply, to try Stop and queued messages                                        |
| `compact` | Fills the context until Pi compacts it (the overflow error is expected)                     |
| `error`   | Fails partway with an error message                                                         |

The demo lives in `apps/daemon/src/demo/`: `main.ts` starts it, `model.ts` routes scripted responses, and `scenarios/` owns each feature's demonstration. The Connections page starts with pretend MCP servers in every state: connected, needing a token, failed, and a local command that exits after 20 seconds. Bearer servers accept `demo-token` and refuse anything else. Any other `*.demo.invalid` URL, or any command, serves an `echo` tool, so adding `http://echo.demo.invalid/mcp` from the page and saying `mcp` in chat tries a new server end to end. Nothing reaches the network or starts a process.

New scenarios belong beside the existing ones and are registered explicitly in `model.ts`; startup should stay wiring only. Only model responses and external services are faked. Memory, schedules, Connections and conversation storage use the real implementation, with in-memory data that disappears on restart.

### Settings

| Variable                | Default                       |                                                           |
| ----------------------- | ----------------------------- | --------------------------------------------------------- |
| `FAMILIAR_MODEL`        | `gpt-6.1-sol`                 | Memory upkeep's model, and the chat's first; see below    |
| `FAMILIAR_NAME`         | `Familiar`                    | What the assistant calls itself                           |
| `FAMILIAR_OWNER`        | `owner`                       | The author recorded for your messages                     |
| `FAMILIAR_PORT`         | `4317`                        |                                                           |
| `FAMILIAR_HOST`         | `127.0.0.1`                   |                                                           |
| `FAMILIAR_DATA_DIR`     | `~/.local/share/familiar`     | Or `$XDG_DATA_HOME/familiar`                              |
| `FAMILIAR_PUSH_CONTACT` | `mailto:familiar@example.com` | Sent to push services with notifications                  |
| `FAMILIAR_PLUGINS`      | (none)                        | Extra plugins, comma-separated packages or absolute paths |

The chat's model and reasoning level are picked in the composer, saved with the conversation and shared by every device. The models offered, and the level each starts on, are `chatModels` in `apps/daemon/src/config.ts`; `FAMILIAR_MODEL` must be one of them. It sets the chat's model only until one is picked, and the level a model was last set to is kept for when you switch back. Memory upkeep always runs on `FAMILIAR_MODEL` at its default level.

The Pi packages are pinned to exact versions in `pnpm-workspace.yaml`'s catalog: their API changes without notice between releases.

### Memory evaluation

Three evals measure memory. The rot test and the unfiled test are quick and need no model; the replay is the real thing and takes hours.

```sh
pnpm eval:recall
```

The rot test asks exchange search alone `rowan-v3`'s questions, with no model: each day of the scenario becomes one exchange, then 1, 5 and 10 years of deterministic filler conversation (ten exchanges a day mentioning the same people and projects) are added after it. At each padding level it checks whether each required answer string appears in a scenario exchange among the top 5 and top 10 results, skipping the few required strings that appear nowhere in the scenario. It prints recall@5 and recall@10 by category and padding level, with index build time and median and maximum search times, and writes them to `eval/results/recall-<date>-<git-describe>.json`. It runs in seconds, so run it after any change to search or ranking; the scores should stay flat as padding grows.

```sh
pnpm eval:unfiled
```

The unfiled test measures what automatic recall shows of conversation that compaction took out of the model's view and upkeep hasn't filed yet. A scripted model replays `rowan-v3` in a 4,000-token budget with upkeep held off, so everything compacted stays unfiled, then each question is sent to a fresh copy of the replay and its recall note is checked for the required strings. It isolates retrieval: a year of unfiled conversation competes, where normally only the hours since the last 04:00 pass would, but facts and episodes are empty, so it can't show what giving exchanges part of the note costs them. It prints, by category, how many required strings the note contained, how many were still verbatim in the request, and how many only the note had, with the note's size, and writes them to `eval/results/unfiled-<date>-<git-describe>.json`. Unknown questions are scored only on their supporting details; whether the model then says it doesn't know needs the replay. It runs in seconds, so run it after any change to automatic recall.

The replay plays the scenario through a real model. Sign in once with a separate ChatGPT login file, then run it:

```sh
FAMILIAR_DATA_DIR=~/.local/share/familiar-eval pnpm sign-in
pnpm eval:memory
```

The eval creates a fresh Familiar in SQLite storage retained under its eval run directory. It replays `rowan-v3`, about a year of Rowan's life with far more lasting detail than core memory holds; its clock advances through 400 days and waits for each 04:00 memory upkeep pass. A 4,000-token context budget compacts old conversation so the questions exercise memory and history search. After replay it closes Familiar and asks each question in a fresh copy of the same SQLite file, three at a time. It asks 50 questions, 10 each about old details, earlier values of facts that changed, reasoning across sessions, periods of time, and things Rowan never said or hasn't decided. A judge model, pinned to `gpt-6.1-sol` (override with `FAMILIAR_JUDGE_MODEL`) so changing the model under test doesn't also change the grading, checks each answer against its required facts and checks any other claim against the scenario's full text. Expect about three hours with `gpt-6.1-sol`, mostly replay, depending on model latency and retries. The command prints scores by category and tokens spent on replay, answers and judging, and writes those totals, per-question tokens, the final memory and its character count, compaction count, daily upkeep outcomes, answer tool calls, full answers and verdicts to `eval/results/<date>-<git-describe>.json`. Dirty runs include `-dirty` in the filename. It reads and refreshes only the eval login in `~/.local/share/familiar-eval/auth.json`; it does not open your usual Familiar data directory.

The replay is kept in `~/.local/share/familiar-eval/runs/<time>-<commit>/`. If a run stops partway, for example at a ChatGPT usage limit, continue it from the day after the last one it sent:

```sh
pnpm eval:memory --resume ~/.local/share/familiar-eval/runs/<run>
```

A day whose reply failed stays in the conversation unanswered, and the result's `resumedFrom` records where the run continued.

After changing the judge, grade a saved run again instead of replaying it. This takes about a minute and writes `<result>.rejudged.json` beside the original:

```sh
pnpm eval:memory:rejudge eval/results/<file>.json
```

### Reading web pages

`web_fetch` reads public HTTP(S) pages as Markdown or plain text. It uses the host's fetch, without a service key or browser automation. Markdown is requested first; HTML is converted by `@mdream/js`, which handles parsing, links, tables and common navigation filtering. Familiar does not implement its own HTML parser, article scoring or Markdown rules. PDFs and images are unsupported.

Reads stop with an error above 3 MB or after 15 seconds, including body reading and conversion. Output defaults to 12,000 characters, at most 30,000, with a truncation marker. Text uses the declared HTTP charset through `TextDecoder`, otherwise UTF-8; HTML meta-charset sniffing is deliberately omitted.

The plugin uses portable JavaScript and Web APIs. Its default HTML conversion runs in the host's thread, suitable for a Worker with platform CPU limits. Hosts without an interruptible per-request CPU limit should pass `webPlugin({ convert })`. The Node daemon uses Piscina: at most two conversions run, eight may wait, worker old-generation heaps are limited to 128 MB, and the request's abort signal stops the conversion worker. These Node dependencies stay in the daemon.

Fetched text is untrusted. Network filtering prevents private-network requests, but does not stop prompt injection or the model putting private information into a public URL. Pages are not made trustworthy by converting them to Markdown.

### MCP connections

Hosts can manage MCP servers through `familiar.mcp.add({ name, transport })`, `remove(name)` and `reconnect(name)`. An HTTP transport is `{ type: 'http', url, auth: { type: 'none' | 'bearer' } }`. A local process uses `{ type: 'stdio', command, args }`, with an executable and an argument array. The equivalent owner routes live under `/api/mcp`; bearer tokens use the write-only Connections routes at `/api/connections/mcp/:name/secrets/token`. The Connections page does the same: it adds, removes and reconnects servers, sets bearer tokens and shows each server's status and tools. A server's name and transport are fixed, so changing either means removing it and adding it again.

Declarations persist with the conversation, while tokens stay in the host's secret store. `familiar.connections.list()` includes runtime status and discovered tools. Servers connect independently, so an unavailable server does not block chat. Tools load through Pi's `tool_search`; failed calls are never replayed automatically. Reconnect restores an expired session for subsequent calls.

The host supplies `mcpFetch` separately from plugins' `fetch`. The daemon allows localhost, LAN and tailnet addresses for these owner-configured endpoints. Requests and bearer credentials are restricted to that exact endpoint, and redirects fail. Existing web search/fetch restrictions are unchanged. Core retains portable imports; Cloudflare runtime testing is deferred.

The daemon also supplies `mcpStdio`, a small factory for the SDK's `StdioClientTransport`. Core never imports subprocess code. Commands run directly without a shell; relative paths use the daemon's working directory, so prefer absolute paths for scripts. The SDK inherits a limited environment such as PATH and HOME, excluding Familiar's configuration, provider-token variables and NODE_OPTIONS. It handles stdin/stdout, shutdown and process termination. Process exit removes the tools and reports `disconnected`; Reconnect starts a fresh process. Hosts without this factory report stdio servers as unsupported.

Local MCP programs are trusted owner-installed code running as the daemon's user. The filtered environment is not a filesystem sandbox. Stdio servers have no bearer-token field or custom environment settings in this version.

Access to the daemon's owner API includes permission to launch stdio commands as its user. Keep that API on trusted devices and networks. Commands and arguments are saved with the conversation and returned by Connections, so keep secrets in the MCP program's own configuration or a wrapper script, not in arguments.
