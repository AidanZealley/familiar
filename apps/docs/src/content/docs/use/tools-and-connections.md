---
title: Tools and connections
description: Web search, page reading and the MCP tools you can connect to Familiar.
---

Familiar always has its own tools for time, memory and schedules. Open **Settings › Connections** to add more and see whether each one is ready.

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

## Asking before a tool runs

A connection's tool can run as soon as a Familiar calls it, ask you first, or never run. By default, Familiar asks for tools that explicitly declare a destructive action. Tools without hints run by default. Check **Ask first** on any tool you want to approve manually.

When a tool asks, the reply shows **Waiting for you** with **Approve** and **Decline**, and you get a notification if they're turned on. Declining tells the Familiar you said no. If you send the Familiar a new message instead, the question is declined and it reads your message.

An MCP server can also ask you something itself while a tool runs, such as "Start printing benchy.gcode?" or a short form. Its question shows the same way. Familiar shows yes or no, text, number and single-choice questions; anything else can only be declined.

Use **Enabled** to turn a tool off temporarily. It keeps its **Ask first** setting while disabled. For a tool whose server already asks for approval, you can uncheck **Ask first** to rely on the server's question.

To give Familiar tools of your own, written in TypeScript, see [Extend your Familiar](/familiar/use/extend/).

### Running an MCP tool in the background

In **Connections**, open an MCP server, expand a tool and check **Run in background** for slow calls that can report back later, such as watching a print. The Familiar replies meanwhile, then reports the result in the original room. **Ask first** still applies. Keep a tool in the foreground if the reply needs its result.

While a background call runs, Familiar declines that server's questions. A restart interrupts an MCP request without sending it again.
