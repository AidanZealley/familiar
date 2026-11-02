# Familiar docs

The documentation site, built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build). It publishes to https://aidanzealley.github.io/familiar/ once GitHub Pages is enabled for the repository.

From the repository root:

```sh
pnpm dev:docs     # Dev server, reachable on your LAN and tailnet
pnpm build:docs   # Static site and search index in apps/docs/dist, then a link check
```

Pages live in `src/content/docs/`. Code samples longer than a few lines live in `snippets/`, where `pnpm typecheck` checks them against the workspace packages; pages import them with `?raw`. `snippets/first-familiar.ts` also runs in `pnpm test`. Internal links include the `/familiar/` base path, and the build fails on any that don't resolve.

`src/styles/theme.css` maps the web app's palette and fonts onto Starlight's custom properties.

## Deployment

[`.github/workflows/docs.yml`](../../.github/workflows/docs.yml) builds the site on pull requests and deploys `main` to GitHub Pages. Before the first deploy, set **Settings → Pages → Source** to **GitHub Actions** in the repository.

Starlight's Pagefind dependencies are pinned to 1.5.2 in the workspace configuration because the 1.6 Linux binary crashes on older CPUs. The normal build generates search without a separate binary or environment override.
