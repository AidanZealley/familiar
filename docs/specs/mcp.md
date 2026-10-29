# MCP connections

Plugins, Connections and web search/fetch already exist. Build MCP on those interfaces; see [architecture](../architecture.md) and [plugin contracts](../../packages/core/src/plugins/types.ts).

A core capability folder, `packages/core/src/mcp/`. It lives in core, not in a plugin, because it installs extensions into the registry while Familiar runs.

1. **The document.** `McpServers`: a list of `{ name, url, auth: { type: 'none' } | { type: 'bearer' } }`. A bearer server's token is stored at `({ kind: 'mcp', name }, 'token')` in the secret store. It is sent the same way as a plugin's secret: the transport's `fetch` is core's authorized fetch, bound to the server's origin and path (`GET`, `POST` and `DELETE`, as Streamable HTTP uses), as `Authorization: Bearer <token>`. A server's name and URL can't be edited: to change either, remove it and add it again, so a token is never sent to a URL it wasn't entered for. Removing a server deletes its token. The document travels with an export; the token stays behind.
2. **The bridge.** For each server: connect with the MCP TypeScript SDK's client over Streamable HTTP, list its tools, and install an extension `familiar.mcp.<name>` with one deferred tool per MCP tool, named `mcp__<name>__<tool>`, its input schema passed through as JSON Schema, and the MCP tool's description. A call runs `callTool` and maps text and image content to Pi's output; an MCP error result becomes an error result. When the server's tools change, reinstall its extension (pi-durable README, "Reload"); use the installed SDK's supported tool-list-change subscription rather than implementing notification handling yourself.
3. **Tool search.** Install `createToolSearchExtension()` from `@earendil-works/pi-durable/tool-search` once, so the model can find and load MCP tools.
4. **Failures.** A server that can't be reached gets an extension with no tools and a status the Connections page shows. Retry on the next start and when the owner presses Reconnect. On session expiry, reconnect. Retry a tool call once only when the protocol response establishes that it was rejected before execution. After an ambiguous failure, return an error without retrying, because the call may have run and a retry could act twice.
5. **Owner API and routes.** `familiar.mcp.add({ name, url, auth })`, `remove(name)` and `reconnect(name)`, and their routes; the token is set through the existing Connections secret routes. `familiar.connections.list()` includes each server as `{ kind: 'mcp', name, title, url, secrets, status, tools }`: `secrets` is `[{ name: 'token', label: 'Bearer token', set }]` for a bearer server, `status` is one of `connecting`, `connected`, `disconnected`, `needs-auth` (the server answered 401) or `failed`, with an error message for the last, and `tools` lists each tool's name and whether it declares `readOnlyHint`.
6. **Portability.** The SDK's client and Streamable HTTP transport must remain portable. Read the installed SDK version's documentation and validate the complete bridge in Workers, not only its direct imports. The client checks schemas with Ajv by default, which compiles with `new Function` and fails in a Cloudflare Worker, so the bridge takes a `jsonSchemaValidator` from a host option (the daemon passes Ajv's; a Worker host passes the SDK's `CfWorkerJsonSchemaValidator`). The bridge also accepts a transport factory, so tests can use the SDK's in-memory transport.
7. **The Connections page** gains an MCP section: add a server (name, URL, optional token), remove it, reconnect it, and see its status and tools.

Tests, with the faux provider and an in-memory MCP server exposing `echo` and `add`:

- The model calls `tool_search`, loads `mcp__test__echo` and calls it; the result is the server's.
- Before loading, the request's tools don't include the server's tools.
- A server that adds a tool and sends `list_changed` makes it searchable without a restart.
- Removing the server removes its tools and deletes its token; close and reopen restores a server that was added.
- A bearer server's token reaches only its configured endpoint and is never returned by the Connections API.
- An unreachable server reports its status and doesn't stop Familiar starting.

Done when the tests pass and, on the demo, adding the in-memory server from the page (behind a demo-only URL) makes its tools usable in chat.

## Out of scope

OAuth, custom authentication headers, action approvals and agent-written tools need their own specs. This first version supports no authentication or one bearer token per server. Keep network filtering in the host and reuse the Connections store; do not add general secret-masking machinery.
