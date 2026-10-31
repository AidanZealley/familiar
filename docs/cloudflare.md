# Familiar on Cloudflare

`@familiar/cloudflare` runs one Familiar in one SQLite-backed Durable Object. `apps/cloudflare` is a development Worker that uses it, with a scripted model, so it needs no model key.

## Using the adapter

A host writes its own Durable Object class and gives it a `DurableFamiliar`. The host chooses the models, zone, plugins, notifications, network, secrets and who a request comes from. The adapter owns storage, alarms and termination.

```ts
import { DurableObject } from 'cloudflare:workers'
import { DurableFamiliar, FamiliarTerminated } from '@familiar/cloudflare'
import { createHttpApi } from '@familiar/core/http'

export class Bot extends DurableObject<Env> {
  readonly familiar = new DurableFamiliar(this.ctx, {
    familiar: () => ({
      models: createModels(this.env),
      model: { provider: 'openai', modelId: 'gpt-6.1-sol' },
      timeZone: 'Europe/London',
      notify: (notification) => push(this.env, notification),
    }),
  })

  override async fetch(request: Request) {
    try {
      return await this.familiar.use((familiar) =>
        createHttpApi(familiar, { authenticate: whoSent }).fetch(request),
      )
    } catch (error) {
      if (error instanceof FamiliarTerminated) {
        return new Response(null, { status: 410 })
      }
      throw error
    }
  }

  override alarm() {
    return this.familiar.alarm()
  }

  terminate() {
    return this.familiar.terminate()
  }
}
```

The Durable Object must be in a `new_sqlite_classes` migration. Its names map to Familiars one to one: `idFromName(owner)` opens that owner's Familiar.

