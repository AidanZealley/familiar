# Extensions

Familiar should be easy to give new tools without changing core, at three levels: developers write plugins in code, the owner connects services from a page, and later Familiar writes small tools for itself. Today the only way in is `summonFamiliar`'s `extensions` option: a host embedding core can pass Pi extensions, but the daemon offers no way to add one without editing the repo, and an extension that needs an API key has nowhere safe to keep it.

Known decisions:

- **A plugin is a named factory for a Pi extension**, given a small context: its secrets, the clock, and `notify`. It is the one interface for everything that isn't core: first-party extras such as web search, calendar and Home Assistant use it exactly as third parties would. Pi's extension (tools, sections, hooks, tasks) stays the unit of behaviour; the plugin only adds what Familiar provides around it.
- **Core stays minimal**: persona, time, conversation, memory, schedules, and the machinery in this spec. Everything else is a plugin.
- **First-party plugins are workspace packages**, `packages/plugin-<name>` published as `@familiar/plugin-<name>`. They follow the package rules (portable, no `node:*`), so a Cloudflare host can install them too. `pnpm-workspace.yaml` lists packages one by one, so each needs a line there. The daemon installs every first-party plugin; hosts like Gatherbot choose their own list.
- **Secrets never reach the model.** A plugin reads its secrets through its context, in tool code. The model sees tool names, arguments and results, never a secret's value, so no conversation can make it reveal one. Secrets are set on a Connections page through write-only routes, never in chat: anything said in chat is stored in the transcript for good.
- **The host stores secrets**, as it stores the login: the daemon in its data directory, a Cloudflare host in its own storage. Core asks through a `secrets` option.
- **Code plugins are trusted like the daemon.** They run in its process with its permissions, so they can read the data directory; only the owner installs them. The README's rule that tools never see the data directory is about tools the model drives (files, shell), and still holds.
- **MCP is how the owner connects services without code.** An MCP server's tools become Pi tools marked `deferred: true`, found through Pi's `tool_search` (pi-durable README, "Who may call a tool"), so a large server costs no context until it's used. Home Assistant's MCP Server integration and a future Gather MCP server both arrive this way.
- **Results from plugins and MCP servers are untrusted text.** A web page, an email or an event description can carry instructions. Confirmation before actions is a later step (see Later); until then, the owner chooses what to connect.

Do the steps in order and commit each separately.

## 1. Plugins and secrets in core

A new capability folder, `packages/core/src/plugins/`.

1. **The types.**

   ```ts
   type FamiliarPlugin = {
     name: string // 'web'; its extension is named 'familiar.plugin.web'
     title: string // 'Web search', for the Connections page
     secrets?: { name: string; label: string; help?: string }[]
     extension: (context: PluginContext) => Extension
   }

   type PluginContext = {
     /** The secret's value, or a thrown error the model reads as "not connected". */
     secret(name: string): Promise<string>
     now(): number
     notify(notification: Notification): Promise<void>
   }
   ```

   Export `definePlugin` (an identity function, for inference) and the types from `@familiar/core`. `secret()` throws `<title> isn't connected. Ask the owner to add <label> on the Connections page.` when the value is missing, so every plugin reports it the same way without its own check.

2. **The host's store.** `secrets?: SecretStore` on `FamiliarOptions`, with `get(plugin, name)`, `set(plugin, name, value)` and `delete(plugin, name)`, all async. Without one, every `secret()` throws as above.
3. **`plugins` replaces `extensions`** on `FamiliarOptions`. `familiar.ts` installs each plugin's extension after core's. Move the demo's extensions into a plugin.
4. **Redaction, as a second line of defence.** A core `afterTool` hook replaces any secret value of eight or more characters found in a tool's `output`, `structuredOutput` or `details` with `[secret]`, so a plugin that echoes a URL in an error can't leak it. Load values from the store when the hook runs; cache them in memory and update the cache when the owner API sets or deletes one.
5. **Owner API and routes.** `familiar.connections.list()` returns each plugin's name, title and secrets as `{ name, label, help, set: boolean }`, never values. `PUT /api/connections/:plugin/secrets/:name` with `{ value }` and `DELETE` on the same path. Add the wire types to `http.ts`.
6. **The daemon's store**, in `apps/daemon/src/secrets.ts`: `secrets.json` in the data directory, mode 0600, written atomically. The export in [easy install](easy-install.md) leaves it behind, like the login.
7. **The daemon's plugin list**, in one place in `apps/daemon`: the first-party plugins, plus any modules named in `FAMILIAR_PLUGINS` (comma-separated package names or absolute paths, each default-exporting a `FamiliarPlugin`). When easy install's `settings.json` exists, read the same list from its `plugins` field.

