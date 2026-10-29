# Extensions

Familiar should be easy to give new tools without changing core, at three levels: developers write plugins in code, the owner connects services from a page, and later Familiar writes small tools for itself. Before this work, the only way in was `summonFamiliar`'s `extensions` option: a host embedding core could pass Pi extensions, but the daemon offered no way to add one without editing the repo, and an extension that needs an API key had nowhere safe to keep it.

Known decisions:

- **A plugin is a named factory for a Pi extension**, given a small context: the clock, `notify`, a guarded `fetch`, and `authorizedFetch` for requests that carry its secrets. It is the one interface for everything that isn't core: first-party extras such as web search, calendar and Home Assistant use it exactly as third parties would. Pi's extension (tools, sections, hooks, tasks) stays the unit of behaviour; the plugin only adds what Familiar provides around it.
- **Core stays minimal**: persona, time, conversation, memory, schedules, and the machinery in this spec. Everything else is a plugin.
- **First-party plugins are workspace packages**, `packages/plugin-<name>` published as `@familiar/plugin-<name>`. They follow the package rules (portable, no `node:*`), so a Cloudflare host can install them too. `pnpm-workspace.yaml` lists packages one by one, so each needs a line there. The daemon installs every first-party plugin; hosts like Gatherbot choose their own list.
- **Credentials are attached outside plugin code.** A secret declares its header, exact HTTPS origin and allowed requests. Core's `authorizedFetch` checks those before loading and attaching the key, with redirects unfollowed. Keys enter through write-only Connections routes. Optional host protection masks known values in responses and tool output; encoded values or credentials read through other host capabilities are outside that promise. Plugins remain trusted code in the host's process.
- **What that does and doesn't protect.** It stops careless plugin code and prompt injection from revealing a key. It doesn't stop a prompt-injected model from _using_ a connected service within its declared requests, or from leaking private data through searches and public fetches; that is confirmation's job (see Later). It doesn't stop a malicious plugin either, which runs in the host's process (below).
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
     secrets?: PluginSecret[]
     extension: (context: PluginContext) => Extension
   }

   type PluginSecret = {
     name: string // 'braveApiKey'
     label: string // 'Brave Search API key'
     help?: string
     /** Where authenticated requests may send it. */
     sendAs: {
       header: string // 'X-Subscription-Token'
       prefix?: string // 'Bearer ' for an Authorization header
       origin: string // 'https://api.search.brave.com', exactly
       requests: { method: string; path: string }[] // [{ method: 'GET', path: '/res/v1/web/search' }]
     }
   }

   type PluginContext = {
     now(): number
     notify(notification: Notification): Promise<void>
     /** The host's guarded fetch, for public URLs; see below. Never carries a secret. */
     fetch(input: string | URL, init?: RequestInit): Promise<Response>
     /** A request that carries the named secret, made only where it declares. */
     authorizedFetch(
       secret: string,
       input: string | URL,
       init?: RequestInit,
     ): Promise<Response>
   }
   ```

   Export `definePlugin` (an identity function, for inference) and the types from `@familiar/core`. `summonFamiliar` refuses a plugin whose secret's `origin` isn't an exact `https:` origin or that declares no requests.

   `authorizedFetch` makes the request through the host's `fetch` only if all of these hold, and otherwise throws without sending anything:
   - the secret is one the plugin declares;
   - the URL's origin (scheme, host and port) equals `origin` exactly, so no subdomains, and it has no username or password;
   - the method and the URL's path exactly match one of `requests`;
   - the caller didn't set the secret's header or `Host`.

   It sets the header to `prefix` plus the value and asks for `redirect: 'manual'`, so a redirect comes back to the plugin as a response and the secret is never sent anywhere else. Responses pass through unchanged unless the host enables the optional protection layer. Secrets go in headers only: a key in a query string spreads into logs, errors and redirects. When the value is missing it throws `<title> isn't connected. Ask the owner to add <label> on the Connections page.`, so every plugin reports it the same way without its own check. Services that need request signing (AWS SigV4) or OAuth refresh get a dedicated adapter when one is needed, not access to the raw value.

   `fetch` is how plugins reach the network, so the host decides what they can reach. A model-chosen URL must not reach the host's own network: a web page could otherwise tell Familiar to read the owner's router or Home Assistant and pass the result on in its next search. So a host whose process can reach private, loopback, link-local or tailnet addresses must pass a `fetch` that refuses them, at connection time and on every redirect. A Cloudflare Worker can't reach private networks, so it passes its own `fetch`. The host passes it as `fetch?:` on `FamiliarOptions`, whose doc comment says this; without one, the context's `fetch` throws, rather than falling back to an unguarded one.

