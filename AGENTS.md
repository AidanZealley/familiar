# Familiar agent guide

Read the [README](README.md) first. The package READMEs explain responsibilities and public APIs; this file covers how to work in the repo. Uncommitted ideas and links to draft specs are in [docs/ideas.md](docs/ideas.md).

## Hard limits

- Leave `~/.local/share/familiar` alone. It holds the owner's ChatGPT login and real conversation. Tests and demos use their own storage.
- Leave the running service alone: don't run `pnpm service:install`, stop it, or restart it unless the task says to. Only one daemon may own the data directory.
- Don't send messages to the owner's real Familiar (port 4317 or the tailnet address). Use `pnpm dev:demo` where it exists, or tests.
- Don't deploy to Cloudflare or use Cloudflare credentials unless the task says to. `pnpm test:cloudflare` and the Worker's dry-run build need neither.

## Before handing off

Run these from the repo root and fix every failure:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm exec prettier --check .
```

After changing core, `packages/cloudflare` or `apps/cloudflare`, also run `pnpm test:cloudflare`. After changing a package's exports or dependencies, also run `pnpm test:packages`.

## Package boundaries

- Keep Pi behind Familiar's public API. Add capabilities in their own core folders, with owner APIs and HTTP routes where needed.
- Keep Node-only code in `apps/daemon`. Only `packages/cloudflare` may import Workers-only modules. Other packages stay portable.
- Keep UI runtime dependencies on `@familiar-ai/client`. Core owns HTTP wire types; client imports from core and Pi must be type-only.
- Hosts own storage, model credentials, identity, authorization and network policy. One live Familiar owns each storage. Tools must not receive access to the owner's private data directory.

## Working with Pi

- The `@earendil-works/*` packages are pinned to exact versions, once, in the `catalog` of `pnpm-workspace.yaml`, because their API changes between releases. Read the installed version's docs and types, not the GitHub `main` branch: `packages/core/node_modules/@earendil-works/pi-durable/README.md` and its `dist/**/*.d.ts`.
- Test Familiar's behaviour with pi-ai's faux provider, as in [packages/core/src/familiar.test.ts](packages/core/src/familiar.test.ts): a scripted model drives the real harness with `MemoryStorage` and no network. Memory tests live beside their code in `packages/core/src/memory/`.

## Conventions

- TypeScript runs unbuilt: Node strips types and Vite compiles. Use `.ts` extensions in relative imports and erasable syntax only (no enums or parameter properties).
- Prefer `type` over `interface`. Name prop types `ComponentNameProps`.
- Web components follow Gather's layout: `components/<kebab-name>/<PascalName>.tsx`, an `index.ts` re-export, `types.ts` for props, and children under `components/`. One component per file, named `export const`.
- Never edit `apps/web/src/components/ui/`; shadcn owns it. Style with `className`. The UI uses Base UI, so use `render`, not `asChild`.
- Comments explain why, not what.
- Branches are `<prefix>/<name>` (`feat/`, `fix/`, `refactor/`, `docs/`, `chore/`). Commit subjects are plain imperatives like `Add the memory page`, with a body when the reason isn't obvious.
