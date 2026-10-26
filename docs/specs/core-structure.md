# Core structure

Restructure so each piece of behaviour has one home, and understanding it doesn't mean chasing files across packages. Behaviour does not change: the existing tests must pass, adjusted only for moved imports.

Do this before the [long-term memory](long-term-memory.md) steps 2–6, which build on the result.

## Problems

1. `packages/memory` can't import from core (core depends on it), so it re-knows core's facts: `history.ts` hard-codes the `'familiar.message'` entry kind, upkeep assumes `ROOT_CONVERSATION_ID`, and memory's tests live in `packages/core`.
2. Revising and forgetting a fact are implemented twice: as model tools in `memory.ts` and as host actions in `summonFamiliar`. They already differ (the host path skips the size check).
3. `summonFamiliar` wires everything inline: compaction settings, upkeep, history paging, memory edits.
4. The eval runner (`apps/daemon/src/memory-eval/run.ts`) mixes clock waits, replay, questions and scoring.

## Steps

Commit each step separately.

1. **Fold memory into core.** Move `packages/memory/src/*` into `packages/core/src/memory/`, and the message format into `packages/core/src/conversation/`: `MESSAGE_KIND`, `MessageData`, `saidBy` and the `search_history` extension. Memory code imports the message format from there instead of repeating it. Move memory's tests next to their code. Delete `packages/memory` and update workspace references, ESLint config, README layout and `AGENTS.md`. `core/http.ts` stays the one wire contract and keeps exporting the same types.
   Done when no string `'familiar.message'` exists outside `conversation/`, and `packages/memory` is gone.
2. **One home for memory edits.** Pure functions in `core/src/memory/` (for example `reviseFact(memory, id, text, at)` and `forgetFact(memory, id)`) used by both the tools and `Familiar.memory`. Keep today's behaviour for each caller, including what the tools return to the model.
   Done when each edit exists once, with tests on the functions.
3. **Slim `summonFamiliar`.** Each folder exports what it contributes (extensions, start-up, the parts of the `Familiar` API it owns), so `summonFamiliar` reads as a short sequence: open the harness, install persona, conversation and memory, start upkeep, return the API. Compaction settings live with the context budget they serve.
   Done when `summonFamiliar` fits on one screen and reads top to bottom.
4. **Split the eval runner** into files by job: waiting on the fake clock, replaying the scenario, asking and scoring questions. `run.ts` keeps only `runMemoryEval` composing them.
   Done when no file in `memory-eval/` mixes those jobs.

Leave `apps/web` as it is.
