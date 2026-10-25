# Memory upkeep

Familiar should stay coherent and cheap after years of daily use. Today three things degrade with time:

- **Context size.** Pi Durable's default compaction starts only about 30k tokens before the model's limit. With `gpt-6.1-sol` (272k), long-running requests send roughly 220–250k tokens each: slow, costly against the subscription's limits, and worse at using what's in them.
- **Memory size.** The fact list has only a soft limit, which the model may ignore.
- **Memory quality.** Nothing removes stale facts, merges duplicates, or catches facts the model forgot to save.

Do the three parts in order and commit each separately. The code lives in `packages/core` and `packages/memory`; keep both portable (README Rules).

## 1. Context budget

Requests should stay near a fixed token budget, whatever the model's context window.

1. Add a `contextBudget` option to `openFamiliar`, in tokens, defaulting to 64,000. Document the trade-off in its comment: higher keeps more conversation verbatim and costs more on every request.
2. Pass compaction settings to `Harness.open` (README sections Settings and Compaction in the installed pi-durable) so that automatic compaction keeps the active context under the budget for the configured model: `reserveTokens` derived from the model's `contextWindow`, `keepRecentTokens` well under the budget (around a third), and background compaction starting before the blocking threshold. Look the model up through `models` to get its window. If the model changes, the next open recomputes.
3. Test with a faux model that has a small `contextWindow` and a small budget: after enough messages, a `pi.compaction` entry exists and the next request's context is under the budget.

Done when the test passes and the defaults for `gpt-6.1-sol` compact before about 64k tokens.

## 2. Hard cap on memory

1. Keep the soft limit (4,000 characters of listed facts), where the prompt section asks the model to merge.
2. Add a hard limit of 6,000 characters. Past it, `remember` adds nothing and returns an error result telling the model to merge or forget facts first. `revise_memory` and `forget` always work, so the model can always get back under.
3. Test both: the section's guidance past the soft limit, and `remember` refusing past the hard limit.

Done when both tests pass.

## 3. Consolidation

A scheduled pass, once a day at 04:00 in the host's time zone, where the model reviews memory against recent conversation.

What a pass does, in one model run:

- Merges duplicates and near-duplicates.
- Updates or removes facts the recent conversation contradicts or has made stale. Each fact has `at`, its last-written time, to help judge.
- Adds lasting facts from the recent conversation that were never saved.
- Changes nothing when nothing needs changing.

Preferred design, which reuses the memory tools instead of parsing model output:

1. An **upkeep conversation**, separate from the main one (`harness.createConversation`, ownerless), with only the memory extension selected and instructions describing the pass. It is never shown to people.
2. A **durable task** that sleeps until the next 04:00, then submits one input to the upkeep conversation: the messages from the main conversation since the last pass (people's messages and Familiar's replies, as text, oldest first), and waits for it to settle. It records the newest entry it included, then sleeps until the next 04:00. See "Sleeping and Waking Up" in the pi-durable README: work after a sleep goes in the next phase, and what it needs goes in the checkpoint.
3. Reset the upkeep conversation before each pass (`reset`), so it never accumulates its own history.
4. `openFamiliar` ensures exactly one such task exists, creating it on first open, and leaves it alone on later opens. Store what you need to find it again (the upkeep conversation's ID, the last included entry) in a session document.
5. Skip the pass when there are no new messages.
6. Cap the transcript a pass sends to fit the context budget, keeping the newest messages.

If the installed Pi APIs make another design clearly simpler, use it and explain why in the commit body.

Tests, with the faux provider and a fake clock (`now` and `setTimer` in Harness options):

- A pass runs at 04:00, and the faux model's memory tool calls change memory.
- The pass receives only messages since the previous pass.
- No pass runs (no model request) when there are no new messages.
- After a close and reopen, there is still exactly one upkeep task, and it keeps its schedule.

Done when all four tests pass and the README's description of `packages/memory` mentions consolidation.

## Out of scope

Full-text search and periodic summaries; see the roadmap's Later section.
