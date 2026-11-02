# Familiar

A personal AI assistant built on [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable), with one ongoing conversation, long-term memory, reminders and tools. Your conversation stays on your machine and resumes after restarts.

**Documentation: [aidanzealley.github.io/familiar](https://aidanzealley.github.io/familiar/)** (publishes once GitHub Pages deployment is enabled; until then, run `pnpm dev:docs` or read [`apps/docs`](apps/docs/src/content/docs/)).

## Install

macOS and Linux:

```sh
curl -fsSL https://github.com/AidanZealley/familiar/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/AidanZealley/familiar/releases/latest/download/install.ps1 | iex
```

The installer downloads Node if needed, asks for a name, signs you in with your ChatGPT subscription and starts Familiar in the background. Open the URL it prints and chat. Optional [Tailscale](https://tailscale.com/download) access gives your other devices a private HTTPS URL.

This is one personal assistant per user, with no separate app login. Anyone who can reach its address controls the assistant and its tools, so keep it private. Linux and macOS have real-machine testing; Windows has CI coverage only. Export, import and update backups aren't supported yet.

## Packages

The npm packages let you embed Familiar in your own app. Installing a library doesn't install the daemon or UI.

| Part                                                     | Responsibility                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| [@familiar-ai/core](packages/core/README.md)             | Portable assistant, memory, schedules, plugins and HTTP/SSE routes  |
| [@familiar-ai/client](packages/client/README.md)         | Live client store, transcripts and optional React bindings          |
| [@familiar-ai/plugin-web](packages/plugin-web/README.md) | Web search and page reading                                         |
| [@familiar-ai/cloudflare](packages/cloudflare/README.md) | SQLite Durable Object storage and alarm lifecycle                   |
| [Node daemon](apps/daemon/README.md)                     | Local storage, ChatGPT login, network policy, CLI and notifications |
| [Web app](apps/web/README.md)                            | Chat, memory, schedules and Connections UI                          |
| [Development Worker](apps/cloudflare/README.md)          | Scripted Cloudflare host for runtime testing                        |
| [Docs site](apps/docs/README.md)                         | This project's documentation                                        |

Start building with [Your first Familiar](https://aidanzealley.github.io/familiar/build/first-familiar/).

## Developing

Use Node 24.19 or newer and the pnpm version in `package.json`:

```sh
pnpm install
pnpm dev:demo
```

The demo runs a scripted model with disposable in-memory storage, without sign-in or the installed assistant's data. Try `tool`, `memory`, `remind` or `slow` in chat. Leave the running service and its data alone during development.

Before submitting changes, run:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm exec prettier --check .
```

Core and Cloudflare changes also need `pnpm test:cloudflare`; package export or dependency changes need `pnpm test:packages`; documentation changes need `pnpm build:docs`. The [development guide](https://aidanzealley.github.io/familiar/contribute/development/) covers the rest. Local coding conventions are in [AGENTS.md](AGENTS.md).
