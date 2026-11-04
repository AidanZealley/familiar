---
title: Overview
description: What Familiar's packages do, and what your host supplies.
---

The installer gives you a complete assistant. The npm packages give you the same assistant to embed in your own app. Installing a package doesn't install the daemon or the web UI.

## Packages

| Package                   | What it does                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `@familiar-ai/core`       | The assistant: one conversation, memory, schedules, plugins and the HTTP/SSE routes that serve it |
| `@familiar-ai/client`     | A browser-safe store that mirrors the API, derives a chat transcript and offers React bindings    |
| `@familiar-ai/cloudflare` | Runs one Familiar in a SQLite-backed Cloudflare Durable Object                                    |

Core is portable. It has no Node-only code, starts no server and renders nothing. The repository's Node daemon and Cloudflare Worker are two hosts built on it.

## What your host owns

A host opens one Familiar over one storage. It supplies:

- **Storage.** `MemoryStorage` for tests, Pi Durable's SQLite storage on Node, or a Durable Object on Workers. Only one live Familiar may own a storage at a time.
- **Models and credentials.** A `Models` instance with providers registered and a credential store. See [Models and sign-in](/familiar/build/models-and-sign-in/).
- **Time zone.** An IANA zone such as `Europe/London`. Memory dates, upkeep and schedules use it.
- **Identity.** Who sent each message. Familiar records an `Author` with a stable `id` and a display `name`. It doesn't authenticate anyone.
- **Authorization.** Whether that person may do what they ask. Attribution grants nothing.
- **Network policy.** A `fetch` for plugins that can't reach private addresses, and separate hooks for owner-configured MCP servers.
- **Notifications.** An optional `notify` for scheduled replies, such as Web Push.

## What Familiar owns

Familiar owns the conversation and everything it does in the background: replies, tool calls, memory upkeep, schedules and recovery after a crash. Pi Durable runs that work and commits each change to storage. The HTTP adapter streams those commits, and the client mirrors them. Your UI renders the client's state and sends commands. It never edits state directly.

Several people can share one Familiar. Each message keeps its author, and tools can see who started a run. They also share one memory and one conversation. A host that serves separate people opens one Familiar for each.

## Where to go next

1. [Your first Familiar](/familiar/build/first-familiar/) runs the real assistant with a scripted model.
2. [Models and sign-in](/familiar/build/models-and-sign-in/) swaps in a real provider.
3. [Serve the API](/familiar/build/serve-the-api/) puts it behind HTTP with your own auth.
4. [Connect a frontend](/familiar/build/connect-a-frontend/) renders it in a browser.
5. [Customise your assistant](/familiar/build/customise/) adds a persona, plugins and tools.
