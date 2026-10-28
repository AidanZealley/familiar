# Familiar

A personal assistant built on [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable). It keeps one never-ending conversation that survives crashes and restarts, and runs either standalone (this repo's daemon and web UI) or embedded in another app that hosts it.

## Layout

```
packages/core     summonFamiliar(): one assistant over one storage. Portable.
  core/http       The HTTP + SSE API as a fetch handler. Owns the wire types.
  core/persona    Who Familiar is: the stable start of every prompt.
  core/time       The current_time tool, and how dates are written.
  core/context    Request budget, compaction and stream settings.
  core/conversation Message format, sending and history paging.
  core/memory     Facts, episodes, exchange search, recall and read_memory,
                  health, and nightly upkeep at 04:00, the only writer of facts.
  core/schedules  Prompts Familiar runs at a time, once or repeating (a reminder
                  is the simplest), each reply sent to the host's notify.
packages/client   A live mirror of the conversation (vanilla Zustand) and
                  toTranscript() for chat UIs. Browser-safe.
apps/daemon       The Node host: SQLite storage, ChatGPT login, serves the API
                  (and the built web UI).
apps/web          Optional chat UI: Vite, TanStack Router, shadcn (Base UI).
```

The daemon keeps everything it stores in `~/.local/share/familiar`, outside the repo: the ChatGPT login (`auth.json`), the conversation (`familiar.sqlite`), this installation's ID, and Web Push's keys (`vapid.json`) and subscribed browsers (`push.json`). The directory is private to your user. Treat it like a password: it holds a token for your subscription and everything you've told Familiar.

### Rules

- **One Familiar has one owner and one conversation.** Hosts that serve many owners (a household app, say) open one Familiar per owner, e.g. one Durable Object each. Core never knows about tenants.
- **Pi stays behind `Familiar`.** Hosts never get the Harness. When a feature needs a Pi capability, `Familiar` gains a thin passthrough for it, like `onCommit` over `subscribeCommits`, so every host shares one small, deliberate API.
- **Each capability is a folder.** It exports the Pi extension it adds (tools, prompt sections, hooks, tasks) and, if people act on it directly, an owner API and its HTTP routes. `familiar.ts` installs them; a new tool is a new folder or a file in one. See [docs/architecture.md](docs/architecture.md).
- **Hosts own auth.** `createHttpApi` asks the host who sent each request; core only records the author.
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

It runs a demo daemon on `:4318` and Vite on `:5174` (LAN and tailnet), alongside the service. The demo's model is scripted and needs no sign-in, and its conversation lives in memory, so every restart starts fresh; it never opens the data directory. It starts with sample memory, a year of facts, history and episodes about Rowan from the memory eval, so the Memory pages have something to show. A word in your message picks what it does:

| Word      | Familiar                                                                |
| --------- | ----------------------------------------------------------------------- |
| (none)    | Replies with headings, lists, a table and code                          |
| `tool`    | Calls `current_time`, then replies                                      |
| `memory`  | Calls `recall` for the morning drink, then replies with what it found   |
| `remind`  | Schedules a reminder for the next minute, which then notifies           |
| `slow`    | Writes a long reply, to try Stop and queued messages                    |
| `compact` | Fills the context until Pi compacts it (the overflow error is expected) |
| `error`   | Fails partway with an error message                                     |

### Settings

| Variable                | Default                       |                                          |
| ----------------------- | ----------------------------- | ---------------------------------------- |
| `FAMILIAR_MODEL`        | `gpt-6.1-sol`                 | Any OpenAI model in pi-ai's catalog      |
| `FAMILIAR_NAME`         | `Familiar`                    | What the assistant calls itself          |
| `FAMILIAR_OWNER`        | `owner`                       | The author recorded for your messages    |
| `FAMILIAR_PORT`         | `4317`                        |                                          |
| `FAMILIAR_HOST`         | `127.0.0.1`                   |                                          |
| `FAMILIAR_DATA_DIR`     | `~/.local/share/familiar`     | Or `$XDG_DATA_HOME/familiar`             |
| `FAMILIAR_PUSH_CONTACT` | `mailto:familiar@example.com` | Sent to push services with notifications |

The Pi packages are pinned to exact versions in `pnpm-workspace.yaml`'s catalog: their API changes without notice between releases.

### Memory evaluation

Two evals measure memory. The rot test is quick and needs no model; the replay is the real thing and takes hours.

```sh
pnpm eval:recall
```

The rot test asks exchange search alone `rowan-v3`'s questions, with no model: each day of the scenario becomes one exchange, then 1, 5 and 10 years of deterministic filler conversation (ten exchanges a day mentioning the same people and projects) are added after it. At each padding level it checks whether each required answer string appears in a scenario exchange among the top 5 and top 10 results, skipping the few required strings that appear nowhere in the scenario. It prints recall@5 and recall@10 by category and padding level, with index build time and median and maximum search times, and writes them to `eval/results/recall-<date>-<git-describe>.json`. It runs in seconds, so run it after any change to search or ranking; the scores should stay flat as padding grows.

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
