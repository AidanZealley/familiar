# Long-term memory: research notes

The evidence behind [how Familiar remembers](../memory.md). The goal is memory that works at a decently high level and keeps working at that level for years. Perfect recall is not the goal; human memory isn't perfect either.

## The shared idea: layers with different jobs

Research and production systems converge on separate kinds of memory, loosely modelled on human memory:

| Layer              | Holds                                            | Size                        | How the model gets it   |
| ------------------ | ------------------------------------------------ | --------------------------- | ----------------------- |
| Working            | The recent conversation, verbatim                | Bounded by a context budget | Always in context       |
| Core               | Who the people are, what matters now             | Small                       | Always in the prompt    |
| Semantic (archive) | Every lasting fact ever learnt                   | Unbounded                   | Retrieved when relevant |
| Episodic           | What happened, summarised by day, week and month | Unbounded                   | Retrieved when relevant |
| Raw record         | The full transcript                              | Unbounded                   | Searched on request     |

Size limits belong on the layers that sit in every prompt (working and core). Everything else grows, and stays useful through retrieval, not deletion.

## What the research says matters most

In rough order of how much it affects answers:

1. **Tracking what's current.** StateMem's authors call the most common failure "state drift": the right fact is in context, but the agent answers with a superseded value or misses what a change implies. They report it leads the failures on several established benchmarks and persists under perfect retrieval. Tracking which value replaced which, and marking values derived from a changed fact as stale, improved current-state accuracy 1.8× over the strongest same-model baseline. LongMemEval's "knowledge updates" and Zep's validity dates point the same way.
2. **Time.** LoCoMo found the widest gap to humans on temporal reasoning. LongMemEval attached dates to facts and narrowed search to the time range a question names, which raised temporal recall by 6.8 to 11.3%.
3. **What extraction drops is gone.** MemoryTax found "the writer sets a ceiling": a stronger reader can't recover what a weaker writer left out of memory. Coding agents searching the raw record with their own tools scored best. That study is one conversation that fit in context, so treat it as direction, not proof.
4. **How results are read.** LongMemEval's reading step (Chain-of-Note, with structured formatting) added up to 10 points with retrieval already perfect. Lost in the Middle shows models use the middle of long contexts poorly, so less, better-ordered recall beats more.
5. **Granularity: find small, read with context.** LongMemEval found single rounds (one turn and its reply) retrieve better than whole sessions, and that indexing a round under the facts extracted from it raised recall@k by 9.4%. MemOps found session-level retrieval beat turn-level, because single turns lose context. Both are satisfied by retrieving a round and returning its neighbours.
6. **Forgetting is narrow.** In the benchmarks, "forgetting" mostly means superseding (point 1). MemOps tests explicit "please forget" requests, mainly as leakage of the forgotten value. Decay appears in Generative Agents and MemoryBank as a ranking rule; nothing found shows decay improving accuracy.

## How other assistants handle "remember this"

All the systems checked save an explicit request at once and consolidate the rest in the background:

- **OpenClaw** writes the note to a file when asked, runs a silent "save what matters" turn before compaction, and "dreaming" promotes items from daily notes into `MEMORY.md` in the background.
- **ChatGPT** keeps an explicit list of saved memories and, separately, references past chat history without saving anything.
- **Letta** gives the main agent memory-editing tools and runs a sleep-time agent that reorganises the same memory in the background.

Their immediate saves guard against compaction losing what wasn't written down. Familiar's transcript is searchable, so nothing is lost before upkeep files it; it departs from this pattern deliberately (see [memory.md](../memory.md)).

## Sources

- **MemGPT / Letta** ([paper](https://arxiv.org/abs/2310.08560), [sleep-time agents](https://docs.letta.com/guides/agents/architectures/sleeptime)): core memory in context; recall memory (the full message history, searchable) and archival memory outside it. A sleep-time agent reorganises memory in the background.
- **Generative Agents** ([paper](https://arxiv.org/abs/2304.03442)): retrieval by recency × importance × relevance. Importance lets a vital old fact outrank trivial recent ones.
- **MemoryBank** ([paper](https://arxiv.org/abs/2305.10250)): strength that decays with time and is refreshed by recall.
- **Zep / Graphiti** ([paper](https://arxiv.org/abs/2501.13956)): facts carry when they were true in the world and when the system learnt or retired them; contradicted facts are invalidated, not deleted; facts link back to the messages they came from.
- **RAPTOR** ([paper](https://arxiv.org/abs/2401.18059)): a tree of summaries. Searching all levels at once ("collapsed tree") beat walking down the tree.
- **TiMem** ([paper](https://arxiv.org/abs/2601.02845)): consolidation in a time hierarchy, days into weeks into months.
- **Mem0** ([paper](https://arxiv.org/abs/2504.19413)): extract candidate facts, then add, update, delete or do nothing against similar existing ones.
- **LongMemEval** ([paper](https://arxiv.org/abs/2410.10813)): the benchmark Familiar's eval follows (extraction, multi-session reasoning, temporal reasoning, knowledge updates, abstention), and the round-granularity, fact key expansion, time-aware query and reading findings above.
- **LoCoMo** ([paper](https://arxiv.org/abs/2402.17753)): very long conversations; temporal reasoning is the hardest category.
- **Lost in the Middle** ([paper](https://arxiv.org/abs/2307.03172)): information in the middle of a long context is used poorly.
- **Can Agent Memory Systems Track Evolving State?** ([paper](https://arxiv.org/abs/2608.19652)): StateMemBench and StateMem, on state drift.
- **MemOps** ([paper](https://arxiv.org/abs/2607.12893)): memory as remember, update, forget and reflect operations; session-level retrieval beat turn-level.
- **MemoryTax** ([paper](https://arxiv.org/abs/2610.29823)): designed memory against full context, BM25 and agents searching raw history; the writer ceiling.
- **A Simple Yet Strong Baseline** ([paper](https://arxiv.org/abs/2511.17208)): event-level memory with small effective context.
- **OpenClaw** ([memory docs](https://docs.openclaw.ai/concepts/memory)) and **ChatGPT** ([memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq), [reference chat history](https://help.openai.com/en/articles/11146739-how-does-reference-saved-memories-work)).

Most 2026 papers above are preprints reporting the authors' own experiments, read at abstract and results level. Use their numbers for direction.

## Familiar's own evidence

- The saved baseline, 41 of 50 on rowan-v3 (`eval/results/2026-10-27-be415fd.json`), measured the flat fact list with `search_history`, before layered memory. 11 of the 41 passes used `search_history`. The layered system that followed has not been measured.
- 7 of its 9 failures were details a summary had dropped or an embellishment ("leather", "cracked", "inherited"): the writer ceiling in practice.

## Lessons for Familiar

1. Keep the transcript as the one record and make it searchable. Everything else is derived and may be lossy.
2. Supersede rather than overwrite, and record when each fact was true, not only when it was saved.
3. Keep facts short and single-statement, so core holds enough of them and a fact never hides several.
4. Retrieve small and read with neighbours. Keep automatic recall small; put depth behind a tool.
5. Rank by relevance, importance and recency; narrow by the dates a question names.
6. Revisit old facts on a schedule, a few at a time, so current-but-wrong facts don't pile up.
7. Measure retrieval without a model, including as history grows, and watch health numbers on real data.
