# Familiar

A personal assistant built on [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable). It keeps one never-ending conversation that survives crashes and restarts, and runs either standalone (this repo's daemon and web UI) or embedded in another app that hosts it.

## Layout

```
packages/core     openFamiliar(): one assistant over one storage. Portable.
  core/http       The HTTP + SSE API as a fetch handler. Owns the wire types.
packages/client   A live mirror of the conversation (vanilla Zustand) and
                  toTranscript() for chat UIs. Browser-safe.
apps/daemon       The Node host: SQLite storage, ChatGPT login, serves the API
                  (and the built web UI).
apps/web          Optional chat UI: Vite, TanStack Router, shadcn (Base UI).
```

The daemon keeps everything it stores in `~/.local/share/familiar`, outside the repo: the ChatGPT login (`auth.json`), the conversation (`familiar.sqlite`) and this installation's ID. The directory is private to your user. Treat it like a password: it holds a token for your subscription and everything you've told Familiar.

### Rules

- **One Familiar has one owner and one conversation.** Hosts that serve many owners (a household app, say) open one Familiar per owner, e.g. one Durable Object each. Core never knows about tenants.
- **Hosts own auth.** `createHttpApi` asks the host who sent each request; core only records the author.
- **Packages stay portable.** `packages/*` may not import `node:*` or Node-only Pi modules. Node code lives in `apps/daemon`. ESLint enforces this.
- **Tools never see the data directory.** Tools run as your user, so file permissions don't stop them. When Familiar gets file or shell tools, their environment must exclude `~/.local/share/familiar`, or a prompt injection could leak the login and the conversation.
- **UIs depend only on `@familiar/client`.** The web app gets nothing other apps can't. pnpm's strict resolution enforces this; ESLint also limits the client to type-only imports from core.

### How the UI stays live

The daemon sends the conversation's committed view once, then each commit's [Chord](https://github.com/earendil-works/pi) operations. The client applies them with `applyImmutable`, so it mirrors the server exactly and reconnecting just means receiving a fresh view.

## Use it

```sh
pnpm install
pnpm sign-in # Sign in with ChatGPT, once
pnpm dev     # daemon on 127.0.0.1:4317, web UI on :5173 (LAN and tailnet)
```

If you sign in on a different device from this machine, the browser's redirect to `127.0.0.1:1455` won't arrive. Paste the URL it ended on into the terminal instead.

Production: `pnpm build && pnpm start` serves the API and the UI from the daemon alone.

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
