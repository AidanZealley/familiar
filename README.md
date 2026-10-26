# Familiar

A personal assistant built on [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable). It keeps one never-ending conversation that survives crashes and restarts, and runs either standalone (this repo's daemon and web UI) or embedded in another app that hosts it.

## Layout

```
packages/core     openFamiliar(): one assistant over one storage. Portable.
  core/http       The HTTP + SSE API as a fetch handler. Owns the wire types.
  core/conversation Message format, history paging and search.
  core/memory     Long-term facts and daily consolidation at 04:00.
  core/context    Request budget and compaction settings.
  core/persona    Stable instructions and the current_time tool.
packages/client   A live mirror of the conversation (vanilla Zustand) and
                  toTranscript() for chat UIs. Browser-safe.
apps/daemon       The Node host: SQLite storage, ChatGPT login, serves the API
                  (and the built web UI).
apps/web          Optional chat UI: Vite, TanStack Router, shadcn (Base UI).
```

The daemon keeps everything it stores in `~/.local/share/familiar`, outside the repo: the ChatGPT login (`auth.json`), the conversation (`familiar.sqlite`) and this installation's ID. The directory is private to your user. Treat it like a password: it holds a token for your subscription and everything you've told Familiar.

### Rules

- **One Familiar has one owner and one conversation.** Hosts that serve many owners (a household app, say) open one Familiar per owner, e.g. one Durable Object each. Core never knows about tenants.
- **Pi stays behind `Familiar`.** Hosts never get the Harness. When a feature needs a Pi capability, `Familiar` gains a thin passthrough for it, like `onCommit` over `subscribeCommits`, so every host shares one small, deliberate API.
- **Hosts own auth.** `createHttpApi` asks the host who sent each request; core only records the author.
- **Packages stay portable.** `packages/*` may not import `node:*` or Node-only Pi modules. Node code lives in `apps/daemon`. ESLint enforces this.
- **Tools never see the data directory.** Tools run as your user, so file permissions don't stop them. When Familiar gets file or shell tools, their environment must exclude `~/.local/share/familiar`, or a prompt injection could leak the login and the conversation.
- **UIs depend only on `@familiar/client`.** The web app gets nothing other apps can't. pnpm's strict resolution enforces this; ESLint also limits the client to type-only imports from core.

### How the UI stays live

The daemon sends the conversation's committed view once, then each commit's [Chord](https://github.com/earendil-works/pi) operations. The client applies them with `applyImmutable`, so it mirrors the server exactly and reconnecting just means receiving a fresh view.

## Use it

```sh
pnpm install
pnpm sign-in          # Sign in with ChatGPT, once
pnpm service:install  # build, then run as a systemd user service
```

If you sign in on a different device from this machine, the browser's redirect to `127.0.0.1:1455` won't arrive. Paste the URL it ended on into the terminal instead.

The service starts at boot (with `loginctl enable-linger`), restarts if it crashes, and serves the API and web UI on `127.0.0.1:4317`. Rerun `pnpm service:install` to deploy changes; `pnpm service:logs` follows its output.

To reach it from your devices over HTTPS, which the home-screen app and notifications need, publish it on your tailnet only:

```sh
sudo tailscale serve --bg --https=10000 http://127.0.0.1:4317
```

Then open `https://<machine>.<tailnet>.ts.net:10000` and add it to your home screen.

### Developing

Only one daemon may own the data directory; a second one refuses to start.

- **UI work:** `pnpm dev:web` runs Vite on `:5173` (LAN and tailnet) against the running service.
- **Daemon or core work:** `systemctl --user stop familiar`, then `pnpm dev` runs both with reloading. Start the service again when done.

Both use your real conversation and memory. For UI work that shouldn't, use the demo:

```sh
pnpm dev:demo
```

It runs a demo daemon on `:4318` and Vite on `:5174` (LAN and tailnet), alongside the service. The demo's model is scripted and needs no sign-in, and its conversation lives in memory, so every restart starts fresh; it never opens the data directory. A word in your message picks what it does:

| Word      | Familiar                                                                |
| --------- | ----------------------------------------------------------------------- |
| (none)    | Replies with headings, lists, a table and code                          |
| `tool`    | Calls `current_time`, then replies                                      |
| `memory`  | Calls `remember`, then replies                                          |
| `slow`    | Writes a long reply, to try Stop and queued messages                    |
| `compact` | Fills the context until Pi compacts it (the overflow error is expected) |
| `error`   | Fails partway with an error message                                     |

### Settings

| Variable            | Default                   |                                       |
| ------------------- | ------------------------- | ------------------------------------- |
| `FAMILIAR_MODEL`    | `gpt-6.1-sol`             | Any OpenAI model in pi-ai's catalog   |
| `FAMILIAR_NAME`     | `Familiar`                | What the assistant calls itself       |
| `FAMILIAR_OWNER`    | `owner`                   | The author recorded for your messages |
| `FAMILIAR_PORT`     | `4317`                    |                                       |
| `FAMILIAR_HOST`     | `127.0.0.1`               |                                       |
| `FAMILIAR_DATA_DIR` | `~/.local/share/familiar` | Or `$XDG_DATA_HOME/familiar`          |

The Pi packages are pinned to exact versions: their API changes without notice between releases.

### Memory evaluation

Sign in once with a separate ChatGPT login file, then run the 90-day memory scenario:

```sh
FAMILIAR_DATA_DIR=~/.local/share/familiar-eval pnpm sign-in
pnpm eval:memory
```

The eval creates a fresh Familiar in temporary SQLite storage. Its clock advances through 90 days and waits for each 04:00 memory upkeep pass. A 4,000-token context budget compacts old conversation so the questions exercise memory and history search. After replay it closes Familiar and asks each question in a fresh copy of the same SQLite file, three at a time. It asks 25 questions about old facts, changed facts, reasoning across sessions, dates, and things Rowan never said. The same model under test judges each answer against an expected answer. Expect roughly 10 to 30 minutes, depending on model latency and retries. The command prints scores by category and writes the final memory and its character count, compaction count, daily upkeep outcomes, answer tool calls, full answers and verdicts to `eval/results/<date>-<git-describe>.json`. Dirty runs include `-dirty` in the filename. It reads and refreshes only the eval login in `~/.local/share/familiar-eval/auth.json`; it does not open your usual Familiar data directory.
