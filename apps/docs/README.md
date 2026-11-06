# Familiar docs

The documentation site, built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build). It publishes to https://aidanzealley.github.io/familiar/ once GitHub Pages is enabled for the repository.

From the repository root:

```sh
pnpm dev:docs     # Dev server, reachable on your LAN and tailnet
pnpm build:docs   # Static site and search index in apps/docs/dist, then a link check
```

The homepage is `src/pages/index.astro`, which composes one component per section from `src/landing/`; documentation pages live in `src/content/docs/`. Code samples longer than a few lines live in `snippets/`, where `pnpm typecheck` checks them against the workspace packages; pages import them with `?raw`. `pnpm test` runs `snippets/first-familiar.ts` as the first guide tells readers to, and checks that the tenants snippet keeps each tenant's conversation to its own members. Internal links include the `/familiar/` base path, and the build fails on any that don't resolve.

The [embedded assistant](src/content/docs/examples/embedded-assistant.mdx) and [shared conversation](src/content/docs/examples/shared-conversation.mdx) pages embed [`examples/embedded-kanban`](../../examples/embedded-kanban/) and [`examples/shared-conversation`](../../examples/shared-conversation/). `pnpm dev:docs` and `pnpm build:docs` first build each into `public/demos/<example>/` with the site's base path. The dev server doesn't serve a folder's `index.html` at the folder URL as GitHub Pages does, so `astro.config.ts` rewrites those URLs in dev.

`src/styles/theme.css` maps the web app's palette and fonts onto Starlight's custom properties.

## Deployment

[`.github/workflows/docs.yml`](../../.github/workflows/docs.yml) builds the site on pull requests and deploys `main` to GitHub Pages. Before the first deploy, set **Settings → Pages → Source** to **GitHub Actions** in the repository.

Starlight's Pagefind dependencies are pinned to 1.5.2 in the workspace configuration because the 1.6 Linux binary crashes on older CPUs. The normal build generates search without a separate binary or environment override.
