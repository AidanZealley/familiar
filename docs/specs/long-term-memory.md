# Long-term memory

Familiar should remember what matters about the people it helps for years, accurately, while keeping each request's context small and current. Today it has one fact list, capped at 6,000 characters, that is always in the prompt; when it fills, the model must forget true facts to make room. Replace it with layered memory, following [the research notes](../research/memory.md): read them first.

Keep these from today: the context budget, `search_history`, nightly upkeep at 04:00 (its scheduling, upkeep conversation and once-only guarantees), and the Memory page's place in the app. Everything stays portable (README Rules): memory lives in Pi Durable documents and works on any host.

## Target design

**Facts.** One store of every lasting fact, never silently lost. Each fact has:

- `id`, `text`, `at` (last written) and `created`
- `importance`, 1 to 5, rated by the model when it saves the fact (5: identity, close people, health, standing commitments; 1: minor preferences)
- `core`, whether it sits in the prompt
- `until`, set when the fact stopped being true; such a fact is _past_, kept as history
- `replaces`, the fact this one superseded, so changes form a chain
- `recalled`, when it last reached the model, for recency

**Core memory** is the facts marked `core`, always in the prompt section, within a budget (default 6,000 characters, as today). Nothing is deleted to stay within it: facts leave core but stay in the store.

**Recall.** Before each request, the facts and episodes most relevant to the latest messages are retrieved and shown to the model, ranked by relevance, importance and recency together. They go near the end of the request (a `beforeRequest` hook), not in the prompt section, so the stable prompt prefix and its provider cache are untouched. A `recall` tool searches on demand, past facts included and labelled as past.

**Episodes.** Summaries of what happened: one per day with conversation, rolled up into one per week and one per month. Searchable through recall. They answer "what was going on in March?" without the raw transcript.

**Tools the model uses:**

| Tool                         | Does                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `remember(text, importance)` | Saves a fact. Core if important and there is room.                     |
| `revise_memory(id, text)`    | Saves a new version that replaces the old; the old becomes past.       |
| `retire(id)`                 | Marks a fact no longer true; it stays as history.                      |
| `recall(query)`              | Searches facts and episodes, past included.                            |
| `forget(id)`                 | Deletes a fact outright, only when someone asks Familiar to forget it. |

**Search** runs in JavaScript over the documents, so it works on every host and storage. Use an existing library (for example MiniSearch) rather than writing BM25. Embeddings are out of scope; design the ranking so a similarity score could later replace or join the text-relevance score.

**Nightly upkeep**, extended: extract lasting facts the conversation didn't save; supersede contradicted facts; deduplicate; adjust importance; rebalance core to its budget (demote the least important and least recently recalled; promote important facts that keep being recalled); write the day's episode; roll up weeks and months when one ends.

## Steps

Commit each step separately. Test with the faux provider and a fake clock, as in `packages/core/src/upkeep.test.ts`.

### 1. Memory evaluation

Build this first and record a baseline on today's memory, so the redesign is measured, not guessed.

1. `pnpm eval:memory` replays a scripted, months-long conversation into a fresh Familiar on temporary storage, with a fake clock that advances through days so nightly upkeep runs, using a real model. It then asks questions and scores the answers.
2. The real model needs its own sign-in, never the owner's live credentials: the eval uses a separate data directory (`~/.local/share/familiar-eval`) and documents signing in to it once with `FAMILIAR_DATA_DIR=… pnpm sign-in`. It must not touch `~/.local/share/familiar`.
3. The script covers LongMemEval's categories (research notes): facts stated once long ago; facts that change (a move, a new job, a changed preference); multi-session reasoning; time questions ("what was I doing in early March?"); and things never said, where the right answer is not knowing. Include enough trivial chatter to crowd memory.
4. Score each answer pass or fail with a pinned model judge given the expected answer and the scenario text as ground truth, and print a per-category table. Save results as JSON under `eval/results/` with the date and the commit.
5. Keep the scenario small enough to run in minutes and within normal subscription use; the conversation may be summarised days rather than full transcripts.

Done when the eval runs end to end, its results for the current memory are committed as the baseline, and the README explains how to run it.

### 2. Facts store and tools

1. Bump the memory document's version and migrate existing facts: all become core with importance 3, `created` equal to `at`.
2. Implement the fact shape and the tools above. `remember` beyond core's budget saves the fact outside core instead of refusing. Past facts never appear in the prompt section.
3. Update `Familiar.memory` and the HTTP routes for the owner's edits: revise, retire, forget, and pin or unpin core.

Done when tests cover migration, each tool, supersede chains, and that no tool other than `forget` removes a fact.

### 3. Recall

1. Index facts and episodes for search; keep the index in step with the documents.
2. Before each request, retrieve the top results for the latest messages (default 8, within about 1,000 tokens), excluding facts already in core, and add them near the end of the request. Update `recalled` on what was shown.
3. Score as relevance × importance weight × recency decay. Put the weights in one place with a comment on their intent.
4. Add the `recall` tool.

Done when tests show an important non-core fact reaching the model when relevant, not reaching it when irrelevant, and the prompt section staying unchanged between requests.

### 4. Episodes and upkeep

1. Extend the nightly pass as described in Target design. Weekly rollups run on Monday's pass for the week before; monthly on the 1st.
2. Core rebalancing is deterministic code given the model's importance ratings, not a model decision, so it can't drift.

Done when tests cover each upkeep duty and that rebalancing keeps core within budget without deleting anything.

### 5. Memory page

Show core facts first, then other current facts, then past facts collapsed; episodes in their own section by month. The owner can edit, pin or unpin, retire and forget. Use `pnpm dev:demo` to check it, extending the demo's scripted memory if needed.

Done when every action works in the demo at desktop and phone widths.

### 6. Measure

Run the eval again and commit the results next to the baseline. Report the per-category change, and anything that got worse with a likely cause.

## Out of scope

Embeddings, full-text search over the raw transcript, and sharing memory between Familiars.
