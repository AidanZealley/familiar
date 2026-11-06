---
title: Extend your Familiar
description: Write your own tools in TypeScript and add them to the installed Familiar.
---

[MCP servers](/familiar/use/tools-and-connections/#mcp-servers) are the easiest way to give Familiar more tools. If you'd rather write a tool yourself, add a plugin: a TypeScript file in your Familiar's plugins folder. Write one when you want:

- private code that only runs on your own computer
- a secret, such as an API token, that Familiar keeps and sends for the tool
- no separate server to run

## Set up the plugins folder

`familiar status` shows where it is. It's `plugins` in the [data directory](/familiar/use/settings-and-maintenance/#your-data), and Familiar creates it when it starts.

The folder is a small Node project of your own. Install what plugins import:

```sh
cd ~/.local/share/familiar/plugins    # the path familiar status shows
npm init -y
npm install @familiar-ai/core
```

Familiar loads every `.ts` and `.js` file directly in this folder when it starts. Each one default-exports one plugin. Put shared code and anything else in subfolders, which Familiar doesn't load.

## A first plugin

Save this as `hello.ts`:

```ts
import { definePlugin, defineTool, familiar, Type } from '@familiar-ai/core'

export default definePlugin({
  name: 'hello',
  title: 'Hello',
  tools: [
    defineTool({
      name: 'hello',
      description: 'Greet the person who asked.',
      parameters: Type.Object({}),
      replay: 'safe',
      execute: async (_args, _api, context) => {
        const author = await familiar(context).author()
        return {
          output: [
            { type: 'text', text: `Hello, ${author?.name ?? 'there'}!` },
          ],
        }
      },
    }),
  ],
})
```

Then restart Familiar and ask it to say hello:

```sh
familiar restart
```

Node runs TypeScript directly, so there's no build step. Write `import type` for imports that are only types.

## A plugin with a secret

A plugin can declare secrets, such as an API token. You paste the value on the **Connections** page. Familiar keeps it and adds it to a request only if the request goes exactly where the plugin declared. The plugin's code never sees it:

```ts
import { definePlugin, defineTool, familiar, Type } from '@familiar-ai/core'

const API = 'https://api.tasks.example'

export default definePlugin({
  name: 'tasks',
  title: 'Tasks',
  secrets: [
    {
      name: 'token',
      label: 'Tasks API token',
      sendAs: {
        header: 'Authorization',
        prefix: 'Bearer ',
        origin: API,
        requests: [{ method: 'GET', path: '/v1/tasks' }],
      },
    },
  ],
  tools: [
    defineTool({
      name: 'list_tasks',
      description: 'List my open tasks.',
      parameters: Type.Object({}),
      replay: 'safe',
      execute: async (_args, _api, context) => {
        const response = await familiar(context).authorizedFetch(
          'token',
          `${API}/v1/tasks`,
        )
        return { output: [{ type: 'text', text: await response.text() }] }
      },
    }),
  ],
})
```

Keep a plugin's `name` the same once you've set its secret: the secret is saved under it.

## What a tool can use

`familiar(context)` gives each call:

- `fetch(url)`: requests that need no secret. It refuses addresses on your own network, so a tool can't be talked into reaching your router or other devices.
- `authorizedFetch(secret, url)`: the same, with a declared secret added.
- `author()`: who asked, read from the conversation, never from the tool's arguments.
- `notify(notification)`: a notification on your devices.
- `timeZone`: your time zone.

The [Plugin API](/familiar/reference/plugins/) has the details.

## When something's wrong

If a plugin file fails to load, or clashes with another plugin, such as sharing its name or a tool name, Familiar skips it and keeps running. `familiar logs` shows which file and why. Fix it and run `familiar restart`.

## Trust

A plugin runs inside Familiar with the same permissions as Familiar itself. It can read your files and use the network like any program you run. Only add code you wrote or would run yourself.

Your plugins live in the data directory, so a copy of the data directory includes them.

## Outgrowing the installed Familiar

If you want your own UI, your own sign-in or several people with their own accounts, build your own server from the same pieces. The [Node server example](/familiar/examples/node-server/) is a starting point, and your plugin files work there unchanged.
