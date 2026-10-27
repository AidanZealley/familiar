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

1. [Long-term memory](specs/long-term-memory.md). Where it stands on 2026-10-26:
   - **Eval** (branch `fix/memory-eval-judge`, merged into this one): the judge checks claims against the scenario text and is pinned to `gpt-6.1-sol`; runs record their token spend; `rowan-v3` is the harder scenario (a year, 50 questions, well past core's budget); model responses that go silent for three minutes are retried. v2 graded again: 23 of 25.
   - **Resumable eval** (branch `fix/resumable-eval`, from the baseline commit `68a1f39`; merge it into both branches): replays are kept under `~/.local/share/familiar-eval/runs/` and continue with `--resume`.
   - **v3 baseline**: in progress on `68a1f39`. If it stopped early, its replay is in `~/.local/share/familiar-eval/runs/v3-baseline/`; resume it from the `fix/resumable-eval` checkout with `pnpm eval:memory --resume ~/.local/share/familiar-eval/runs/v3-baseline` and commit the result as the baseline.
   - **Steps 2–4** are on this branch: facts with importance, core, history and pins; recall of facts and episodes before each request and through the `recall` tool; day episodes with weekly and monthly rollups; core rebalanced in code. Each step was reviewed and its findings fixed; the last fixes (`437f0e6`) haven't been reviewed again.
   - **Step 5**, the Memory page, is on `feat/memory-page` (from this branch): the owner chose layout F from the prototypes on `feat/memory-page-variants`. Facts, History and Episodes are routes under `/memory`; episodes now stream to clients; the chat's margin shows the facts each reply saved. Showing the facts each reply _used_ (recall) is left for later: core works them out per request but doesn't record them where clients can see.
   - **Next**: review `437f0e6` and step 5; step 6, run the eval on this branch and compare with the baseline. Don't merge either branch until step 6 shows no regressions: this one migrates the live memory document.
2. [Reminders and push](specs/reminders-and-push.md): a `remind` tool and Web Push notifications to the home-screen app.

## Later

Not specified yet. Write a spec before starting one.

- **Full-text history search.** `search_history` scans the transcript linearly, which will slow down after years of use. Use an SQLite FTS index in the same database.
- **Real-world tools.** Web search and fetch first, then calendar and email. Each tool that touches files or a shell must run in an environment that cannot see the data directory.
- **Gatherbot.** A Cloudflare host for `@familiar/core`: one Durable Object per household, Gather's auth deciding who reaches which object, an API key instead of a subscription. The open question is which Convex identity the bot acts as when no member is present.
- **AI Elements patterns** ([shadcn AI Elements](https://ui.shadcn.com/docs/ai-elements)), each with the feature that needs it: Confirmation (approving actions) with real-world tools, Sources and Inline Citation with web search, Context (a context-budget gauge) and Suggestion (prompts on an empty chat) whenever convenient.
- **Native app.** Another client of the same API, reusing `@familiar/client`; APNs instead of Web Push.
- **The real logo.** A cat. Replace `apps/web/public/icon.svg` and run `pnpm --filter @familiar/web icons`.