2. **The host's store.** `secrets?: SecretStore` on `FamiliarOptions`. Secrets belong to a connection, a plugin or (from step 4) an MCP server, so the kind is part of the key and a plugin and a server can share a name:

   ```ts
   type Connection = { kind: 'plugin' | 'mcp'; name: string }

   type SecretStore = {
     get(connection: Connection, secret: string): Promise<string | undefined>
     set(connection: Connection, secret: string, value: string): Promise<void>
     delete(connection: Connection, secret: string): Promise<void>
   }
   ```

   Core is the only thing that creates connections, so `kind` is a closed union; the host stores by it without interpreting it. Without a store, every secret is missing.

3. **`plugins` replaces `extensions`** on `FamiliarOptions`. `familiar.ts` installs each plugin's extension after core's. Move the demo's extensions into a plugin.
4. **Optional host protection.** Core accepts `protection?: PluginProtection`, a factory that decorates the host's credential store, fetch and plugin tools. `@familiar/protection` supplies `maskSecrets`; the daemon and demo enable it explicitly. Core and plugins do not import this package. It masks known keys of eight or more characters in response headers and streamed bodies, tool progress, results and errors. Values are learned through the decorated store and retained after replacement or deletion for in-flight calls. Stream masking happens before Pi commits output. This is best effort: encoded or short values can still appear, and plugins run as trusted host code. Hosts can omit it while keeping write-only Connections routes and destination-bound authenticated requests. Network filtering and incoming authentication remain separate host responsibilities.
5. **Owner API and routes.** `familiar.connections.list()` returns one list of connections, each `{ kind: 'plugin', name, title, secrets }` with secrets as `{ name, label, help, set: boolean }`, never values. Step 4 adds `kind: 'mcp'`. `PUT /api/connections/:kind/:name/secrets/:secret` with `{ value }` and `DELETE` on the same path. A value is stored exactly as it will be sent: trimmed, because headers trim it and redaction must look for what was sent, and refused (400) unless it is visible ASCII. Add the wire types to `http.ts`.
6. **The daemon's store**, in `apps/daemon/src/secrets.ts`: `secrets.json` in the data directory, nested by kind, name and secret (`{ "plugin": { "web": { "braveApiKey": "…" } } }`), mode 0600, written atomically. The export in [easy install](easy-install.md) leaves it behind, like the login.
7. **The daemon's guarded fetch**, in `apps/daemon/src/fetch.ts`: [`node-fetch`](https://github.com/node-fetch/node-fetch) with `agent: useAgent` from [`request-filtering-agent`](https://github.com/azu/request-filtering-agent), and at most five redirects. The agent checks each connection's resolved address inside `lookup` (so a name can't resolve to a public address for the check and a private one for the connection), checks literal IP addresses too, and allows only what `ipaddr.js` calls `unicast`, which excludes private, loopback, link-local, `100.64.0.0/10` (Tailscale) and `fc00::/7`. `useAgent` picks the agent per URL, so redirects across `http` and `https` are checked as well. Node's built-in `fetch` can't take an `http.Agent`, hence `node-fetch`.
8. **The daemon's plugin list**, in one place in `apps/daemon`: the first-party plugins, plus any modules named in `FAMILIAR_PLUGINS` (comma-separated package names or absolute paths, each default-exporting a `FamiliarPlugin`). When easy install's `settings.json` exists, read the same list from its `plugins` field.

Tests, with the faux provider and a test plugin whose tool uses a secret:

- With the secret set, a tool's request to its declared endpoint carries it in the declared header. A plain host receives the original response; a host using `maskSecrets` masks echoed keys in responses and tool output.
- `authorizedFetch` refuses, without calling the host's `fetch`: another origin, a subdomain, `http:`, a URL with credentials, another path or method, a caller-set header, and an undeclared secret. It asks for `redirect: 'manual'`.
- Without the secret, the model gets the "isn't connected" error result.
- The list route reports `set: true` and no value; after `DELETE`, `set: false` and the tool fails again.
- A plugin's extension is installed after core's and is active on the first request.
- The daemon's fetch refuses `127.0.0.1`, `10.0.0.1`, `100.100.1.1`, `[::ffff:127.0.0.1]` and `localhost`. (The agent's own tests cover DNS rebinding and redirects.)

