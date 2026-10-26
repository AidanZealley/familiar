# Roadmap

Familiar is a personal assistant in the spirit of Grok Bot, Meta's Muse and OpenAI's dots: always on, reachable from the owner's devices, remembering them over time, and eventually acting on its own. It is also meant to be embedded: another app (first, the owner's household app Gather) can host its own Familiar alongside itself, for example one per household in a Cloudflare Durable Object. Keep that second use possible in every change; the README's Rules say how.

## Done

- **Core and hosts.** One durable conversation over Pi Durable; the HTTP + SSE API; the client store; the web UI.
- **Always on.** A systemd user service serves the API and UI on `127.0.0.1:4317`, published tailnet-only over HTTPS on port 10000. The home-screen manifest is in place.
- **Memory.** A fact list the model keeps with `remember`, `revise_memory` and `forget` and sees on every request; `search_history` over the full transcript; a Memory page for corrections.
- [Memory upkeep](specs/memory-upkeep.md): a 64k context budget, a hard cap on the fact list, and nightly consolidation.
- [Chat UI](specs/chat-ui.md): shadcn's chat components, streamed Markdown, and `pnpm dev:demo`.
- [Chat history](specs/chat-history.md): scrolling back past compactions, a Stopped marker, and a lazily loaded Markdown renderer.

## Next

Pick these up in order unless the owner says otherwise. Each spec is complete enough to implement without earlier conversation.

1. [Long-term memory](specs/long-term-memory.md): step 1 (the evaluation) is done and the [core restructure](specs/core-structure.md) it builds on is merged. The judge now checks extra details against the scenario's text and is pinned apart from the model under test. Graded again, the v2 baseline is 23 of 25 (`eval/results/2026-10-26-19cdb67.rejudged.json`), too easy to show any improvement. **Before step 2, record a baseline on a harder scenario (v3)** that overflows the fact list's character cap and asks about details lost in merging, earlier values of facts that changed, periods of time, facts mentioned once in passing, and things never said, with about 10 questions per category. Then continue with steps 2–6. The plan: layered memory that never loses a true fact (core, archive, recall, episodes), measured by a memory evaluation built first. Background in [research/memory.md](research/memory.md).
2. [Reminders and push](specs/reminders-and-push.md): a `remind` tool and Web Push notifications to the home-screen app.

## Later

Not specified yet. Write a spec before starting one.

- **Full-text history search.** `search_history` scans the transcript linearly, which will slow down after years of use. Use an SQLite FTS index in the same database.
- **Real-world tools.** Web search and fetch first, then calendar and email. Each tool that touches files or a shell must run in an environment that cannot see the data directory.
- **Gatherbot.** A Cloudflare host for `@familiar/core`: one Durable Object per household, Gather's auth deciding who reaches which object, an API key instead of a subscription. The open question is which Convex identity the bot acts as when no member is present.
- **AI Elements patterns** ([shadcn AI Elements](https://ui.shadcn.com/docs/ai-elements)), each with the feature that needs it: Confirmation (approving actions) with real-world tools, Sources and Inline Citation with web search, Context (a context-budget gauge) and Suggestion (prompts on an empty chat) whenever convenient.
- **Native app.** Another client of the same API, reusing `@familiar/client`; APNs instead of Web Push.
- **The real logo.** A cat. Replace `apps/web/public/icon.svg` and run `pnpm --filter @familiar/web icons`.
