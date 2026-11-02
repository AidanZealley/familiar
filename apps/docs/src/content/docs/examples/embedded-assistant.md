---
title: Embedded assistant
description: Familiar embedded in an app with tools over the app's own data. Example coming soon.
---

:::note[Coming soon]
A running demo and its source arrive in a later update. This page describes what the example will show.
:::

This example embeds Familiar in a small shopping-list app. The app keeps its own list. Familiar gets tools to read and change it, and the chat sits beside the list in the app's own UI.

It will show:

- a plugin whose tools call the host's data, with `api.author` used for permission checks
- tool `details` that the UI renders as list changes, with the text output as a fallback
- a persona that fits the app, and only the route groups the app needs

Until the example lands, [Customise your assistant](/familiar/build/customise/) covers plugins, tools and details, and [Serve the API](/familiar/build/serve-the-api/) covers choosing route groups.
