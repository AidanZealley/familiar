---
title: Conversation and memory
description: How Familiar's single conversation works, what it remembers and how to correct it.
---

## One conversation

Familiar has one conversation. It never starts a new chat. Every device shows the same messages, and replies stream to all of them as they're written. If the computer restarts in the middle of a reply, Familiar finishes the work it had started when it comes back.

You can send while a reply is still running. Your message waits until the current step finishes, then Familiar reads it. The stop button ends the current reply and withdraws any messages waiting behind it.

Long conversations don't fill up. When the model's context gets close to its budget, Familiar summarises older messages for the model. The chat keeps every message as it was.

## What it remembers

Familiar keeps its own notes alongside the conversation:

- **Facts** are lasting things about you and your life, each dated from when it became true.
- **Episodes** are summaries of what happened each day, rolled up into weeks and months.
- **Past exchanges** stay searchable, including ones the model no longer sees.

Before each reply, Familiar recalls facts, episodes and past exchanges that look relevant. It can also search memory with its `recall` and `read_memory` tools when you ask about something specific.

The filing happens overnight. At 04:00 in your time zone, Familiar files lasting facts from the day's conversation, writes the day's episode, rolls episodes up into weeks and months and reviews older facts. Something you said this afternoon is in the conversation straight away. It becomes a fact the next morning.

## Review and correct memory

Open **Memory** in the header.

- **Facts** groups facts into **Pinned**, **Core** and **Reserve**. Core facts are read before every reply. Reserve facts come in when they seem relevant. Pinned facts stay in core whatever their importance.
- Use a fact's menu to edit it, pin or unpin it or retire it. Editing saves a new version that is true from today. Retiring marks it no longer true. Familiar treats your correction as the source.
- **History** shows how facts changed over time.
- **Episodes** lists the daily, weekly and monthly summaries.

Everyone who uses the same Familiar shares its memory. On an installed Familiar, that's you.

## Models and reasoning

The model picker in the composer chooses the chat model and its reasoning level. The choice is saved with the conversation, so every device uses it. Nightly upkeep always runs on the model Familiar was set up with.
