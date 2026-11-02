---
title: Shared conversation
description: Several people talking to one Familiar in one conversation. Example coming soon.
---

:::note[Coming soon]
A running demo and its source arrive in a later update. This page describes what the example will show.
:::

This example puts several people in one conversation with one Familiar, such as a household planning a week together. It builds on behaviour Familiar already has:

- Each person's host session supplies their `Author`, so every message keeps a stable `id` and display `name`. The model sees who said what.
- Everyone shares the conversation and its memory. Facts one person mentions are available when another asks.
- Tools see the person who started each run through `api.author`, so a host can check that person's permissions.
- A scheduled reply notes its creator, and the transcript shows it as a `scheduled` item with `creator`.

Until the example lands, [Serve the API](/familiar/build/serve-the-api/) shows how to authenticate each request as a different author, and [Connect a frontend](/familiar/build/connect-a-frontend/) shows how each person's browser mirrors the same conversation.
