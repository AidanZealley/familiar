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
pnpm dev
```

This starts a daemon on port 4318 with a scripted model and in-memory storage, and the web app on port 5174. It needs no sign-in and touches no installed assistant's data. Vite accepts LAN and tailnet connections, so you can open it from another device.

The demo opens on Rowan's household: four Familiars with their own tools, memory and schedules, their DMs and named rooms. The story is data in `apps/daemon/src/demo/household/story.ts`. Anything it doesn't script falls back to a scenario: type `tool`, `memory`, `remind`, `key`, `mcp`, `ask`, `slow`, `compact`, `computer`, `login` or `error` in Juniper's DM. Add scenarios under `apps/daemon/src/demo/scenarios/` and register them in `apps/daemon/src/demo/model.ts`.

To see sending's slow and failing states, put `#slow`, `#fail` or `#trouble` in a message. See `apps/daemon/src/demo/trouble.ts`.

:::caution
`pnpm dev:live`, `pnpm start` and `pnpm sign-in` work with the real installed assistant on port 4317 and its data. Use them only when you mean to. Never run a second daemon over the same storage.
:::

## Workspace

| Path                           | What it is                                                     |
| ------------------------------ | -------------------------------------------------------------- |
| `packages/core`                | The assistant. Portable: no Node-only or Workers-only code     |
| `packages/client`              | Browser store and React bindings. Imports only types from core |
| `packages/cloudflare`          | Durable Object adapter. The only Workers-specific package      |
| `packages/computer`            | Familiars' computers, their agent and the Docker host          |
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

The computers' image is tagged with a hash of what goes into it, kept in `packages/computer/image.json`. After changing anything in the image, run `pnpm image` and commit `image.json`; a test fails while it's out of date. To rebuild with nothing changed, such as for security updates, change `IMAGE_REFRESH` in the Dockerfile.

Test the real harness with the faux provider or `scriptedModels`, not model requests. `pnpm eval:recall` and `pnpm eval:unfiled` check memory retrieval without a model; `pnpm eval:memory-scenarios` and `pnpm eval:longmem` run memory on real models.

## The docs site

```sh
pnpm dev:docs
```

Pages are Markdown and MDX under `apps/docs/src/content/docs/`. Code samples longer than a few lines live in `apps/docs/snippets/` and are type-checked by `pnpm typecheck`. Internal links include the `/familiar/` base path.

Pushes to `main` that change the docs or packages deploy the site to GitHub Pages through `.github/workflows/docs.yml`.

## Releases

Pushing a `v*` tag runs the [publish workflow](https://github.com/AidanZealley/familiar/blob/main/.github/workflows/publish.yml): it publishes the npm packages, the installable assistant and, if its key is new, the computers' image. Tags with a `-`, such as `v0.5.0-rc.1`, publish a prerelease and npm's `next` tag.

Every push to `main` replaces `familiar.tgz` in the rolling `main-build` prerelease and publishes nothing to npm. `FAMILIAR_VERSION=main` installs it.

`pnpm bundle` builds the installable tarball locally, and `pnpm test:release` checks it with temporary storage.
