# Shared conversation example

Three people, one Familiar and one conversation, running entirely in the browser. [Try it in the docs](https://aidanzealley.github.io/familiar/examples/shared-conversation/).

From the repository root:

```sh
pnpm install
pnpm --filter @familiar-example/shared-conversation dev     # Vite dev server on your LAN and tailnet
pnpm --filter @familiar-example/shared-conversation build   # Static files in dist/
```

## How it fits together

- `src/demo/demo.ts` opens one Familiar over `MemoryStorage` and mounts the conversation and event routes behind a sign-in check. The host owns the sessions: each token maps to an `Author`, and that is the author of any message the request sends. Nothing in the request body can change it.
- `signIn` gives each person a session token and their own client store, whose `fetch` sends that token with every request and opens its own event stream. Every client mirrors the same conversation, so the page shows one transcript, read through the first client. **Send as** picks whose suggestions and message box are in front; each person's are bound to their own client and keep their own draft, so a message always goes through the session of the person who sent it.
- `src/demo/plugin.ts` has two tools, `who_am_i` and `count_me_in`. Neither takes a name. Both read `api.author`, which Familiar resolves from the message that started the run, so a message sent while someone else's run is going still runs as its own sender.
- Each message keeps the author it was sent with. If a person's name changes on the host, their earlier messages keep the old name; the `id` stays the same.

Reloading the page, or pressing **Reset**, closes every client, ends the sessions and starts a new Familiar.

## The scripted model

Only the model is fake. `src/demo/script.ts` registers a faux provider that answers a few exact phrases:

- `Note for the group: …` gets an acknowledgement naming the sender, read from the message's author line.
- `What did Ana say?` quotes Ana's latest earlier message, found in the input Familiar sent the model. That is the conversation's context, not long-term memory.
- `Who am I?` and `Count me in` call the tools, and the reply repeats the tool's output.

Anything else, including negated or combined requests, gets a reply listing what the script understands. Memory recall and upkeep run, but the script gives them a placeholder answer, so the demo shows nothing about long-term memory. Nothing outlasts the page.

## Not shown

The sessions are simulated in one page. Other tabs and visitors don't join, and there is no real sign-in. In a real app, each person's browser signs in to your host, which authenticates each request and returns the author from `createHttpApi`'s `authenticate`, as [Serve the API](https://aidanzealley.github.io/familiar/build/serve-the-api/) describes. To use a real model, run Familiar on that server and register a provider there (see [Models and sign-in](https://aidanzealley.github.io/familiar/build/models-and-sign-in/)), so credentials never reach the browser.

`src/components/ui` comes from the shadcn CLI (`pnpm dlx shadcn@latest add ...`), including the [chat components](https://ui.shadcn.com/docs/ai-elements/base/chat) Familiar's web UI uses. Update it through the CLI rather than by hand.
