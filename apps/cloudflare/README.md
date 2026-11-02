# Cloudflare development Worker

A test host for [@familiar-ai/cloudflare](../../packages/cloudflare/README.md). Named bots use scripted models, SQLite Durable Objects and a separate notification outbox. This is not the installed personal assistant and does not prove real-model or ChatGPT sign-in support on Workers.

From the repository root:

```sh
pnpm test:cloudflare
pnpm --filter @familiar-ai/cloudflare-dev build
```

Tests run in workerd; the build is a Wrangler dry run. Neither needs Cloudflare credentials or deployment.

For interactive local work, run `pnpm --filter @familiar-ai/cloudflare-dev dev`. Put a local test token in the git-ignored `apps/cloudflare/.dev.vars` as `FAMILIAR_DEV_TOKEN=your-local-test-token`. `src/worker.ts` owns request authentication and routing; `src/bot.ts` connects each object to the adapter. Do not deploy or use account credentials without explicit authorization.

Every request needs `Authorization: Bearer <FAMILIAR_DEV_TOKEN>`. The Worker refuses all requests when the token is unset. `/bots/<name>/api/*` serves Familiar; `/bots/<name>/status` reports lifecycle state and `/bots/<name>/notifications` reads the notification outbox. `POST /bots/<name>/terminate` permanently closes that bot name while retaining history.

The model echoes messages. `slow` streams a long reply; `remind YYYY-MM-DD HH:MM <prompt>` schedules work in Europe/London time. Each name has its own storage.
