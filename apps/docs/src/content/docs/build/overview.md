---
title: Overview
description: What Familiar's packages do, and what your host supplies.
---

The installer gives you a complete assistant. The npm packages give you the same assistant to embed in your own app. Installing a package doesn't install the daemon or the web UI.

## Packages

| Package                   | What it does                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@familiar-ai/core`       | A workspace of Familiars and the rooms people talk to them in, with memory, schedules, plugins and the HTTP/SSE routes that serve it |
| `@familiar-ai/client`     | Browser-safe stores that mirror the API, derive a room's chat transcript and offer React bindings                                    |
| `@familiar-ai/cloudflare` | Runs one workspace in a SQLite-backed Cloudflare Durable Object                                                                      |

Core is portable. It starts no server and renders nothing. Its Node-only building blocks, file-backed secrets and a data-directory lock, are a separate entry, `@familiar-ai/core/node`. The installable daemon, the [Node server example](/familiar/examples/node-server/) and the Cloudflare Worker are hosts built from the same pieces.

## What your host owns

A host opens one workspace over one storage, and creates its Familiars and rooms on the first open. It supplies:

- **Storage.** `MemoryStorage` for tests, Pi Durable's SQLite on Node, or a Durable Object on Workers. One live workspace per storage.
- **Models and credentials.** See [Models and sign-in](/familiar/build/models-and-sign-in/).
- **A time zone**, such as `Europe/London`, for memory's dates and schedules.
- **Identity.** Who sent each message, as an `Author` with a stable `id` and a `name`. Familiar doesn't authenticate anyone.
- **Authorization.** Which operations each person may use, with `createHttpApi`'s `allow`. Rules about your own data belong in your tools, checked against the call's author.
- **Audience.** Everyone who reaches a Familiar shares what it remembers, its tools and schedules, so separate audiences get separate workspaces.
- **Network policy.** Tools' `fetch`, and the MCP transports `mcpFetch` and `mcpStdio`. On Node, the default `fetch` refuses private addresses.
- **Notifications**, optionally: who receives each scheduled reply.
- **Browser protection**, such as CSRF protection for cookie sign-in. `createHttpApi` adds none.

## What Familiar owns

Familiar owns rooms and everything its Familiars do: whose turn a message is, replies, tool calls, memory, schedules and recovery after a crash. Pi Durable runs that work and commits each change to storage; the HTTP API streams those commits, and the client mirrors them. Your UI renders the client's state and sends commands.

Familiar bounds what it admits, such as message and request sizes. It doesn't sandbox plugins, which run with your process's privileges. Treat replies, tool results and fetched pages as untrusted text wherever you render them.

## Where to go next

1. [Your first Familiar](/familiar/build/first-familiar/) runs the real assistant with a scripted model.
2. [Models and sign-in](/familiar/build/models-and-sign-in/) swaps in a real provider.
3. [Serve the API](/familiar/build/serve-the-api/) puts it behind HTTP with your own auth.
4. [Connect a frontend](/familiar/build/connect-a-frontend/) renders it in a browser.
5. [Customise your assistant](/familiar/build/customise/) adds a persona, plugins and tools.
6. [Give Familiars computers](/familiar/build/computers/) adds a browser and a shell in Docker.
7. The [Node server example](/familiar/examples/node-server/) puts all of it together in one runnable app.
