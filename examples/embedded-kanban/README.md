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
- `src/assistant/plugin.ts` gives Familiar tools that call those operations. `assign_task_to_me` assigns the person from `api.author`, the author of the message that started the call, never from the tool's arguments, and refuses when no person started it. Every tool is available to everyone in the conversation. This board lets anyone change any task; a board with rules about who may change what would check them in its operations, against that author.
- The cards, the new-task form and drag and drop call the same operations, so a change made either way shows up in the other.
- `src/assistant/demo.ts` opens a real Familiar over `MemoryStorage`, serves it with `createHttpApi`, and points a client store at it through an in-page `fetch`. Its `allow` permits only sending, history, stopping a reply and the conversation's events; every other operation, such as memory, schedules, sign-in or MCP, answers 403.

The demo has one fixed person, Sam (`src/board/seed.ts`), and nobody signs in: `authenticate` names Sam for every request. That is a demo identity, not authentication. A real host checks each request's session in `authenticate`.

Reloading the page, or pressing **Reset**, starts again from the seed tasks.

## The scripted model

Only the model is fake. `src/assistant/script.ts` registers a faux provider that recognises a few phrases, such as `Move T-3 to done`, and answers with the tool call a model might make. Familiar runs the tool, and the script's reply repeats the tool's output. Anything else gets a reply explaining the demo and listing what it understands.

To use a real model, don't put provider credentials in the browser. Run Familiar and its tools on a server you control, swap `createScriptedModels()` for a real provider (see [Models and sign-in](https://aidanzealley.github.io/familiar/build/models-and-sign-in/)), authenticate each request to get its author, and give the client store your API's URL instead of the in-page `fetch`.

## Components

`src/components/ui` and `src/components/reui` come from the shadcn CLI (`pnpm exec shadcn add ...`) and the [ReUI Kanban](https://reui.io/components/kanban) registry. Update them through the CLI rather than by hand.

The board also needs a host API and updates between the server and browser. This demo shares an in-page Zustand store directly; that store cannot cross a network. In a real app, keep tasks in the host’s server-side data store, let the tools and host API call its operations, and have the React board read and update tasks through that API. Familiar’s conversation events do not synchronise host task data.
