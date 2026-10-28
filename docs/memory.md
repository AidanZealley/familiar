# How Familiar remembers

> Status: this describes the design in [the memory overhaul](specs/memory-overhaul.md). Until that spec's steps land, the code differs; [architecture.md](architecture.md) describes the code as it is. The last step removes this note.

Familiar should remember the people it helps well enough to be useful, and keep doing so for years without getting slower or less accurate. It doesn't need perfect recall. People forget details too, but a good cue brings them back, and that is the behaviour to aim for.

## In one paragraph

Everything said is kept in the transcript, and the transcript is the only record. Every night at 04:00, upkeep reads the day's conversation and files it: short facts, each citing the messages it came from and saying when it became true, and a summary of the day that later rolls up into weeks and months. The most important facts sit in every prompt. Before each reply, a small search adds the facts and summaries that match the message. When the model needs more, it searches deeper, down to the original messages, and can open any fact or summary to read what it came from. Old facts are rechecked a few at a time each night, so things that quietly stopped being true don't pile up.

## The layers

| Layer      | What it holds                                                      | Who writes it      | How the model gets it                      |
| ---------- | ------------------------------------------------------------------ | ------------------ | ------------------------------------------ |
| Transcript | Every message and reply, verbatim, forever                         | Pi, as people chat | Recent part in context; the rest by search |
| Core       | The facts that matter most, within 6,000 characters                | Code, from facts   | Always in the prompt                       |
| Facts      | Every lasting fact, current and past, each at most 300 characters  | Nightly upkeep     | Automatic recall and `recall`              |
| Episodes   | What happened each day, week and month                             | Nightly upkeep     | Automatic recall and `recall`              |
| Exchanges  | Each message with its reply, as a search index over the transcript | Derived, in memory | `recall` and `read_memory`                 |

Exchanges aren't stored. They are a view of the transcript: the index is built on the first search after Familiar starts, and catches up on new messages before each search after that. Lose it and it is rebuilt; it owns no data.

## A day in its life

**When a message arrives.** The prompt already holds core facts. Memory searches facts outside core and the episodes, and adds the best few (at most 8, about 1,000 tokens) after the message, for that request only. The model answers. If that isn't enough, it calls `recall`, which searches facts, episodes and the original exchanges, and `read_memory`, which opens a fact, an episode or an exchange and shows what lies behind it.

**At 04:00.** Upkeep works in three stages, each bounded so a night's work never grows with the size of memory:

1. **File the backlog,** one day at a time, oldest first. For each day it saves new facts, revises or retires ones the conversation changed, and writes the day's episode. Each fact cites the messages it came from.
2. **Roll up** finished weeks and months into their own episodes.
3. **Review** the 20 current facts that have gone longest without a check, against the last month's episodes. Facts that changed are revised or retired; the rest are marked checked.

## Why it is built this way

Each decision below says what Familiar does, why, and the evidence. The [research notes](research/memory.md) have the sources.

### 1. The transcript is the record; everything else is derived

Facts and summaries are lossy by nature: whatever the writer leaves out is gone from them. MemoryTax calls this "the writer sets a ceiling", and Familiar's own baseline showed it: 7 of 9 failures were details a summary had dropped. So the transcript stays searchable, and every fact and episode points back to the messages it came from. A weak summary costs some precision but never makes something unreachable.

### 2. Upkeep is the only writer of facts

The conversation model only reads memory. Upkeep sees a whole day at once, so it writes better facts than a mid-conversation save. With one writer there are no duplicates to reconcile and every rule about facts has one owner. Other assistants (OpenClaw, ChatGPT, Letta) save "remember this" immediately, mainly so compaction can't lose it before it's written down. Familiar doesn't need that: the message is searchable the moment it's sent, and upkeep files it that night. If daily use shows explicit requests being missed, the fallback is a `remember` tool for explicit requests only.

### 3. Facts are short and say when they were true

