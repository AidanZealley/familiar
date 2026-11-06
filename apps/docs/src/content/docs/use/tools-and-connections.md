---
title: Tools and connections
description: Web search, page reading and the MCP tools you can connect to Familiar.
---

Familiar always has its own tools for time, memory and schedules. Open **Connections** in the header to add more and to see whether each one is ready.

## Web search and page reading

The installed Familiar includes the web plugin with two tools:

- `web_search` searches through [Brave Search](https://brave.com/search/api/). It needs a Brave Search API key. Paste one into the **Web search** connection. Any Brave plan with Web Search works.
- `web_fetch` reads a public web page as text. It needs no key. It doesn't run the page's JavaScript and doesn't read PDFs or images.

Familiar sends the Brave key only to Brave's search endpoint. Keys are write-only. Connections shows whether a key is set, never its value. Both tools refuse private and local network addresses.

Treat what these tools bring back as untrusted. A web page can contain text written to mislead the model.

## MCP servers

Familiar can use tools from [Model Context Protocol](https://modelcontextprotocol.io) servers. Add one under **Connections** with a short name, such as `home-assistant`, and a transport:

- **HTTP**: the server's URL, with an optional bearer token. Familiar sends the token only to that server's origin and path. Use `https://` when the token crosses a network you don't trust. HTTP servers can be on your private network.
- **Local command**: a program and its arguments, such as `uvx mcp-server-time`. Familiar starts it on the computer it runs on.

Connections shows each server's status, for example **Ready**, **Needs a token** or **Failed**, and can reconnect or remove it.

:::caution
A local command runs with the same permissions as Familiar's own user account. Only add servers you trust. Anyone who can reach your Familiar can add one.
:::

To give Familiar tools of your own, written in TypeScript, see [Extend your Familiar](/familiar/use/extend/).
