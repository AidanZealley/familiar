# Memory overhaul

Rebuild memory so it works at a decently high level and keeps working at that level for years: cost per reply and per night stays bounded, and answers to a fixed set of questions don't get worse as history grows. Read [how Familiar remembers](../memory.md) first. It describes the target and why each decision was made; this spec says what to change, the exact shapes, and when each step is done. The evidence is in the [research notes](../research/memory.md).

Familiar is a prototype with no data worth keeping, so there are no migrations. Start the new fact document under a new kind, leave old documents unread, and rewrite the demo seed and tests to match.

## Constraints

- Everything stays portable (README Rules). Memory lives in Pi documents and the transcript; the exchange index lives in memory and is rebuilt from them.
- Use the installed Pi docs and types (`packages/core/node_modules/@earendil-works/pi-durable/README.md` and `dist/**/*.d.ts`).
- Don't run `pnpm eval:memory`: a replay takes most of a day. Keep it compiling and its tests passing. All measurement in this spec is free and model-less.
- Each step is its own commit, leaves `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm exec prettier --check .` passing, and updates the demo, tests and docs it affects.

## Target design

### Fact document

Kind `familiar.facts`, version 1, session scope, streamed to clients under the existing document name `memory`. Its rules stay in `memory/facts.ts`, and every edit ends with `rebalanceCore` as today.

```ts
type Fact = {
  /** `f1`, `f2`, …; never reused. */
  id: string
  /** One statement, at most FACT_LIMIT (300) characters. */
  text: string
  /** 1 to 5, as today. */
  importance: number
  /** Local day it became true. Defaults to the day the source message was sent. */
  since: string
  /** Local day it stopped being true. Set means the fact is past. */
  until?: string
  /** Entry IDs of the person messages it came from. Empty only for seeded and owner-written facts. */
  sources: EntryId[]
  /** When upkeep or the owner wrote it, in ms. */
  saved: number
  /** Facts this one superseded. */
  replaces?: string[]
  core: boolean
  pinned?: boolean
}
type FactsState = { facts: Fact[]; next: number }
```

Rules:

- Text over `FACT_LIMIT` throws a `FactError` that tells the model to split it into separate facts.
- `since` and `until` are world time and `saved` is record time. Describe a fact with its days (`since 2025-11-03`, `2025-02-02 to 2025-11-03, replaced by f40`), never with `saved`.
- Revising a fact sets the old one's `until` to the new one's `since`. A revision's `sources` are the given ones plus those of the facts it replaces.
- Retiring sets `until`, defaulting to the day of the batch being reviewed (for the owner, today).
- No rule deletes a fact.

### Usage document

Kind `familiar.memory-usage`, version 1, session scope, not streamed: `{ facts: Record<string, { recalled?: number; checked?: number }> }`. `recalled` is set when a fact reaches the conversation model, as `markRecalled` does today. `checked` is set by the nightly review. `rebalanceCore` reads `recalled` from here for its recency rule, so it takes both documents. Keeping the frequently changing timestamps out of the fact document means the facts clients receive change only when facts do.

### Episodes

Keep the `Episodes` document and its rollups. Add an optional `entries?: { from: EntryId; to: EntryId }` to day episodes, set from the batch's first and last entry. This is additive, so no version change is needed.

### Exchanges

An exchange is a person message (`saidBy(entry)?.role === 'person'` in the root conversation) and the replies after it, up to the next person message. Its ID is `x` and the person message's entry ID, and its text is the person's text followed by the reply text. Exchanges are derived and never stored.

`memory/exchanges.ts` owns an in-memory MiniSearch index of them, created by `createMemory`, with the same term processing as `recall.ts`. At the start of each search it catches up by scanning root entries after the last one it indexed. It adds an exchange only once the next person message exists, so every indexed text is final, and the index only ever appends. The newest exchange is still in context, so it doesn't need indexing. After a restart the first search rebuilds the index from the start of the transcript.

### Tools

| Tool                                                             | Who                     | Does                                                                    |
| ---------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `recall(query)`                                                  | Conversation and upkeep | Searches facts (past included), episodes and exchanges.                 |
| `read_memory(id)`                                                | Conversation and upkeep | Opens what lies behind an ID (below).                                   |
| `remember(text, importance, sources, since?)`                    | Upkeep only             | Saves a fact. `sources` must name at least one existing person message. |
| `revise_memory(id, text, sources?, importance?, since?, merge?)` | Upkeep only             | Saves a new version that replaces `id` and any `merge` facts.           |
| `retire(id, until?)`                                             | Upkeep only             | Marks a fact no longer true.                                            |

