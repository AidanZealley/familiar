# Roadmap

Familiar is a personal assistant in the spirit of Grok Bot, Meta's Muse and OpenAI's dots: always on, reachable from the owner's devices, remembering them over time, and eventually acting on its own. It is also meant to be embedded: another app (first, the owner's household app Gather) can host its own Familiar alongside itself, for example one per household in a Cloudflare Durable Object. Keep that second use possible in every change; the README's Rules say how.

## Done

- **Core and hosts.** One durable conversation over Pi Durable; the HTTP + SSE API; the client store; the web UI.
- **Always on.** A systemd user service serves the API and UI on `127.0.0.1:4317`, published tailnet-only over HTTPS on port 10000. The home-screen manifest is in place. The service has run `main` since 2026-10-28; its data directory was backed up first to `~/.local/share/familiar-backup-20261028-065558`.
- **Memory.** A fact list the model kept with `remember`, `revise_memory` and `forget` and saw on every request; a Memory page for corrections. Replaced by the memory overhaul.
- [Memory upkeep](specs/memory-upkeep.md): a 64k context budget, a hard cap on the fact list, and nightly consolidation.
- [Chat UI](specs/chat-ui.md): shadcn's chat components, streamed Markdown, and `pnpm dev:demo`.
- [Chat history](specs/chat-history.md): scrolling back past compactions, a Stopped marker, and a lazily loaded Markdown renderer.
- [Memory](memory.md): searchable transcript exchanges, short dated facts with sources written by upkeep, recall over every layer with `read_memory`, nightly fact review, the model-free `pnpm eval:recall` test and health diagnostics. Real-model evaluation is still pending.
- [Reminders and push](specs/reminders-and-push.md): schedules (a prompt Familiar runs at a time, once or repeating), Web Push notifications to the home-screen app, and a Schedules page.

## Next

Pick these up in order unless the owner says otherwise. Each spec is complete enough to implement without earlier conversation.

1. [Extensions](specs/extensions.md): plugins with destination-bound credentials, a Connections page, web search with Brave as the first plugin, and MCP servers as deferred tools. Real-world tools build on it.
2. [Easy install](specs/easy-install.md): one command that installs, signs in and starts Familiar on Linux, macOS, Windows or a VPS, and export and import to move it between machines.

## Later

Not specified yet. Write a spec before starting one.

- **Real-world tools.** First-party plugins ([Extensions](specs/extensions.md)), after web search: calendar, read-only from a private ICS URL, then email. Each tool that touches files or a shell must run in an environment that cannot see the data directory.
- **Photos.** Image input from the chat, using the model's own vision and Pi's image resizing; the work is the message format and the UI.
- **Gatherbot.** A Cloudflare host for `@familiar/core`: one Durable Object per household, Gather's auth deciding who reaches which object, an API key instead of a subscription. The open question is which Convex identity the bot acts as when no member is present.
- **AI Elements patterns** ([shadcn AI Elements](https://ui.shadcn.com/docs/ai-elements)), each with the feature that needs it: Confirmation (approving actions) with real-world tools, Sources and Inline Citation with web search, Context (a context-budget gauge) and Suggestion (prompts on an empty chat) whenever convenient.
- **Native app.** Another client of the same API, reusing `@familiar/client`; APNs instead of Web Push.
- **The real logo.** A cat. Replace `apps/web/public/icon.svg` and run `pnpm --filter @familiar/web icons`.