Tests, with the faux provider and a test plugin whose tool uses a secret:

- With the secret set, the tool works; its result never contains the value, even when the tool returns it.
- Without it, the model gets the "isn't connected" error result.
- The list route reports `set: true` and no value; after `DELETE`, `set: false` and the tool fails again.
- A plugin's extension is installed after core's and is active on the first request.

Done when the tests pass, the demo runs with its plugin, and the README's Layout and Rules describe plugins and secrets.

## 2. The Connections page

In `apps/web`, a Connections page listing each plugin with secrets: its title, and for each secret a password field with Save and Clear, showing whether it's set. It never shows a value. Plugins without secrets are listed as built in, without fields.

Done when, on the demo, setting the test plugin's secret on the page makes its tool work in chat, and clearing it makes the tool report that it isn't connected.

## 3. MCP connections

A core capability folder, `packages/core/src/mcp/`. It lives in core, not in a plugin, because it installs extensions into the registry while Familiar runs.

1. **The document.** `McpServers`: a list of `{ name, url }`. A server's bearer token, if any, is a secret of the `mcp` connection named after the server. The document travels with an export; the token stays behind.
2. **The bridge.** For each server: connect with the MCP TypeScript SDK's client over Streamable HTTP, list its tools, and install an extension `familiar.mcp.<name>` with one deferred tool per MCP tool, named `mcp__<name>__<tool>`, its input schema passed through as JSON Schema, and the MCP tool's description. A call runs `callTool` and maps text and image content to Pi's output; an MCP error result becomes an error result. On `notifications/tools/list_changed`, reinstall the server's extension (pi-durable README, "Reload").
3. **Tool search.** Install `createToolSearchExtension()` from `@earendil-works/pi-durable/tool-search` once, so the model can find and load MCP tools.
4. **Failures.** A server that can't be reached gets an extension with no tools and a status the Connections page shows. Retry on the next start and when the owner presses Reconnect. A call whose session dropped reconnects once before failing.
5. **Owner API and routes.** `familiar.mcp.add({ name, url })`, `remove(name)` and `reconnect(name)`, and their routes. `familiar.connections.list()` includes each server with its status, its tool count, and which tools declare `readOnlyHint`.
6. **Portability.** The SDK's client must not pull `node:*` into `packages/core`; ESLint will say. If it does, the bridge takes the transport from a host option instead. Either way, the bridge accepts a transport factory, so tests can use the SDK's in-memory transport.
7. **The Connections page** gains an MCP section: add a server (name, URL, optional token), remove it, reconnect it, and see its status and tools.

Tests, with the faux provider and an in-memory MCP server exposing `echo` and `add`:

- The model calls `tool_search`, loads `mcp__test__echo` and calls it; the result is the server's.
- Before loading, the request's tools don't include the server's tools.
- A server that adds a tool and sends `list_changed` makes it searchable without a restart.
- Removing the server removes its tools; close and reopen restores a server that was added.
- An unreachable server reports its status and doesn't stop Familiar starting.

Done when the tests pass and, on the demo, adding the in-memory server from the page (behind a demo-only URL) makes its tools usable in chat.

## Later

Not part of this spec; each needs its own before starting.

- **Confirmation.** A `beforeTool` hook that holds a call for the owner's approval, with AI Elements' Confirmation in the chat. Start with MCP tools that don't declare `readOnlyHint`, and with any fetch after the model has read external content.
- **Tools Familiar writes itself.** Pi's code mode (`@earendil-works/pi-durable/codemode`) runs model-written JavaScript in a QuickJS sandbox that reaches the world only through Familiar's tools. A saved script with a name, a description and parameters becomes a tool, stored in a document and installed at runtime. Because the sandbox has no file or network access of its own, this stays inside the data directory rule.
- **Skills.** Instruction-only `SKILL.md` folders (the agentskills.io format OpenClaw and Hermes use), listed in a section and loaded with a `use_skill` tool. Without a shell they are mostly named procedures, so wait until there's a need memory doesn't meet.
- **MCP OAuth**, for servers that don't accept a token.
