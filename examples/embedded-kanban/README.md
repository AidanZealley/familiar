# Embedded kanban example

A small task board with Familiar beside it, running entirely in the browser. [Try it in the docs](https://aidanzealley.github.io/familiar/examples/embedded-assistant/).

From the repository root:

```sh
pnpm install
pnpm --filter @familiar-example/embedded-kanban dev     # Vite dev server on your LAN and tailnet
pnpm --filter @familiar-example/embedded-kanban build   # Static files in dist/
```

## How it fits together

- `src/board/board.ts` owns the tasks. Its operations, `create`, `assign` and `move`, are the only way tasks change.
- `src/assistant/plugin.ts` gives Familiar tools that call those operations. `assign_task_to_me` takes the person from `api.author`, the author of the message that started the call, never from its arguments.
- The cards, the new-task form and drag and drop call the same operations, so a change made either way shows up in the other.
- `src/assistant/demo.ts` opens a real Familiar over `MemoryStorage`, serves it with `createHttpApi`, and points a client store at it through an in-page `fetch`. Its `allow` permits only sending, history, stopping a reply and the conversation's events; every other operation answers 403.

The demo has one fixed person, Sam (`src/board/seed.ts`), and nobody signs in: `authenticate` names Sam for every request. A real host checks each request's session there.

Reloading the page, or pressing **Reset**, starts again from the seed tasks.

## The scripted model

Only the model is fake. `src/assistant/script.ts` uses core's `scriptedModels` to answer a few phrases, such as `Move T-3 to done`, with the tool call a model might make, then repeats the tool's output. Anything else gets a reply listing what it understands.

## Not shown

Everything runs in one page. In a real app, Familiar, its tools and the board's data live on your server: the tools and your own API call the board's operations there, and the React board reads and changes tasks through that API. Familiar's events carry the conversation, not your data. To use a real model, register a provider on that server (see [Models and sign-in](https://aidanzealley.github.io/familiar/build/models-and-sign-in/)), so credentials never reach the browser.

`src/components/ui` and `src/components/reui` come from the shadcn CLI and the [ReUI Kanban](https://reui.io/components/kanban) registry. Update them through the CLI rather than by hand.
