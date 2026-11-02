# Cloudflare development Worker

A test host for [@familiar-ai/cloudflare](../../packages/cloudflare/README.md). Named bots use scripted models, SQLite Durable Objects and a separate notification outbox. This is not the installed personal assistant and does not prove real-model or ChatGPT sign-in support on Workers.

From the repository root:

```sh
pnpm test:cloudflare
pnpm --filter @familiar-ai/cloudflare-dev build
```

Tests run in workerd; the build is a Wrangler dry run. Neither needs Cloudflare credentials or deployment.

For interactive local work, run `pnpm --filter @familiar-ai/cloudflare-dev dev`. Configure a disposable `FAMILIAR_DEV_TOKEN` as described in [Cloudflare notes](../../docs/cloudflare.md#the-development-worker). `src/worker.ts` owns request authentication and routing; `src/bot.ts` connects each object to the adapter. Do not deploy or use account credentials without explicit authorization.