- `use(work)` is the only way to reach the Familiar. It arms a recovery alarm, then runs `work`. Anything the host does with the Familiar, a message or a schedule change, can start work, so all of it goes through `use`. Don't cache or return the Familiar, or start later work through a retained reference. Every later operation must re-enter `use()`. Don't call `dismiss()` there; `terminate()` owns closing.
- `alarm()` is the object's alarm handler.
- `terminate()` ends the Familiar for good. See [Termination](#termination).
- `status()` reports `open` or `terminated`, the armed alarm and what the Familiar says it needs, without arming anything. Like any call, it starts an object that isn't running.
- `heartbeatMs` (default one minute) is how soon an object restarts work a lost process left.

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

**Opening.** The constructor opens inside `blockConcurrencyWhile`, so nothing reaches the object until it's done. A terminated object opens nothing and deletes its alarm. Otherwise it arms a fallback alarm one heartbeat ahead, then summons the Familiar. Summoning resumes work before it returns, so the fallback stands until it does; Pi's wake reports during opening are ignored. Once open, the alarm follows `wake()`. If opening throws, Cloudflare resets the object and the fallback starts it again. A deterministic configuration error retries indefinitely at the heartbeat interval until the configuration is fixed. Pi’s task restart limit does not cover startup failures.

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
pnpm --filter @familiar/cloudflare-dev build      # wrangler deploy --dry-run into apps/cloudflare/dist
pnpm --filter @familiar/cloudflare-dev dev        # wrangler dev; needs apps/cloudflare/.dev.vars
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

Local eviction waits for in-flight work to finish, so the tests interrupt work by reloading the Worker instead. Neither shows what production does under memory pressure, a crash or Cloudflare moving an object. That needs the live checks below.

## Deploying the development Worker

The development Worker was deployed on 31 October 2026 at `https://familiar-dev.aidanzealley.workers.dev`. It requires the development bearer token. Deploying this example creates:

- a Worker named `familiar-dev` on `familiar-dev.<account subdomain>.workers.dev`
- two SQLite Durable Object classes, `Bot` and `Outbox`, from migration `v1`
- one secret, `FAMILIAR_DEV_TOKEN`

No KV, D1 or R2. The bundle is about 515 KB gzipped. SQLite Durable Objects are available on the free plan. If the account already has a Worker named `familiar-dev`, deploying replaces it, so check first or change `name` in `wrangler.jsonc`.

Wrangler needs a login with Workers Scripts edit permission on the account: `wrangler login`, or an API token from the "Edit Cloudflare Workers" template in `CLOUDFLARE_API_TOKEN`. Set `CLOUDFLARE_ACCOUNT_ID` if the login reaches more than one account.

```sh
cd apps/cloudflare
pnpm exec wrangler deploy
pnpm exec wrangler secret put FAMILIAR_DEV_TOKEN   # prompts; never put it in a file or a command
```

## Live checks

These need a deployed Worker. Use a random hex or base64url value for `FAMILIAR_DEV_TOKEN`; bearer authentication rejects other punctuation. Keep it out of shell history and chat.

```sh
URL=https://familiar-dev.<account subdomain>.workers.dev
read -rs TOKEN                                  # paste the token
auth=(-H "Authorization: Bearer $TOKEN")
send() { curl -s "${auth[@]}" -H 'content-type: application/json' \
  -d "{\"text\":\"$2\",\"requestId\":\"$(uuidgen)\"}" "$URL/bots/$1/api/messages" -w '%{http_code}\n'; }
replies() { curl -s "${auth[@]}" "$URL/bots/$1/api/history?before=9007199254740991"; }
```

1. **Authentication.** `curl -i $URL/bots/smoke-a/status` answers 401, and so does a wrong token.
2. **Chat.** `send smoke-a hello` answers 202. `replies smoke-a` shows `You said: hello`. `curl -s "${auth[@]}" $URL/bots/smoke-a/status` shows `wake.active: false` and an alarm at the next 04:00 London time.
3. **Isolation.** `send smoke-b other`, then `replies smoke-a` has no `other`.
4. **A reminder after inactivity.** `send smoke-r "remind $(TZ=Europe/London date -d '+5 min' '+%Y-%m-%d %H:%M') stretch"`. Touch nothing for ten minutes, as an inactivity check. This does not establish that Cloudflare evicted the object; eviction timing is controlled by the platform. Then `curl -s "${auth[@]}" $URL/bots/smoke-r/notifications` shows `Reminder: stretch`, at about the time asked. The notifications route doesn't start the bot.
5. **Interrupted work.** `send smoke-i slow`, and within two seconds run `pnpm exec wrangler deploy` again. Touch nothing for two minutes. `replies smoke-i` shows an `aborted` reply, then the full reply, timestamped after the deploy.
6. **Termination.** `curl -s "${auth[@]}" -X POST $URL/bots/smoke-a/terminate` answers 204. `send smoke-a again` answers 410, and `status` shows `terminated` with no alarm. After another deploy, both still hold.

### Live validation on 31 October 2026

Validated against `familiar-dev.aidanzealley.workers.dev`, deployment `88462fbe-682a-49f6-a16c-ad3ec05d37c8`, using only the scripted model:

- Missing or incorrect bearer tokens returned 401. A request over the 64 KiB body limit returned 413.
- Two named bots returned their own replies without sharing conversation entries. An idle bot reported upkeep at 04:00 London time.
- A reminder scheduled for 21:45 London time arrived in its separate outbox at 21:45:00.772. The bot received no requests for almost six minutes before delivery, and the Worker was redeployed during that interval. This proves background alarm delivery across inactivity and deployment, not production memory-pressure eviction.
- Terminated bots returned 410 and had no alarm, including after a subsequent deployment.
- A slow reply completed gracefully during deployment. Forced interruption and alarm-driven generation recovery remain verified locally by Worker reload, but unproven in the live environment.

All four disposable test bots were terminated after verification. Their history remains stored; they have no scheduled alarms. The Worker remains deployed and authenticated for further testing. Real-model access, ChatGPT sign-in and production crash or memory-pressure recovery are not verified.
