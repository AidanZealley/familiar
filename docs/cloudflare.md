# Familiar on Cloudflare

`@familiar-ai/cloudflare` runs one Familiar in one SQLite-backed Durable Object. `apps/cloudflare` is a development Worker that uses it, with a scripted model, so it needs no model key.

See the [package README](../packages/cloudflare/README.md) for installation and an adapter example, and the [Worker README](../apps/cloudflare/README.md) for local commands. This page explains recovery and records validation limits.

## Who owns what

| State or job                                    | Owner                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation, tasks, sleeps, recovery           | Pi, in the object's SQLite under the `pi_` prefix                                                                                           |
| When the object next needs to run (`Wake`)      | Pi's scheduler, read through `familiar.wake()` and `onWake`                                                                                 |
| The alarm                                       | `DurableFamiliar`. One writer, through the database queue Pi's commits use, so writes land in order and a rolled-back commit can't undo one |
| Open, opening or terminated                     | `DurableFamiliar`'s one runtime value, and the `familiar_terminated` table once terminated                                                  |
| Running one object at a time, starting it again | Cloudflare                                                                                                                                  |
| Models, credentials, zone, plugins, notify      | The host's `familiar()` options                                                                                                             |
| Who sent a request                              | The host                                                                                                                                    |

Core also exposes `familiar.closed`, which settles on dismissal or storage failure. A storage failure resets the object while leaving its recovery alarm armed, so a new instance can reopen persisted work.

Core knows nothing about Cloudflare. Its scheduling contract has three things any evictable host needs, all thin passthroughs to Pi's own wake API: the `onWake` option, `familiar.wake()` and `familiar.resume()`. With `onWake`, Pi arms no timer for sleeping work. Without it, as in the daemon, Pi's timer runs sleeping work as before. ESLint keeps `cloudflare:*` and Pi's Cloudflare modules out of every other package.

## Lifecycle

**Opening.** The constructor opens inside `blockConcurrencyWhile`, so nothing reaches the object until it's done. A terminated object opens nothing and deletes its alarm. Otherwise it arms a fallback alarm one heartbeat ahead, then summons the Familiar. Summoning resumes work before it returns, so the fallback stands until it does; Pi's wake reports during opening are ignored. Once open, the alarm follows `wake()`. If opening throws, Cloudflare resets the object and the fallback starts it again. A deterministic configuration error retries indefinitely at the heartbeat interval until the configuration is fixed. Pi's task restart limit does not cover startup failures.

**The alarm.** While work can run, the alarm is a heartbeat, never later than the earliest sleep. Idle, it's the earliest sleep: a reminder, or upkeep's 04:00 pass. With neither, there's no alarm. Pi reports changes through `onWake`. When the alarm fires, the adapter arms a heartbeat, resumes, then arms from `wake()` again, because Pi only reports changes and the heartbeat wasn't one. A failed alarm write resets the object, which arms again when it starts.

**Requests.** `use` arms a heartbeat before running the host's code, so work a request starts survives the process dying straight after. A request that started nothing costs one early alarm, which settles back to the real wake.

### Termination

`terminate()` sets the runtime to terminated, so every later `use` throws `FamiliarTerminated` and any late alarm write becomes a delete. It then records the termination and deletes the alarm in one transaction, aborts the current run (withdrawing queued messages), and closes the Familiar. If recording fails, the object resets and stays open.

The record outlives every restart: a stale request, an alarm or a new instance finds it and opens nothing. A terminated name can't be reused; the host picks a new one. History stays in storage. Deleting it is a separate, permanent step this adapter doesn't offer. A host that adds one must keep the `familiar_terminated` row, or the name opens again empty.

## The development Worker

`apps/cloudflare` serves one Familiar per name. Every route needs `Authorization: Bearer <FAMILIAR_DEV_TOKEN>`; without the secret, it refuses everything.

| Route                            | Does                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `/bots/<name>/api/*`             | Familiar's HTTP API, as the daemon serves it         |
| `GET /bots/<name>/status`        | The adapter's `status()`                             |
| `GET /bots/<name>/notifications` | What the bot's `notify` sent, from a separate object |
| `POST /bots/<name>/terminate`    | `terminate()`                                        |

The scripted model echoes messages. `remind YYYY-MM-DD HH:MM <prompt>` schedules a reminder in Europe/London time, and `slow` streams a long reply. Notifications go to an `Outbox` object per bot, so checking them never starts the bot.

```sh
pnpm test:cloudflare                              # the Worker in workerd, about 90 seconds
pnpm --filter @familiar-ai/cloudflare-dev build      # wrangler deploy --dry-run into apps/cloudflare/dist
pnpm --filter @familiar-ai/cloudflare-dev dev        # wrangler dev; needs apps/cloudflare/.dev.vars
```

For `wrangler dev`, put a token of your own in `apps/cloudflare/.dev.vars` as `FAMILIAR_DEV_TOKEN=...`. Git ignores the file.

The tests use Wrangler's `createTestHarness`, which runs the Worker from `wrangler.jsonc` in workerd under the repo's Vitest. They prove, in the real runtime:

- the token gates every route, and a missing secret refuses everything
- a new bot's alarm is upkeep's 04:00 once idle
- two names have separate conversations
- a reminder fires from its alarm after the object is evicted, without anything touching the bot
- a reply cut off by a reload, as a deploy does, streams again from the heartbeat alarm before anything touches the bot
- a terminated bot refuses requests across eviction, keeps its history and has no alarm
- termination wins over messages racing it

Node tests beside the adapter cover what workerd can't be made to do on cue: a failing alarm write, and writes queued behind a commit in progress. Core's tests check `onWake` with a fake clock and that the daemon's timers still run schedules.

Local eviction waits for in-flight work to finish, so the tests interrupt work by reloading the Worker instead. Neither shows what production does under memory pressure, a crash or Cloudflare moving an object. The validation notes below distinguish those limits.

## Validation limits

Local workerd tests cover authentication, bot isolation, scheduled delivery, reload recovery and permanent termination. Run `pnpm test:cloudflare` without credentials or deployment.

A scripted-model live check on 31 October 2026 verified authentication, isolated conversations, reminder delivery across inactivity and redeployment, and termination surviving deployment. It did not establish memory-pressure eviction or forced-interruption recovery in production. Real-model access, ChatGPT sign-in and MCP on Workers remain unverified.

Deploying changes account resources and may replace an existing Worker. It is outside ordinary development checks and requires explicit authorization. Do not use Cloudflare credentials just to run tests or a dry-run build.
