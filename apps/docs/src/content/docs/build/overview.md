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

A host opens one workspace over one storage, and makes its Familiars and rooms on the first open. It supplies:

- **Storage.** `MemoryStorage` for tests, Pi Durable's SQLite storage on Node, or a Durable Object on Workers. Only one live workspace may own a storage at a time.
- **Models and credentials.** A `Models` instance with providers registered and a credential store. See [Models and sign-in](/familiar/build/models-and-sign-in/).
- **Time zone.** An IANA zone such as `Europe/London`. Memory's dates and nightly tidy, and schedules, use it.
- **Identity.** Who sent each message. Familiar records an `Author` with a stable `id` and a display `name`. It doesn't authenticate anyone.
- **Audience.** Which rooms each person reaches: a DM each with a Familiar, named rooms shared by a group, or both. Everyone a Familiar serves shares what it remembers, its tools and its schedules, so separate audiences, such as tenants, get separate workspaces over separate storage.
- **Authorization.** Which operations each person may use, with `createHttpApi`'s `allow`, and narrower rules about your app's data and actions, which tools check against the call's author, `familiar(context).author()`. Attribution grants nothing.
- **Network policy.** Tools' `fetch`. On Node it defaults to one that refuses private addresses, and in Workers and browsers to the runtime's. Pass your own to change that. Also the MCP transports, `mcpFetch` and `mcpStdio`, which decide what MCP servers may reach or run. Familiar only checks an MCP server's shape.
- **Notifications.** An optional `notify` for scheduled replies. Your host chooses who receives each one, and stores and authorizes any Web Push subscriptions.
- **Browser protection.** Cross-site request protection if you authenticate browsers with cookies, and your pages' own framing and content policies. `createHttpApi` adds neither.

## What Familiar owns

Familiar owns the rooms and everything its Familiars do in the background: whose turn a message is, replies, tool calls, memory filing, schedules and recovery after a crash. Pi Durable runs that work and commits each change to storage. The HTTP adapter streams those commits, and the client mirrors them. Your UI renders the client's state and sends commands. It never edits state directly.

Several people can share one Familiar, in a named room or each in their own DM. Each message keeps its author, and tools can see who started a turn. A Familiar keeps one working context across its rooms, so they also share what it knows, every tool and every schedule. A host that serves separate audiences opens one workspace for each. See [Serve the API](/familiar/build/serve-the-api/#a-familiar-is-shared).

Familiar bounds what it admits: request bodies, message and schedule sizes, how often a repeat runs and how many schedules it keeps. It doesn't sandbox tools. Plugins are code you install, trusted like any other dependency, and they run with your process's privileges. Replies, tool results and fetched pages are untrusted text, so sanitise them wherever you render them.

## Where to go next

1. [Your first Familiar](/familiar/build/first-familiar/) runs the real assistant with a scripted model.
2. [Models and sign-in](/familiar/build/models-and-sign-in/) swaps in a real provider.
3. [Serve the API](/familiar/build/serve-the-api/) puts it behind HTTP with your own auth.
4. [Connect a frontend](/familiar/build/connect-a-frontend/) renders it in a browser.
5. [Customise your assistant](/familiar/build/customise/) adds a persona, plugins and tools.
6. The [Node server example](/familiar/examples/node-server/) puts all of it together in one runnable app.
