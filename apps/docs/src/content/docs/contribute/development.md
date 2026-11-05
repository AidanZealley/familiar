---
title: Development
description: Set up the workspace, run the disposable demo, run checks and cut releases.
---

## Set up

Use Node 24.19 or newer and the pnpm version in the root `package.json`:

```sh
git clone https://github.com/AidanZealley/familiar.git
cd familiar
pnpm install
```

## Run the demo

```sh
pnpm dev:demo
```

This starts a daemon on port 4318 with a scripted model and in-memory storage, and the web app on port 5174. It needs no sign-in and touches no installed assistant's data. Vite accepts LAN and tailnet connections, so you can open it from another device.

Type one of these words in the chat to run a scripted scenario: `tool`, `memory`, `remind`, `key`, `mcp`, `slow`, `compact` or `error`. Only the model and external services are simulated. Add scenarios under `apps/daemon/src/demo/scenarios/` and register them in `apps/daemon/src/demo/model.ts`.

:::caution
`pnpm dev`, `pnpm dev:web`, `pnpm start` and `pnpm sign-in` work with the real installed assistant on port 4317 and its data. Use them only when you mean to. Never run a second daemon over the same storage.
:::

## Workspace

| Path                           | What it is                                                     |
| ------------------------------ | -------------------------------------------------------------- |
| `packages/core`                | The assistant. Portable: no Node-only or Workers-only code     |
| `packages/client`              | Browser store and React bindings. Imports only types from core |
| `packages/cloudflare`          | Durable Object adapter. The only Workers-specific package      |
| `apps/daemon`                  | The installed Node host, CLI and demo                          |
| `apps/web`                     | The web UI                                                     |
| `apps/docs`                    | This site                                                      |
| `examples/embedded-kanban`     | Task board with Familiar embedded. Built into this site        |
| `examples/shared-conversation` | Several people sharing one Familiar. Built into this site      |
| `examples/cloudflare-worker`   | A Worker hosting Familiar on Durable Objects                   |

Workspace packages import each other's TypeScript source. Published packages ship compiled `dist` files, which `pnpm build:packages` builds. ESLint enforces the portability rules.

## Checks

Before you open a pull request:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm exec prettier --check .
```

Also run:

- `pnpm test:cloudflare` for core or Cloudflare changes. Tests run in workerd and need no Cloudflare account.
- `pnpm test:packages` for package exports or dependencies. It packs the libraries and installs them outside the workspace.
- `pnpm build:docs` for documentation changes. It builds this site and fails on broken internal links.

Use the faux provider, or `scriptedModels` for a script that answers every request, to test the real harness without model requests. `pnpm eval:recall` and `pnpm eval:unfiled` check memory retrieval without a model.

## The docs site

```sh
pnpm dev:docs
```

Pages are Markdown and MDX under `apps/docs/src/content/docs/`. Code samples longer than a few lines live in `apps/docs/snippets/` and are type-checked by `pnpm typecheck`. Internal links include the `/familiar/` base path.

Pushes to `main` that change the docs or packages deploy the site to GitHub Pages through `.github/workflows/docs.yml`.

## Releases

Pushing a `v*` tag runs the [release workflow](https://github.com/AidanZealley/familiar/blob/main/.github/workflows/release.yml). It publishes the npm packages and the installable assistant. `pnpm bundle` builds the installable tarball locally, and `pnpm test:release` checks it with temporary storage.
