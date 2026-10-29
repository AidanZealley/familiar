# MCP connections

Plugins, Connections and web search/fetch already exist. Build MCP on those interfaces; see [architecture](../architecture.md) and [plugin contracts](../../packages/core/src/plugins/types.ts).

A core capability folder, `packages/core/src/mcp/`. It lives in core, not in a plugin, because it installs extensions into the registry while Familiar runs.

1. **The document.** `McpServers`: a list of named servers with one transport value: `{ type: 'http', url, auth: { type: 'none' } | { type: 'bearer' } }` or `{ type: 'stdio', command, args }`. The owner chooses endpoints and commands; the model cannot add or modify servers. HTTP includes owner-configured localhost, LAN and tailnet endpoints. Stdio is available only in the Node daemon. A bearer server's token is stored at `({ kind: 'mcp', name }, 'token')` in the secret store. It is sent the same way as a plugin's secret: the transport's `fetch` is the MCP endpoint's authorized fetch, bound to the server's origin and path (`GET`, `POST` and `DELETE`, as Streamable HTTP uses), as `Authorization: Bearer <token>`. A server's name and transport configuration can't be edited: to change either, remove it and add it again, so a token is never sent to a URL it wasn't entered for. Removing a server deletes its token. Adding a new declaration first clears any orphaned token under that name; the owner sets the token after adding it. The document travels with an export; the token stays behind.
2. **The bridge.** For each server: connect with the MCP TypeScript SDK's client over the declared HTTP or stdio transport, list its tools, and install an extension `familiar.mcp.<name>` with one deferred tool per MCP tool, named `mcp__<name>__<tool>`, its input schema passed through as JSON Schema, and the MCP tool's description. A call runs `callTool` and maps text and image content to Pi's output; an MCP error result becomes an error result. When the server's tools change, reinstall its extension (pi-durable README, "Reload"); use the installed SDK's supported tool-list-change subscription rather than implementing notification handling yourself.
3. **Tool search.** Install `createToolSearchExtension()` from `@earendil-works/pi-durable/tool-search` once, so the model can find and load MCP tools.
4. **Failures.** A server that can't be reached registers no tools and has a status the Connections page shows. Retry on the next start and when the owner presses Reconnect. On session expiry, reconnect. A failed tool call returns an error without changing connection status, except that HTTP 401 requests credentials and HTTP 404 reconnects the expired session. An expiry callback reconnects only if its connection is still the current one when the queued edit runs. Do not replay tool calls automatically, including after session expiry. Reconnect for subsequent calls and return the failed call as an error, because it may already have acted. Leave SSE stream resumption to the SDK; resuming a response is different from repeating a call.
5. **Owner API and routes.** `familiar.mcp.add({ name, transport })`, `remove(name)` and `reconnect(name)`, and their routes; the token is set through the existing Connections secret routes. `familiar.connections.list()` includes each server as `{ kind: 'mcp', name, title, transport, secrets, status, tools }`, with the configured HTTP URL or stdio command and arguments in `transport`: `secrets` is `[{ name: 'token', label: 'Bearer token', set }]` for a bearer server, `status` is `{ type: 'connecting' | 'connected' | 'disconnected' | 'needs-auth' }` or `{ type: 'failed', error }`; `needs-auth` means the token is missing or the server answered 401, and `tools` lists each tool's name and whether it declares `readOnlyHint`.
6. **Portability.** The SDK's client and Streamable HTTP transport must remain portable. Keep Node imports and stdio transport construction in the daemon. The host supplies MCP transport construction separately from plugins' guarded fetch. Read the installed SDK version's documentation; Cloudflare testing is deferred until a Cloudflare host is being built. Use `@modelcontextprotocol/client` 2.4.0, whose runtime export conditions select Ajv on Node and `CfWorkerJsonSchemaValidator` on workerd. Do not add a host validator option unless a future Worker deployment demonstrates a need. Keep the SDK's default legacy protocol negotiation for the first version; newer protocol opt-ins are separate work. The bridge accepts an SDK transport, so the host owns its construction and tests can use HTTP or the SDK's in-memory transport.
7. **The Connections page** gains an MCP section: add a server with its name, HTTP or stdio settings and optional HTTP token, remove it, reconnect it, and see its status and tools.

Tests, with the faux provider and an in-memory MCP server exposing `echo` and `add`:

- The model calls `tool_search`, loads `mcp__test__echo` and calls it; the result is the server's.
- Before loading, the request's tools don't include the server's tools.
- A server that adds a tool and sends `list_changed` makes it searchable without a restart.
- Removing the server removes its tools and deletes its token; close and reopen restores a server that was added.
- A bearer server's token reaches only its configured endpoint and is never returned by the Connections API.
- An unreachable server reports its status and doesn't stop Familiar starting.

