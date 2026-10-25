# Chat UI

Rebuild the web chat on shadcn's chat components and render replies as streamed Markdown. The current UI (`apps/web/src/components/chat`) is a placeholder: plain-text replies, a hand-written stick-to-bottom hook, and basic tool-call rows.

Do the parts in order and commit each separately. Only `apps/web` and `apps/daemon` change; the UI keeps depending on `@familiar/client` alone (README Rules).

## 1. Demo mode

UI work needs every state on screen (streaming, tool calls, errors, queued messages, compaction) without messaging the owner's real Familiar. Build that first.

1. `pnpm dev:demo` from the repo root runs a demo daemon and a Vite dev server for it, alongside the real service:
   - The daemon uses pi-ai's faux provider (see `packages/core/src/familiar.test.ts`), fresh `MemoryStorage` on every start, port 4318, and no credentials. It must never open `~/.local/share/familiar` or take its lock.
   - Vite runs on port 5174, reachable over the LAN and tailnet like `pnpm dev:web`, proxying `/api` to 4318. Make the proxy target configurable rather than copying the Vite config.
2. Share the server wiring (API mount, static files, shutdown) between `main.ts` and the demo so the two can't drift.
3. Script the faux model so a message's text picks the scenario, streaming at a readable speed (faux `tokensPerSecond`):
   - default: a reply with headings, lists, a table, inline code and a fenced code block
   - `tool`: a `current_time` call followed by a reply
   - `memory`: a `remember` call followed by a reply
   - `slow`: a long reply, for testing Stop and queued messages
   - `error`: a failed reply with an error message
4. Document `pnpm dev:demo` in the README's Developing section, and its scenario words.

Done when `pnpm dev:demo` runs while the service is running, and each scenario renders.

## 2. Chat components and Markdown

1. Install shadcn's chat components into `apps/web`: `pnpm dlx shadcn@latest add message-scroller message bubble marker` (changelog: https://ui.shadcn.com/docs/changelog/2026-06-chat-components). Confirm they build against the Base UI preset; if a component only exists for Radix, say so before working around it.
2. Rebuild the chat with them:
   - `MessageScroller` owns scrolling: remove `useStickToBottom`.
   - People's messages and replies use `Message` and `Bubble`. Queued messages look pending.
   - `Marker` shows tool activity (with `shimmer` while running), the compaction note, the thinking state and errors. A tool call can still be expanded to show its arguments and output.
3. Render reply text with `streamdown`, including Shiki code blocks with a copy button, following the app's light and dark themes. People's messages stay plain text.
4. Keep the existing behaviour: Enter sends, Shift+Enter adds a line, Stop appears while busy with an empty input, and safe-area insets on iOS.
5. Check the result in a browser against `pnpm dev:demo` at desktop and phone widths, in light and dark. Screenshot each scenario for the hand-off.

Done when every scenario renders correctly in both widths and themes, and the hand-off includes the screenshots.

## Out of scope

Attachments (no upload API yet), and changes to `@familiar/client` beyond bug fixes. If the client is missing something the UI needs, stop and report it.
