# Chat history

The chat shows only the conversation's active view: what the model currently sees. When compaction summarises older messages, they vanish from the screen, though storage keeps them all. With the 64k context budget that happens every few days. People should be able to scroll back through everything they have ever said to Familiar.

Do the parts in order and commit each separately. Check UI work with `pnpm dev:demo` (its `compact` scenario forces a compaction); never message the real Familiar (AGENTS.md).

## 1. History API and client

1. Core: add `history(before, limit)` to `Familiar`, returning committed entries older than entry `before`, newest first, with a cursor or flag saying whether more exist. Use the conversation's fork-aware `entries()` scan (pi-durable `Conversation.entries`). Expose it as `GET /history?before=<entryId>&limit=<n>` in `core/http`, with its response type exported alongside the other wire types. Cap `limit` (for example at 200).
2. Client: the store keeps older entries it has loaded next to the live `view`, and gains `loadOlder()`, which fetches the page before the oldest entry it has (the oldest of `history`, else the oldest of `view.entries`) and reports when there is nothing more. Concurrent calls must not fetch the same page twice.
3. `toTranscript` builds items from older entries followed by the view's entries, so tool results still pair with their calls across the boundary and each `pi.compaction` entry still shows as a separator where it happened. The view's head marker and system entries render nothing, as now.
4. Tests: a core test (faux provider) where compaction happens and `history` returns the messages before it; client tests for `toTranscript` over history plus view.

Done when tests show messages from before a compaction come back through `history` and render in order.

## 2. Loading older messages in the UI

1. When the reader scrolls near the top, the chat calls `loadOlder()` and prepends the result without moving what's on screen. `MessageScroller` supports prepended history; use that rather than adjusting scroll positions by hand.
2. Show a small loading state while fetching and nothing once the start of the conversation is reached.

Done when, in `pnpm dev:demo` after the `compact` scenario, scrolling up brings back the messages from before the compaction, in order, at desktop and phone widths.

## 3. Stopped replies

1. `toTranscript` marks a reply whose `stopReason` is `aborted` as stopped, and the UI shows a "Stopped" marker after its text.
2. `Familiar.abort()` withdraws queued messages as well as stopping the current reply; that's Pi's behaviour. Correct its doc comment to say so.

Done when the demo's `slow` scenario, stopped mid-reply, shows the marker.

## 4. Smaller first load

The main chunk is about 740 kB because `streamdown` and Shiki load up front.

1. Load the Markdown renderer lazily (`React.lazy` and dynamic `import()`), showing reply text as plain pre-wrapped text until it arrives so nothing jumps or blanks.
2. Report chunk sizes before and after from `pnpm build`.

Done when the build has no chunk-size warning, or the report explains what remains and why.
