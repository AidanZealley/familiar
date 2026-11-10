# Cloudflare Worker example

A Worker that hosts one Familiar workspace per name, each in its own SQLite-backed Durable Object, with [@familiar-ai/cloudflare](../../packages/cloudflare/README.md). The model is scripted and echoes, so it needs no model key.

From the repository root:

```sh
pnpm install
pnpm --filter @familiar-example/cloudflare-worker dev     # wrangler dev
pnpm --filter @familiar-example/cloudflare-worker build   # A dry-run bundle in dist/
```

Neither needs Cloudflare credentials. For `dev`, put a token in the git-ignored `.dev.vars` as `FAMILIAR_TOKEN=your-local-token`, then send it as `Authorization: Bearer <token>`. Without a configured token, every request is refused.

## How it fits together

- `src/worker.ts` authenticates every request with the bearer token, then forwards `/bots/<name>/api/*` to the Durable Object for that name, with the prefix removed.
- `src/bot.ts` is the Durable Object. `DurableWorkspace` owns its storage, its alarm and recovery after eviction, and its `setup` makes the one Familiar the first time the object opens. The object reaches the workspace only through `use()`, forwards its `alarm()`, and serves Familiar's HTTP API with `createHttpApi`. Everyone the Worker lets through is the owner, so `allow` permits everything; they talk in their DM, from `POST /bots/<name>/api/familiars/<id>/dm`.
- `src/model.ts` is the scripted model. A real host registers its provider and credentials in the `workspace` factory, and delivers notifications where `notify` logs them.

The package's own tests, of reminders with and without eviction, recovery after a reload and termination, run against a separate test Worker in `packages/cloudflare/test`.