A fact is one statement of at most 300 characters. Without a cap, merging facts makes them grow, core's fixed budget holds fewer of them each year, and a long fact matches searches it isn't about. Each fact records the day it became true (`since`) and, once past, the day it stopped (`until`), separately from when upkeep saved it. Time questions are the hardest category in LoCoMo and LongMemEval, and a fact filed from a week-old backlog shouldn't claim it became true the night it was filed.

### 4. Changes supersede; nothing is overwritten

When a fact changes, upkeep saves a new version that replaces the old one, and the old one becomes past with its dates. Recall shows past facts labelled with their dates and what replaced them, so "where did I live before York?" has an answer and a past value can't pass for a current one. This is Zep's approach, and keeping track of what's current is the failure StateMem's authors found most often.

### 5. Find small, read with context

Search finds single exchanges (one message and its reply), which LongMemEval found retrieve better than whole sessions. A single exchange can lose its surroundings, which is why MemOps found the opposite, so `read_memory` returns an exchange with its neighbours.

### 6. Small automatic recall, deep recall on request

Automatic recall stays small and precise because models use the middle of long contexts poorly (Lost in the Middle), and most messages don't need memory at all. Depth lives behind `recall` and `read_memory`, which the model calls when it knows it needs more. Recall shows each item in a fixed structure with its dates and status, because LongMemEval found structured results are read better.

### 7. Old periods are recalled as their gist

Automatic recall considers a day's episode only until its week is rolled up, and a week's until its month is. So its pool grows by about 12 month episodes a year instead of hundreds of days, and older periods surface as their gist, as they do for people. The detail is still there: a question that names a date reaches that day's episode, and `recall` and `read_memory` reach the exchanges. RAPTOR found searching all levels of a summary tree at once beat walking down it, so the hierarchy is a way to navigate, never a gate.

### 8. Old facts get rechecked

Upkeep only reads new conversation, so a fact nobody mentions again would stay "current" forever, even after it stopped being true. The nightly review checks the 20 facts that have gone longest without a check. At 20 a night, a store of 2,000 facts is fully reviewed every 100 days, at a fixed cost per night.

## How it stays good over time

| What grows     | Why it doesn't rot                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------- |
| The transcript | Pi stores it and reads it by entry range; the exchange index only ever appends.                   |
| Facts          | Capped in length; superseded rather than duplicated; rechecked on a rotation.                     |
| Core           | Fixed budget, chosen by code from importance and recent use, so it can't drift.                   |
| Episodes       | Automatic recall moves to rollups as periods age; days stay reachable by date and by tool.        |
| Nightly work   | Day batches, rollups and review are each bounded, and progress is saved after each step.          |
| Search time    | Facts and episodes are small enough to search directly; exchanges use an index that only appends. |

Two things check this rather than assume it:

- **The rot test** (`pnpm eval:recall`) asks rowan-v3's questions against its year of exchanges, then again with years of extra conversation added after it. No model is involved, so it runs in seconds. The line should stay flat.
- **Health numbers** (`GET /api/memory/health`) report from real data: fact counts, how full core is, facts unchecked for six months, episodes, exchanges indexed, and search times.

## What it deliberately doesn't do

| Not built                       | Why                                                                                                                                                                                               | What would change that                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `forget`                        | Deleting a fact can't remove what was said, because Pi can't erase transcript entries, so it would be a false promise. `retire` covers "no longer true"; the owner can revise or retire mistakes. | Pi gaining entry deletion, and a real need for erasure |
| A model-facing `remember`       | One writer (decision 2)                                                                                                                                                                           | Explicit requests being missed in daily use            |
| Decay beyond recency ranking    | No evidence it improves answers                                                                                                                                                                   | An eval showing it would                               |
| Embeddings                      | Keyword search with dates hasn't been shown to fall short                                                                                                                                         | The rot test missing answers that use other words      |
| A stored or host-specific index | The in-memory index is rebuilt from the transcript, so it can't disagree with it                                                                                                                  | Index build or search time in the health numbers       |
| An entity graph                 | Few failures need chains of facts                                                                                                                                                                 | Multi-session questions failing in the eval            |