Done when the tests pass and, on the demo, adding the in-memory server from the page (behind a demo-only URL) makes its tools usable in chat.

## Out of scope

Cloudflare deployment and runtime testing, legacy HTTP+SSE fallback, MCP resources and prompts, sampling, elicitation, experimental tasks, OAuth, custom authentication headers, action approvals and agent-written tools are out of scope. This first version supports no authentication or one bearer token per server. Keep network filtering in the host and reuse the Connections store; do not add general secret-masking machinery.

## Implementation decisions

Research checked on 29 October 2026 against the published `@modelcontextprotocol/client` 2.4.0 package and Familiar's installed Pi types. Use the split v2 client package, not v1 examples importing `@modelcontextprotocol/sdk`. Pin the MCP client and test-server dependencies exactly once in the workspace catalog.

### Ownership and lifecycle

- Persist only server declarations in the `McpServers` document. The MCP manager owns declarations and serializes owner edits. Each live connection owns its client, status and registry extension. Status and discovered tools are runtime state; the Connections API reads them from that manager.
- Use a discriminated connection state with an error message only on `failed`. `needs-auth` covers both a missing bearer token and HTTP 401. A 403 is a failure, not an invitation to start OAuth.
- Familiar must return even when a server is unavailable. Start independent connection attempts without making the first model request wait for unreachable servers. Bound each initialization and discovery attempt with the SDK request options, initially 15 seconds. Close a client after a failed attempt.
- Use one per-server lifecycle operation at a time. Remove or reconnect must finish closing the previous client before replacing it; a late connect or list-change callback must not reinstall a removed server. Keep this ownership in the manager rather than coordinating flags across routes and UI.
- `dismiss()` closes MCP clients as well as the harness. Removal uninstalls the extension immediately, closes the client, deletes its declaration and token, and waits for cleanup before returning. For stdio still initializing, the SDK may finish process termination after the close promise resolves; its own EOF and signal escalation remain responsible for cleanup. Cancelling a remote operation cannot undo effects already performed.
- Saving or deleting a token reconnects that server through the same manager operation. The UI's add form creates the declaration, then saves its token through Connections. If token storage fails, retain the declaration in `needs-auth` so the owner can retry. Neither tokens nor session IDs belong in the document or API results.

### Endpoints and credentials

- Accept HTTP or HTTPS endpoint URLs without embedded credentials, fragments or query strings. HTTP supports local installations such as Home Assistant; prefer HTTPS when available. Keep the exact normalized URL immutable. Require unique server names matching `[a-z][a-z0-9-]{0,31}`. The daemon allows private addresses only for these owner-configured MCP endpoints. Web search/fetch retain their existing private-network restrictions. Extend the existing credential boundary narrowly for MCP's explicit HTTP endpoints rather than weakening plugin secret declarations.
- Pass a small Fetch-compatible adapter to `StreamableHTTPClientTransport`. Route bearer requests through the existing authorized fetch, with GET, POST and DELETE allowed only at the declared endpoint. Pass unauthenticated requests through the host fetch with the same endpoint restriction. Set `requestInit.redirect: 'error'` and do not supply an SDK auth provider. This preserves the existing boundary without duplicating credential handling or enabling OAuth discovery.
- Verify the adapter against the SDK's actual Fetch input types. Familiar's `PluginFetch` accepts string or URL, while Fetch may also accept a Request. Normalize that at the adapter, preserving method, headers, body and abort signal. Do not cast incompatible function types to make them fit.
- Reconnect uses a new transport and session. Let `client.close()` release its local streams; use the SDK's `terminateSession()` where a live HTTP session can be explicitly ended, with bounded best-effort cleanup. Shutdown or removal must not hang on an unreachable server.

### Tools and results

