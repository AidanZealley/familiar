---
title: Conversation and memory
description: How DMs and rooms work, what a Familiar remembers and how to correct it.
---

## Familiars, DMs and rooms

You can have several Familiars. Each has a DM with you, and named rooms hold one or more of them. In a room, a message goes to the Familiars you @mention, or to all of them if you mention none, and each decides whether to reply.

A Familiar keeps one working context across all its rooms, so what you tell it in a DM can come up elsewhere. Every device shows the same rooms, and replies stream to all of them. If the computer restarts mid-reply, Familiar finishes the work when it's back.

You can send while a reply is running; your message waits its turn. **Stop** ends the room's current replies.

Long conversations don't fill up. Familiar summarises older messages for the model, and the chat keeps every message as it was.

## What it remembers

The conversation itself is the record, and every past exchange stays searchable, including ones the model no longer sees. Alongside it, Familiar keeps:

- **Pages**, one for each person or thing it knows about. A page holds **notes**: what is true of them beyond one conversation, such as who matters to them, how they like things done and what they intend. Each note quotes the message it came from and says who said it and where, so something Maya told Familiar about Theo stays marked as hers.
- A **profile** on each page, written from its notes: what Familiar should have in mind about them whatever the conversation is about.
- A **journal** of dated lines, each the key to the conversation it came from, so "when did I set up the digest?" or "what was going on in March?" finds it again.

Only people's own words become memory. Familiar's replies, other Familiars, reminders, tool results and web pages never do, and a note whose quote isn't in what someone said is thrown away.

Before each reply, Familiar sees the profile of each person it works with and a short list of everyone and everything else it knows about. It recalls notes and past conversations that look relevant to your message, and can search everything with its `recall` tool, by date, and open a page or a conversation with `read_memory`.

Filing happens each night at 04:00 in your time zone: Familiar files what people said that day, then rewrites the profile of each page whose notes changed. A note that something has changed replaces the old one, which stays findable in the conversation it came from.

Schedules aren't memory. Feedback about a recurring job, such as "include the links in my digest", changes that job's instructions, not what Familiar remembers.

[How memory works](/familiar/use/how-memory-works/) explains the design in depth.

## Review memory

Open a Familiar's settings and choose **Memory**. It has three tabs:

- **Subjects**: everyone and everything the Familiar keeps notes about, with the people who take part listed first. Open one to see its page: a **profile**, rewritten each night from the notes, then the **notes** themselves. Each note says since when it's been true, who said it and where, with a link to that conversation, and the words it rests on.
- **Journal**: dated lines by month, one per thing worth finding again. The Familiar searches them; they're never in its prompt.
- **Prompt**: exactly what the model sees before every reply: the profile of each person it works with, and a roster of everything else.

**Forget** removes a note. The page's profile is cleared until it is rewritten that night without the note.

Notes can't be edited. To correct something, tell the Familiar: that night's filing writes the newer value and removes the note it replaces.

Everyone who uses the same Familiar shares its memory. On an installed Familiar, that's you.

## Models and reasoning

**Settings › Models** sets the default chat model, which Familiars answer with, and the default memory model, which files and profiles their conversations, each with its reasoning level. A smaller memory model costs less. Each Familiar follows the defaults unless its own settings' **Models** gives it its own; **Default** there returns it to the workspace's.

The model picker in the composer chooses the chat model and its reasoning level, and picking a model gives that Familiar its own. A reasoning level picked there or in its settings is remembered for that model, and stays when the default level changes. The choices are saved with the Familiar, so every device uses them.