`forget` and `set_importance` are removed. Install the conversation's tools through the memory extension and upkeep's through the upkeep extension. A tool only the other conversation should have must not be offered at all, not merely refused.

`recall` returns up to 8 facts, 4 episodes and 6 exchanges, at most 3,000 tokens in total. It groups them under Facts, Episodes and Exchanges, and ranks each group separately, so scores never need to be comparable across kinds. Facts list current ones first, and past ones show their days and what replaced them. Exchanges show their ID, date and up to about 300 characters around the best match.

`read_memory(id)` returns, within about 3,000 tokens:

- for `x…`, the exchange with the one before and after it;
- for `f…`, the fact, its chain (what it replaced and what replaced it, with days), and its source exchanges;
- for a day episode, the episode and its exchanges, oldest first, cut off at the budget with the ID of the first one left out;
- for a week or month episode, the episode and its child episodes' IDs, spans and first lines.

### Automatic recall

Same hook, memo and budget as today (8 items, about 1,000 tokens), over facts outside core and episodes, without exchanges. An episode is a candidate only while nothing covers it: a day until its week is rolled up, a week until its month is, and months always. When the message names dates (`datesIn`), episodes of every span that overlap them are candidates too. Ranking keeps `RANKING` in `recall.ts`. Add exchange weights there, and use `since` and `until` instead of record time for facts.

### Upkeep

Phases, in order, each bounded:

