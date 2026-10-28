# Reminders and push

Familiar should be able to reach the owner on its own. "Remind me at 6 to call Mum" should produce a notification at 6, even with the app closed, and "every weekday at 7, brief me on my day" should work the same way. Start after [memory upkeep](memory-upkeep.md), whose durable scheduled task is the pattern to follow.

Known decisions:

- **One primitive: a schedule.** A schedule is a prompt and a time, once or repeating. When it's due, the prompt is sent to the conversation as a scheduled input, Familiar replies as it would to any message, and the reply is pushed. A reminder is just a schedule whose prompt is "remind the owner to call Mum". There is no separate fixed-message path.
- **The prompt is also the fallback.** If the reply fails (model unreachable, usage limit), the push carries the prompt itself, so a reminder is never lost.
- **Schedules run in the main conversation**, so the owner can answer them ("snooze 10 minutes") like any message.
- **The `Schedules` document is the source of truth.** Each schedule also has one durable task that sleeps until its next time (pi-durable README, "Sleeping and Waking Up"). A task that wakes and finds its schedule gone finishes without doing anything, so cancelling is removing the schedule from the document. Aborting the task as well is tidy, but nothing depends on it.
- **Times are local**, in the host's time zone, like every date Familiar writes (`time/`). Repeats are RFC 5545 RRULEs (`FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=7;BYMINUTE=0`), which models write reliably and calendars will use too. Use the `rrule` package for the next occurrence if it handles local time correctly; check this with a test across a daylight saving change before relying on it.
- **Notifications use Web Push**, with VAPID keys and the `web-push` npm package. Subscriptions and VAPID keys belong to the host: the daemon stores them in its data directory, while core only asks the host to notify (a `notify` option on `summonFamiliar`), so a Cloudflare host can deliver its own way.
- **HTTPS is required.** Use the tailnet address (port 10000), not plain HTTP.

Do the steps in order and commit each separately.

## 1. Schedules in core

A new capability folder, `packages/core/src/schedules/`, installed by `familiar.ts`.

1. **The document.** `Schedules`, a map of schedule ID to `{ id, prompt, at?: number, repeat?: string, next: number, created: number }`. `at` is a one-off time; `repeat` is an RRULE whose start is the creation time. Exactly one of them is set. `next` is the next due time, kept by the rules in this folder.
2. **The task.** `familiar.schedule`, one per schedule, input `{ id }`, created in the same commit as the schedule. It sleeps until the schedule's `next`. On waking it reads the document and finishes if the schedule is gone. Otherwise, in the next phase, it submits the scheduled input, waits for it to settle (as upkeep's `ask` does), and calls `notify` with the reply, or with the prompt if the run didn't finish. Then, in one commit, it either removes a one-off schedule and finishes, or advances a repeat's `next` and sleeps until it.
3. **The scheduled input.** Submitted with entry kind `familiar.scheduled`, data `{ scheduleId, prompt, due }`, and request ID `schedule:<id>:<due>`, so a rerun after a restart submits it once. Its content tells the model what it is: `[Scheduled for <local minute>] <prompt>`. If the conversation is busy, it queues like any message.
4. **Late wake-ups.** If the host was down past `next`, deliver once on wake, with the content saying it's late (`[Scheduled for 18:00, delivered 21:14]`). A repeat that missed several occurrences delivers only the latest and continues from the following one; there is never a backlog.
5. **Tools.** `schedule` (`prompt`, and `at` as local `YYYY-MM-DD HH:MM` or `repeat` as an RRULE with a time), `list_schedules`, and `cancel_schedule` (by ID). Editing is cancel then schedule. `schedule`'s result states the resolved local time (and for repeats, the next three) so a misread time is visible in the reply. Its description says to use it for reminders, and to write the prompt as an instruction to Familiar's future self ("Remind Aidan to call Mum"), not as the reminder text.
6. **A section** explaining scheduled inputs: they were set up earlier, often by the owner; carry them out and address the owner directly; the owner may reply to them. The section must not change between requests.
7. **Transcript readers.** `saidBy` (conversation/message.ts) treats `familiar.scheduled` entries as their own role, so memory upkeep's transcript shows them as `(scheduled) <prompt>` rather than dropping them or attributing them to the owner.
8. **Owner API and routes.** `familiar.schedules.cancel(id)`, and `DELETE /api/schedules/:id`. Add `schedules` to `Documents` in `http.ts` so clients mirror it.

Tests, with the faux provider and a fake clock:

- A one-off schedule submits its input at its time, the faux model's reply reaches `notify`, and the schedule is removed.
- A weekday RRULE at 07:00 fires Friday then Monday, not at the weekend.
- A failed run notifies with the prompt.
- Cancelling before the time means no input and no notify.
- Close and reopen before the time: it fires once, at the right time. Close and reopen while waiting for the reply: one input, one notify.
- A wake-up three days late on a daily repeat delivers once, marked late, and the next is tomorrow.
- A repeat across a daylight saving change stays at the same local time.

Done when every test passes and the README's Layout lists `core/schedules`.

## 2. Push in the daemon

1. **Core's contract.** `notify?: (notification: { title: string; body: string; url?: string }) => Promise<void>` on `FamiliarOptions`. Without it, schedules still post to the conversation. The title is Familiar's name; the body is the reply cut to about 180 characters at a word boundary.
2. **Core's routes**, so the wire contract stays in `http.ts`: `GET /api/push/key` (the VAPID public key), `POST /api/push/subscriptions` and `DELETE /api/push/subscriptions` (a `PushSubscription` as JSON). They call a `push` option on `HttpOptions` that the host provides; without it they return 404.
3. **The daemon's implementation**, in `apps/daemon/src/push.ts`: VAPID keys generated once into `vapid.json` and subscriptions in `push.json`, both in the data directory with mode 0600. `notify` sends to every subscription and removes those the push service answers with 404 or 410.
4. **The demo** logs notifications instead of sending them, and adds a `remind` word that schedules a reminder one minute ahead, so the whole loop can be seen without waiting.

Done when a test covers the routes against a fake `push` option, and the demo's `remind` produces a logged notification a minute later.

## 3. The web app

1. **A service worker** with a `push` handler that shows the notification and a `notificationclick` handler that focuses or opens the app at `url` (default `/`).
2. **An Enable notifications button**, in the header's menu or a settings page. It asks for permission only from the button press, as iOS requires, then subscribes and posts the subscription. It shows the current state: unsupported, not enabled, enabled, or blocked.
3. **Scheduled inputs in the chat** render as a small centred line (`Scheduled · Remind Aidan to call Mum`), not as the owner's message. Add the item to `toTranscript()` in `@familiar/client`.
4. **A Schedules list**: a page or a section of an existing one, showing each schedule's prompt and next time (and repeat, in words), with a cancel button. It reads the mirrored `schedules` document.

Testing notes for the owner's devices:

- **iPhone:** works only from the home-screen app, iOS 16.4 or later.
- **Brave on macOS:** turn on "Use Google services for push messaging" in `brave://settings/privacy`, and allow Brave in System Settings → Notifications.

Done when, on the demo, a reminder set in chat appears in the Schedules list, its scheduled line and reply appear in the chat at the due time, a notification arrives on a subscribed browser, and cancelling from the list removes it.

## Out of scope

- Pushing ordinary replies when the app is closed.
- Snooze buttons in the notification. Replying in chat covers it for now.
- Schedules that run somewhere other than the main conversation.
