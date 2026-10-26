# Roadmap

Familiar is a personal assistant in the spirit of Grok Bot, Meta's Muse and OpenAI's dots: always on, reachable from the owner's devices, remembering them over time, and eventually acting on its own. It is also meant to be embedded: another app (first, the owner's household app Gather) can host its own Familiar alongside itself, for example one per household in a Cloudflare Durable Object. Keep that second use possible in every change; the README's Rules say how.

## Done

- **Core and hosts.** One durable conversation over Pi Durable; the HTTP + SSE API; the client store; the web UI.
- **Always on.** A systemd user service serves the API and UI on `127.0.0.1:4317`, published tailnet-only over HTTPS on port 10000. The home-screen manifest is in place.
- **Memory.** A fact list the model keeps with `remember`, `revise_memory` and `forget` and sees on every request; `search_history` over the full transcript; a Memory page for corrections.
- [Memory upkeep](specs/memory-upkeep.md): a 64k context budget, a hard cap on the fact list, and nightly consolidation.
- [Chat UI](specs/chat-ui.md): shadcn's chat components, streamed Markdown, and `pnpm dev:demo`.

## Next

Pick these up in order unless the owner says otherwise. Each spec is complete enough to implement without earlier conversation.

1. [Chat history](specs/chat-history.md): scroll back past compactions, a Stopped marker, and a smaller first load.
2. **Long-term memory, revised.** The fact list is capped small and pushes the model to forget, which suits a working set but not years of knowledge. Redesign as tiers (always-present core memory, a searchable archive that is never silently lost, episodic summaries), and spec it before building.
3. [Reminders and push](specs/reminders-and-push.md): a `remind` tool and Web Push notifications to the home-screen app.

## Later

Not specified yet. Write a spec before starting one.

- **Full-text history search.** `search_history` scans the transcript linearly, which will slow down after years of use. Use an SQLite FTS index in the same database.
- **Real-world tools.** Web search and fetch first, then calendar and email. Each tool that touches files or a shell must run in an environment that cannot see the data directory.
- **Gatherbot.** A Cloudflare host for `@familiar/core`: one Durable Object per household, Gather's auth deciding who reaches which object, an API key instead of a subscription. The open question is which Convex identity the bot acts as when no member is present.
- **Native app.** Another client of the same API, reusing `@familiar/client`; APNs instead of Web Push.
- **The real logo.** A cat. Replace `apps/web/public/icon.svg` and run `pnpm --filter @familiar/web icons`.
