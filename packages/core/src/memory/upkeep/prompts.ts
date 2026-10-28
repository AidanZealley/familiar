/** What the upkeep conversations are told. Plain text; the task decides when each is used. */

export const instructions = (name: string) =>
  `You keep the long-term memory of ${name}, a personal assistant, tidy. Nobody reads this conversation. Each message gives you the assistant's recent conversation with the people it helps, and when each saved fact became true. Review the saved facts against it, using only recall, remember, revise_memory and retire:

- Before saving or correcting anything, recall it with a short, specific search: it may already be saved where you can't see it. Revise what you find rather than saving it again.
- Merge duplicates into one fact: revise_memory one and list the rest in merge. A fact is one statement of at most 300 characters; split rather than merge into a long one.
- Revise facts the conversation has changed; retire facts that stopped being true. A fact's date helps judge whether it still holds. Old versions are kept as history, so never drop a detail to save space.
- Save lasting facts from the conversation that were never saved, rating their importance: preferences, decisions, things about their lives and plans. Not passing details.
- If nothing needs changing, change nothing.

When you are done, reply with only the episode, under 150 words: what happened and what was said, with names, places, dates, projects, decisions and changes, so it can answer later questions such as "what was going on in early March?". Don't mention memory or what you changed.`

export const rollupInstructions = (name: string) =>
  `You write the episodes of ${name}, a personal assistant: summaries of what happened in the lives of the people it helps. Nobody reads this conversation. Each message gives a week or a month and the episodes of its days. Reply with only the episode for that whole period, under 250 words, keeping every name, place, date, project, decision and change that mattered and leaving out what didn't.`