1. **Pass** (today's batching, unchanged in how it chooses a batch). Number each person line with its exchange ID: `[x812 2026-10-28 09:14] Rowan: …`. The prompt says:
   - Save lasting facts as single statements, citing the exchange IDs they came from.
   - Split rather than merge into long facts.
   - Always save anything the owner explicitly asked Familiar to remember, at importance 4 or 5.
   - Check with `recall` before saving, as now.
   - Write the episode.
2. **Rollup**, unchanged.
3. **Review.** Choose up to `REVIEW_LIMIT` (20) current facts whose `checked ?? saved` is more than 30 days old, oldest first. If there are none, sleep. Otherwise reset the upkeep conversation and send those facts with their days, plus the day episodes of the last 30 days within the transcript budget. The prompt asks the model to revise or retire facts the episodes show have changed, using `recall` and `read_memory` to check, and to leave the rest. When the pass succeeds, set `checked` to now on every fact it was given, then sleep. A failed review is reported and retried the next night.

A single message larger than the batch budget is still cut off and reported. It stays whole in the transcript, so search still finds it.

### Owner API and routes

`MemoryApi` keeps `watch`, `watchEpisodes`, `revise` (owner-written, `sources: []`, `since` today), `retire` and `setPinned`, and gains `health()`. Remove `forget`, the `DELETE /memory/:id` route and `store.forgetFact`. Add `GET /memory/health`, returning:

```ts
type MemoryHealth = {
  facts: { current: number; core: number; past: number }
  coreCharacters: number
  /** Current facts whose `checked ?? saved` is over 180 days old. */
  unchecked: number
  episodes: { day: number; week: number; month: number }
  exchanges: number
  /** Since Familiar started. */
  indexBuildMs: number
  search: { count: number; medianMs: number; maxMs: number }
}
```

Search timings are kept in memory, the last 200 of them. They are not stored.

## Steps

### 1. Exchange search and the rot test

1. Write `memory/exchanges.ts`: an `ExchangeIndex` with `add(exchange)` and `search(query, now, { limit, ranges })`, built on MiniSearch with recall's term processing. Rank as relevance × recency, plus a date-fit boost when `ranges` are given, as episodes have now. Export it from `diagnostics.ts` for the eval.
2. Add `pnpm eval:recall` in `apps/daemon/src/memory-eval/`:
   - Build exchanges from rowan-v3's days, one per day with text, dated that day, using the person text only.
   - Pad with filler exchanges dated after the scenario: 0, 1, 5 and 10 years at 10 exchanges a day. Generate the filler deterministically from templates that mix rowan-v3's people and project names with everyday activity, so the filler competes for the same words without containing tested details.
   - For each question and padding level, search with `datesIn` ranges taken from the question and `now` set to the end of the padding. Score whether each required string appears, case-insensitively, in the top 5 and top 10 exchanges.
   - Skip required strings that appear nowhere in the scenario (4 of 180) and list them.
   - Print recall@5 and recall@10 by category and padding level, with the median and maximum search time and the index build time. Write the same numbers to `eval/results/recall-<date>-<git-describe>.json`.
3. Test the index directly in `exchanges.test.ts`.

Done when `pnpm eval:recall` runs in under a minute, its first results are committed, and the README's memory evaluation section explains it next to `eval:memory`.

### 2. The fact store

1. Replace `Fact`, `MemoryState` and the `Memory` document with the fact document and usage document above. Update `rememberFact`, `reviseFact`, `retireFact`, `setPinned` and `rebalanceCore`, and remove `forgetFact`, `setImportance` and `migrateV1`.
2. Move `markRecalled` to the usage document.
3. Update the owner API, routes, client store and Memory pages: show `since` and `until`, and remove Forget.
4. Rewrite the demo seed (`apps/daemon/src/demo/seed.ts`) in the new shape, keeping its year of Rowan's facts and changes, with `since` days.

Done when tests cover the length cap, `since` and `until` on revise and retire, sources carried through revisions, that no rule deletes a fact, and core staying within budget, and the demo's Memory pages show the seeded facts with their days.

### 3. Upkeep as the only writer

1. Split the tools as in the table. The conversation gets `recall` (and `read_memory` from step 4); upkeep gets the writing tools as well.
2. Label person lines with exchange IDs in `upkeep/transcript.ts`, update the pass prompt, and validate `sources` in `remember` and `revise_memory`.
3. Remove the chat's saved-fact margin: `SavedDetails`, `savedBy` and `saved` in `packages/client/src/transcript.ts`, and `SavedFact` and its margin wiring in `apps/web`.
4. Change the demo's `memory` word (`apps/daemon/src/demo.ts`) to call `recall`, and its README table row to match.

Done when faux-model tests show the conversation model can't see writing tools, upkeep saving a fact with its sources and `since`, upkeep rejecting a source that isn't a person message, and an explicit "remember this" message becoming a fact after the next pass.

### 4. Recall over every layer

1. Set `entries` on day episodes in the pass.
2. Wire `ExchangeIndex` into `createMemory` with catch-up at search time, as in Target design.
3. Rewrite the `recall` tool's output in groups and add `read_memory`.
4. Change automatic recall to the candidate rule above and to `since`/`until` ranking.

Done when tests show:

- a day episode's exchanges reachable through `read_memory`;
- a fact's sources reachable through `read_memory`;
- an exchange from before a compaction found by `recall`;
- automatic recall preferring a month episode over its days once the month is rolled up, but reaching the day when the message names its date;
- the prompt section unchanged between requests.

`pnpm eval:recall` must be no worse than step 1's results.

### 5. Nightly review

Add the review phase after rollups.

Done when fake-clock tests show it:

- choosing the oldest-checked facts, up to the limit;
- retiring a fact a recent episode contradicts;
- stamping `checked` only on success;
- sleeping when nothing is due;
- leaving the backlog and rollups to run first.

### 6. Health and docs

1. Add `health()` and its route. Test the counts against a seeded store.
2. Update [architecture.md](../architecture.md) (map, end-to-end message, upkeep paragraph), the README's Layout and demo table, and remove the status note at the top of [memory.md](../memory.md).
3. Mark this spec done in the [roadmap](../roadmap.md).

Done when the docs describe the code as it is and the hand-off checks pass.

## Later, only if measured

| Signal                                                                             | Change                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Health `search.medianMs` over 100 ms, or `indexBuildMs` over 10 s                  | Persist closed months of the exchange index as MiniSearch JSON in a document family, or index facts and episodes incrementally too.      |
| `eval:recall` recall@10 falls more than 10 points between 0 and 5 years of padding | Try in order: stronger date narrowing, indexing exchanges under the facts that cite them (LongMemEval's key expansion), then embeddings. |
| The `Episodes` document passes 2 MB                                                | Split it into one document per year with `defineDocFamily`.                                                                              |
| Explicit requests missed in daily use                                              | A `remember` tool for explicit requests only, with upkeep still placing the fact.                                                        |
| Doubts about the facts upkeep writes                                               | A 30-day upkeep-only replay, without answers or judging.                                                                                 |

## Out of scope

`forget` and transcript erasure (Pi 1.4.0 can't delete entries), decay beyond recency ranking, entity graphs, sharing memory between Familiars, and running `pnpm eval:memory`.
