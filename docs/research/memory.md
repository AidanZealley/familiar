# Long-term memory: research notes

Background for [the memory spec](../specs/long-term-memory.md). The goal: an assistant that stays coherent for years, remembers what matters accurately, and keeps its everyday context fresh rather than buried under months of old detail.

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

## Sources and what to take from each

- **MemGPT / Letta** ([paper](https://arxiv.org/abs/2310.08560), [docs](https://docs.letta.com/concepts/memory-management)): core memory blocks in context, archival and recall memory outside it, managed by the agent through tools. Letta's ["sleep-time compute"](https://learn.traeai.com/t/ai-engineering/phases/14-agent-engineering/08-memory-blocks-sleep-time-compute.html) reorganises memory in the background between conversations, as Familiar's nightly upkeep does.
- **Generative Agents** ([Park et al. 2023](https://arxiv.org/abs/2304.03442)): a memory stream retrieved by a weighted score of **recency** (exponential decay since last use), **importance** (rated by the model when stored) and **relevance** (similarity to the current situation). Importance is what lets a vital old fact outrank trivial recent ones. "Reflection" periodically turns many observations into higher-level insights.
- **Zep / Graphiti** ([paper](https://arxiv.org/abs/2501.13956)): facts carry when they became true and when they stopped being true. A contradicted fact is marked invalid, not deleted, so history ("lived in Leeds until 2026") survives and the current fact wins.
- **TiMem** ([paper](https://arxiv.org/abs/2601.02845)): consolidation in a time hierarchy, turns into days into weeks into months, so old periods stay summarised at a sensible grain.
- **Survey, 2026** ([arXiv 2603.07670](https://arxiv.org/abs/2603.07670)): frames memory as a write, manage, read loop; notes that turning repeated episodes into stable facts is rarely automatic in practice. Consolidation without careful deduplication risks overwriting still-relevant memories.
- **Mem0** ([paper](https://arxiv.org/abs/2504.19413)): extract candidate facts from each exchange, then decide add, update, delete or nothing against existing similar memories.
- **LongMemEval** ([paper](https://arxiv.org/abs/2410.10813)): a benchmark of long-horizon chat memory: information extraction across sessions, multi-session reasoning, temporal reasoning, knowledge updates, and abstaining when something was never said. A good template for Familiar's own evaluation.

## Lessons for Familiar

1. Never lose a true fact to make room. Demote it out of the prompt instead.
2. Supersede rather than overwrite when facts change, and keep when each was true.
3. Rate importance when a fact is stored; rank retrieval by relevance, importance and recency together.
4. Summarise time hierarchically so old periods remain answerable.
5. Measure: memory quality can't be judged by chatting. Build an evaluation before redesigning, and run it after.