- Use `client.listTools()` and `ClientOptions.listChanged.tools.onChanged`. Version 2.4.0 aggregates pages and caps pagination itself. Leave pagination, notification subscriptions, debouncing and stream reconnection to the SDK. On refresh failure retain the last successful tool list and report the failure; a successful refresh replaces the extension in one registry operation.
- Pi already supplies deferred tools, `tool_search`, registry replacement and uninstall. Reuse them. Keep each tool's original MCP name in its execution closure. Validate the final `mcp__<server>__<tool>` against the configured model provider's naming limits before installation; reject discovery with a clear error naming the unsupported tool instead of silently renaming or truncating it into collisions.
- Pass the input JSON Schema through Pi's supported schema type. The installed pi-ai validator handles plain JSON Schema, and its TypeBox dependency falls back to interpreted checking when dynamic code evaluation is unavailable; do not build a schema translator. Test nested objects and references through the real harness. Mark every MCP tool `replay: 'unsafe'`; `readOnlyHint` is an untrusted server hint for display, not permission to repeat an interrupted operation after a crash.
- Map MCP text and image blocks to Pi output in order and preserve `isError`. If `structuredContent` is not already represented by a text block, include its JSON as text so the model can read it. Do not set Pi `structuredOutput` without its required schema.
- Render resource links as text without fetching them. For embedded text resources, include their URI and text. Report unsupported audio or binary resource blocks as text stating their type, rather than silently discarding them or adding media processing.
- Pass the tool execution abort signal to SDK `callTool` request options. Use the SDK's default 60-second request timeout initially, without progress-based timeout resets. Cancellation and timeout return a tool error; neither implies that the remote action was rolled back.
- Advertise no client sampling, elicitation or filesystem roots capabilities. Treat server instructions, descriptions and results as untrusted content; do not copy server instructions into Familiar's system prompt automatically.

## Proof and acceptance additions

Build and review in stages:

1. **Bridge proof.** Connect to a test Streamable HTTP server in Node, discover its tools and call one through Familiar's real harness using the faux model. Keep connection persistence and UI out of this stage. The bridge accepts an SDK transport; the test installs its returned extension through the existing plugin interface. The runtime manager owns registry installation in stage two.
2. **Saved HTTP connections.** Add the owner API, persistent declarations, bearer credentials, private endpoints, runtime status, tool-list refresh, reconnect and cleanup. Use Home Assistant as the first real target, initially listing tools only. Obtain credentials separately and do not control devices without explicit authorization.
3. **Local stdio.** The daemon constructs `StdioClientTransport` from the owner's command and arguments. Use the SDK's default filtered environment rather than maintaining another allowlist. The installed SDK merges `getDefaultEnvironment()` even when `env` is supplied, so rely on that intended default and do not pass `process.env`. Use the SDK for spawning and termination, and prove shutdown with a small custom MCP server. Stdio declarations carry no HTTP token. These are trusted owner-installed commands running as the daemon's user, like code plugins; a limited environment is not a filesystem sandbox.
4. **Connections UI.** Add, remove and reconnect servers, display tools and status, and finish the demo and documentation. Unsupported host transports produce a clear connection error.

Cloudflare runtime and Durable Object lifecycle proofs are deferred until a Cloudflare deployment is wanted. Preserve portable core imports now, but do not add deployment tooling, host options or workerd tests speculatively. A future host must reconstruct clients from declarations when it starts again.

Add focused cases to the existing acceptance tests:

- A paginated server exposes tools from later pages; a removed tool disappears after refresh.
- A side-effecting tool whose response is lost executes once, with no automatic replay. Pi owns restart recovery through `replay: 'unsafe'`; its recovery mechanics do not need another test here.
- Stop propagates cancellation; removing a server during connection or refresh never reinstalls it afterward.
- Setting, replacing and deleting a bearer token updates connection state. Redirects never carry the token onward, and API responses contain neither token nor session ID.
- Mixed text/image output, structured-only output and an MCP `isError` result reach the model as specified. Unsupported content is reported.
- Closing Familiar releases server transports. A failed server does not block chat or other connections.

## Sources

- [SDK v2 client connection guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect) and [Client API](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/client/client/client.html), including `listChanged`, pagination and runtime-selected validators. The published 2.4.0 package's declarations and `workerd` export were checked directly, rather than assuming the website matches npm.
- [Streamable HTTP protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), including endpoint methods, session expiry, cancellation and response resumption.
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), including runtime state loss, pending I/O and duration charges.
- Installed `packages/core/node_modules/@earendil-works/pi-durable/README.md`, sections "Who may call a tool", "Tasks a restart abandons" and "Reload", plus `dist/harness/types.d.ts` for result mapping and replay policy.

## Progress

Stages one, two and three are implemented. Saved HTTP endpoints use the host's separate `mcpFetch`; the daemon permits private networks there while plugins continue to use guarded fetch. Routes are `POST /mcp`, `DELETE /mcp/:name` and `POST /mcp/:name/reconnect`, under the host's API prefix. Credential writes use the existing Connections routes. Local stdio uses the host's `mcpStdio` factory, with process launching and the SDK's filtered environment in the daemon. Process exit uninstalls tools; reconnect launches a fresh process, and removal or dismissal closes it. Hosts without the factory report a clear failed status. Stage four, the Connections UI, remains.

Verified tool discovery against the owner's Home Assistant over Tailscale on 29 October 2026. The saved-connection API discovered 21 tools using an in-memory token store and conversation. No tools were called, and neither the token nor the connection was saved to the live Familiar installation.
