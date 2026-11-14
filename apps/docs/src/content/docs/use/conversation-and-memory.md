---
title: Conversation and memory
description: How Familiar's single conversation works, what it remembers and how to correct it.
---

## One conversation

Familiar has one conversation. It never starts a new chat. Every device shows the same messages, and replies stream to all of them as they're written. If the computer restarts in the middle of a reply, Familiar finishes the work it had started when it comes back.

You can send while a reply is still running. Your message waits until the current step finishes, then Familiar reads it. The stop button ends the current reply and withdraws any messages waiting behind it.

Long conversations don't fill up. When the model's context gets close to its budget, Familiar summarises older messages for the model. The chat keeps every message as it was.

## What it remembers

The conversation itself is the record, and every past exchange stays searchable, including ones the model no longer sees. Alongside it, Familiar keeps:

- **Pages**, one for each person or thing it knows about. A page holds **notes**: what is true of them beyond one conversation, such as who matters to them, how they like things done and what they intend. Each note quotes the message it came from and says who said it and where, so something Maya told Familiar about Theo stays marked as hers.
- A **profile** on each page, written from its notes: what Familiar should have in mind about them whatever the conversation is about.
- A **journal** of dated lines, each the key to the conversation it came from, so "when did I set up the digest?" or "what was going on in March?" finds it again.

Only people's own words become memory. Familiar's replies, other Familiars, reminders, tool results and web pages never do, and a note whose quote isn't in what someone said is thrown away.

Before each reply, Familiar sees the profile of each person it works with and a short list of everyone and everything else it knows about. It recalls notes and past conversations that look relevant to your message, and can search everything with its `recall` tool, by date, and open a page or a conversation with `read_memory`.

Filing happens each night at 04:00 in your time zone: Familiar files what people said that day, then rewrites the profile of each page whose notes changed. A note that something has changed replaces the old one, which stays findable in the conversation it came from.

Schedules aren't memory. Feedback about a recurring job, such as "include the links in my digest", changes that job's instructions, not what Familiar remembers.

[How memory works](/familiar/use/how-memory-works/) explains all of this in depth: what filing keeps and why, how it's checked, how a reply finds what it needs, and the research behind it.

## Review memory

Open a Familiar's settings and choose **Memory**. It has three tabs:

- **Subjects**: everyone and everything the Familiar keeps notes about, with the people who take part listed first. Open one to see its page: a **profile**, rewritten each night from the notes, then the **notes** themselves. Each note says since when it's been true, who said it and where, with a link to that conversation, and the words it rests on.
- **Journal**: dated lines by month, one per thing worth finding again. The Familiar searches them; they're never in its prompt.
- **Prompt**: exactly what the model sees before every reply: the profile of each person it works with, and a roster of everything else.

**Forget** removes a note. The page's profile is cleared until it is rewritten that night without the note.

Notes can't be edited. To correct something, tell the Familiar: that night's filing writes the newer value and removes the note it replaces.

Everyone who uses the same Familiar shares its memory. On an installed Familiar, that's you.

## Models and reasoning

**Settings › Models** sets the default chat model, which Familiars answer with, and the default memory model, which files and profiles their conversations. A smaller memory model costs less. Each Familiar follows the defaults unless its own settings' **Models** gives it its own; **Default** there returns it to the workspace's.

The model picker in the composer chooses the chat model and its reasoning level, and picking a model gives that Familiar its own. The choice is saved with the Familiar, so every device uses it.
