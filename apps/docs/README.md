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

Pagefind's 1.6 binary needs a CPU with AVX2. On older machines the search index step fails, and the link check reports it. Point `PAGEFIND_EXTENDED_BINARY_PATH` at an older Pagefind binary to build locally.
