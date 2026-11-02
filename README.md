# Familiar

A personal AI assistant built on [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable), with one ongoing conversation, long-term memory, reminders and tools. Your conversation stays on your machine and resumes after restarts.

[Setup and commands](docs/usage.md) · [Packages](#packages-and-hosts) · [Developing](#developing-and-embedding) · [Ideas](docs/ideas.md)

## Install

macOS:

```sh
curl -fsSL https://github.com/AidanZealley/familiar/releases/latest/download/install.sh | sh
```

Linux:

```sh
curl -fsSL https://github.com/AidanZealley/familiar/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/AidanZealley/familiar/releases/latest/download/install.ps1 | iex
```

The installer downloads Node if needed, asks for a name, signs you in with your ChatGPT subscription and starts Familiar in the background. Open the URL it prints and chat. The installed assistant uses ChatGPT subscription sign-in, not an API key. Optional [Tailscale](https://tailscale.com/download) access gives your other devices a private HTTPS URL.

This is one personal assistant per user. The daemon assigns messages to its owner and trusts access to its network endpoint. Keep that endpoint private; it grants control over the assistant and its tools. There are no app accounts or profiles to set up.

Linux and macOS have real-machine testing. Windows has automated CI coverage; real-machine testing is pending. Export/import and backup safeguards for updates are still ideas, not current protections.

## What it does

- Keeps a conversation across restarts, with streamed replies, tool activity and older history after context compaction.
- Remembers dated facts and episodes, searches past exchanges and reviews memory at 04:00 in your time zone. You can review and correct facts in the UI.
- Runs one-off reminders and recurring prompts in the same conversation, with Web Push notifications on enabled devices.
- Searches through Brave and reads public web pages. Connections manages plugin keys and owner-configured HTTP or local MCP tools.
- Lets you choose the chat model and reasoning level across your devices.

See [usage](docs/usage.md) for settings, sign-in, notifications and CLI commands, and [memory](docs/memory.md) for how remembering works.

## Packages and hosts

The installer gives you the complete personal assistant. The npm packages let you embed Familiar in your own app; installing a library does not install the daemon or UI.

| Part                                                     | Responsibility                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| [@familiar-ai/core](packages/core/README.md)             | Portable assistant, memory, schedules, plugins and HTTP/SSE routes  |
| [@familiar-ai/client](packages/client/README.md)         | Live client store, transcripts and optional React bindings          |
| [@familiar-ai/plugin-web](packages/plugin-web/README.md) | Web search and page reading                                         |
| [@familiar-ai/cloudflare](packages/cloudflare/README.md) | SQLite Durable Object storage and alarm lifecycle                   |
| [Node daemon](apps/daemon/README.md)                     | Local storage, ChatGPT login, network policy, CLI and notifications |
| [Web app](apps/web/README.md)                            | Chat, memory, schedules and Connections UI                          |
| [Development Worker](apps/cloudflare/README.md)          | Scripted Cloudflare host for runtime testing                        |

A host opens one Familiar over one storage and supplies models, credentials, time zone, identity and network policy. Core owns the conversation and its background work. The HTTP adapter streams committed changes; the client mirrors them and derives a transcript for the UI. Pi Durable supplies durable execution behind Familiar's API.

## Developing and embedding

Use Node 24.19 or newer and the pnpm version in `package.json`:

```sh
pnpm install
pnpm dev:demo
```

The demo runs a scripted model with disposable in-memory storage, without sign-in or the installed assistant's data. See [development](docs/development.md) for scenarios, checks, packaging and memory evaluation. Leave the running service and its data alone during development. Read [AGENTS.md](AGENTS.md) for repository boundaries and required checks.

To embed Familiar, start with the [core example](packages/core/README.md#try-it-without-a-provider) and connect your UI with the [client](packages/client/README.md). Supply persistent storage and model credentials for a lasting assistant. Hosts authenticate people and authorize actions; every message has an author with a stable `id` and a display `name`. Several people can share one conversation and memory. The [typed host example](examples/typed-host/README.md) shows how a frontend can expose only the route groups its host mounts.

Core uses portable APIs. A separate experiment ran source core, faux models, MemoryStorage, HTTP/SSE and the client in Chrome without a backend or shims. Published browser artifacts, real providers in a browser, other browsers and iframe embedding remain untested. Node storage and Workers lifecycle code belong in their respective hosts.