Done when the tests pass, the demo runs with its plugin, and the README's Layout and Rules describe plugins and secrets.

## 2. The Connections page

In `apps/web`, a Connections page listing each plugin with secrets: its title, and for each secret a password field with Save and Clear, showing whether it's set. It never shows a value. Plugins without secrets are listed as built in, without fields.

Done when, on the demo, setting the test plugin's secret on the page makes its tool work in chat, and clearing it makes the tool report that it isn't connected.

## 3. Web search

The first real plugin, and the first use of a real secret: `packages/plugin-web`, published as `@familiar/plugin-web`, installed by the daemon. Its design follows the Pi community's web extensions ([pi-web-access](https://github.com/nicobailon/pi-web-access), [pi-web-lite](https://github.com/YoungJurry/pi-web-lite), [pi-web-research](https://github.com/wynainfo/pi-web-research) and Mario Zechner's [Brave skill](https://github.com/badlogic/pi-skills/tree/main/brave-search)), which agree on keeping search and reading as separate tools and on compact ranked results. None can be reused directly: they depend on Node and on unguarded fetches.

1. **The plugin.** Name `web`, title `Web search`, one secret: `braveApiKey`, labelled `Brave Search API key`, with help linking to Brave's API dashboard, sent as `X-Subscription-Token` to `GET https://api.search.brave.com/res/v1/web/search` only. Search goes through `context.authorizedFetch`.
2. **`web_search({ query, count?, freshness?, domains? })`.** `count` defaults to 5, at most 10. `freshness` is `day`, `week`, `month` or `year`. `domains` becomes `site:` terms in the query. Call Brave's web search API behind a small adapter that returns `{ title, url, published?, snippet }[]`, so another search service can be added later without touching the tool. Output: numbered results, each with title, exact URL, date when Brave gives one, and the snippet cut to 500 characters, under a line naming the service and the time; the whole output at most 8,000 characters. The same results go in `structuredOutput`, and the sources in `details` for the UI.
3. **The tool description** says search returns snippets rather than whole pages, and that results are untrusted text from the web.

Tests, with the faux provider and a stub `fetch`:

- `web_search` sends the key in Brave's header, returns compact numbered results, and caps the output.
- Without the key, the model gets the "isn't connected" error result.
- The plugin imports no `node:*` (ESLint).

Done when the tests pass and, on the owner's own Familiar, setting the key on the Connections page lets it search. The owner does that check; agents don't message the real Familiar.

Web fetch is separate follow-up work, preserved on `feat/web-fetch`. This branch includes search only.

## 4. MCP connections

A core capability folder, `packages/core/src/mcp/`. It lives in core, not in a plugin, because it installs extensions into the registry while Familiar runs.

1. **The document.** `McpServers`: a list of `{ name, url, auth: { type: 'none' } | { type: 'bearer' } }`. A bearer server's token is stored at `({ kind: 'mcp', name }, 'token')` in the secret store. It is sent the same way as a plugin's secret: the transport's `fetch` is core's authorized fetch, bound to the server's origin and path (`GET`, `POST` and `DELETE`, as Streamable HTTP uses), as `Authorization: Bearer <token>`. A server's name and URL can't be edited: to change either, remove it and add it again, so a token is never sent to a URL it wasn't entered for. Removing a server deletes its token. The document travels with an export; the token stays behind. (This follows the Pi coding agent's own MCP support, which also keys credentials by server and URL.)
2. **The bridge.** For each server: connect with the MCP TypeScript SDK's client over Streamable HTTP, list its tools, and install an extension `familiar.mcp.<name>` with one deferred tool per MCP tool, named `mcp__<name>__<tool>`, its input schema passed through as JSON Schema, and the MCP tool's description. A call runs `callTool` and maps text and image content to Pi's output; an MCP error result becomes an error result. When the server's tools change, reinstall its extension (pi-durable README, "Reload"); the SDK's `listChanged.tools.onChanged` client option reports that, so don't handle the notification by hand.
3. **Tool search.** Install `createToolSearchExtension()` from `@earendil-works/pi-durable/tool-search` once, so the model can find and load MCP tools.
4. **Failures.** A server that can't be reached gets an extension with no tools and a status the Connections page shows. Retry on the next start and when the owner presses Reconnect. When the server says the session has expired, reconnect and retry the call once: the server never ran it. After any other failure, return an error result without retrying, because the call may have run and a retry could act twice.
5. **Owner API and routes.** `familiar.mcp.add({ name, url, auth })`, `remove(name)` and `reconnect(name)`, and their routes; the token is set through the step 1 secret routes. `familiar.connections.list()` includes each server as `{ kind: 'mcp', name, title, url, secrets, status, tools }`: `secrets` is `[{ name: 'token', label: 'Bearer token', set }]` for a bearer server, `status` is one of `connecting`, `connected`, `disconnected`, `needs-auth` (the server answered 401) or `failed`, with an error message for the last, and `tools` lists each tool's name and whether it declares `readOnlyHint`.
6. **Portability.** The SDK's client and Streamable HTTP transport (1.32.2) import no `node:*`; ESLint will confirm. The client checks schemas with Ajv by default, which compiles with `new Function` and fails in a Cloudflare Worker, so the bridge takes a `jsonSchemaValidator` from a host option (the daemon passes Ajv's; a Worker host passes the SDK's `CfWorkerJsonSchemaValidator`). The bridge also accepts a transport factory, so tests can use the SDK's in-memory transport.
7. **The Connections page** gains an MCP section: add a server (name, URL, optional token), remove it, reconnect it, and see its status and tools.

Tests, with the faux provider and an in-memory MCP server exposing `echo` and `add`:

- The model calls `tool_search`, loads `mcp__test__echo` and calls it; the result is the server's.
- Before loading, the request's tools don't include the server's tools.
- A server that adds a tool and sends `list_changed` makes it searchable without a restart.
- Removing the server removes its tools and deletes its token; close and reopen restores a server that was added.
- A bearer server's token reaches the server and is redacted if a tool echoes it.
- An unreachable server reports its status and doesn't stop Familiar starting.

Done when the tests pass and, on the demo, adding the in-memory server from the page (behind a demo-only URL) makes its tools usable in chat.

## Later

Not part of this spec; each needs its own before starting.

- **Confirmation.** A `beforeTool` hook that holds a call for the owner's approval, with AI Elements' Confirmation in the chat. Start with MCP tools that don't declare `readOnlyHint`, and with any fetch after the model has read external content.
- **Tools Familiar writes itself.** Pi's code mode (`@earendil-works/pi-durable/codemode`) runs model-written JavaScript in a QuickJS sandbox that reaches the world only through Familiar's tools. A saved script with a name, a description and parameters becomes a tool, stored in a document and installed at runtime. Because the sandbox has no file or network access of its own, this stays inside the data directory rule.
- **Skills.** Instruction-only `SKILL.md` folders (the agentskills.io format OpenClaw and Hermes use), listed in a section and loaded with a `use_skill` tool. Without a shell they are mostly named procedures, so wait until there's a need memory doesn't meet.
- **MCP OAuth**, for servers that don't accept a token.
- **MCP headers.** Servers that want `X-API-Key` or several headers: map each header name to a secret name, so values stay write-only and out of the exported document.
- **Data leaving through allowed requests.** A prompt-injected model can put private data in a search query or a public URL. Willison's "lethal trifecta" (private data, untrusted content, a way out) describes it. Confirmation, or limits on what may follow reading untrusted content, is the answer; origin-bound secrets aren't.
- **More search services.** Tavily or Exa behind the same adapter, or a self-hosted SearXNG, which needs no key but needs plugin settings as well as secrets. Paging through long pages with an `offset` on `web_fetch`, if the model often hits the limit.
