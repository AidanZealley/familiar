# Reminders and push

Familiar should be able to reach the owner on its own: "remind me at 6 to call Mum" should produce a notification at 6, even with the app closed. Start after [memory upkeep](memory-upkeep.md), whose durable scheduled task is the pattern to follow.

Known decisions:

- **Reminders are durable tasks** that sleep until their time (pi-durable README, "Sleeping and Waking Up"), so they survive restarts. A `remind` tool creates one; tools to list and cancel reminders keep it manageable. At the due time, the reminder writes a message into the conversation from Familiar and sends a push notification.
- **Notifications use Web Push**, with VAPID keys and the `web-push` npm package. Subscriptions and VAPID keys belong to the host: the daemon stores them in its data directory, while core only asks the host to notify (a `notify` option on `summonFamiliar`), so a Cloudflare host can deliver its own way.
- **The web app** registers a service worker with a `push` handler, and asks for permission only from a button press, as iOS requires.
- **HTTPS is required.** Use the tailnet address (port 10000), not plain HTTP.

Testing notes for the owner's devices:

- **iPhone:** works only from the home-screen app, iOS 16.4 or later.
- **Brave on macOS:** turn on "Use Google services for push messaging" in `brave://settings/privacy`, and allow Brave in System Settings → Notifications.

Write the full spec before implementing: steps, tests (faux provider and fake clock, as in memory upkeep) and completion conditions.
