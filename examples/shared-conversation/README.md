# Shared conversation example

Three people, one Familiar and one conversation, running entirely in the browser. [Try it in the docs](https://aidanzealley.github.io/familiar/examples/shared-conversation/).

From the repository root:

```sh
pnpm install
pnpm --filter @familiar-example/shared-conversation dev     # Vite dev server on your LAN and tailnet
pnpm --filter @familiar-example/shared-conversation build   # Static files in dist/
```

## How it fits together

- `src/demo/demo.ts` opens one Familiar over `MemoryStorage` and serves it with `createHttpApi`. The host owns the sessions: `authenticate` maps each request's token to an `Author`, and that is the author of any message the request sends. Nothing in the request body can change it. Its `allow` permits only sending, history, stopping a reply and the conversation's events; every other operation answers 403.
- Each person signs in to a session token and their own client store, whose `fetch` sends that token with every request and opens its own event stream. Every client mirrors the same conversation, so the page shows one transcript. **Send as** picks whose suggestions and message box are in front, so a message always goes through its sender's session.
- `src/demo/plugin.ts` has two tools, `who_am_i` and `count_me_in`. Neither takes a name. Both read `api.author`, which Familiar resolves from the message that started the run, so a message sent while someone else's reply is running still runs as its own sender.

Reloading the page, or pressing **Reset**, starts again.

## The scripted model

Only the model is fake. `src/demo/script.ts` uses core's `scriptedModels` to answer a few exact phrases:

- `Note for the group: …` gets an acknowledgement naming the sender.
- `What did Ana say?` quotes Ana's latest earlier message, found in the input Familiar sent the model. That is the conversation's context, not long-term memory.
- `Who am I?` and `Count me in` call the tools, and the reply repeats the tool's output.

Anything else gets a reply listing what the script understands. Nothing outlasts the page.

## Not shown

The sessions are simulated in one page. Other tabs and visitors don't join, and there is no real sign-in. In a real app, each person's browser signs in to your host, which authenticates each request and returns the author from `createHttpApi`'s `authenticate`, as [Serve the API](https://aidanzealley.github.io/familiar/build/serve-the-api/) describes. To use a real model, run Familiar on that server and register a provider there (see [Models and sign-in](https://aidanzealley.github.io/familiar/build/models-and-sign-in/)), so credentials never reach the browser.

`src/components/ui` comes from the shadcn CLI (`pnpm dlx shadcn@latest add ...`), including the [chat components](https://ui.shadcn.com/docs/ai-elements/base/chat) Familiar's web UI uses. Update it through the CLI rather than by hand.
