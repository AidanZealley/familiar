import type { ToolCall } from '@familiar-ai/client'

type Status = ToolCall['status']

/** `search_notes` or `home-assistant` as words: `search notes`, `home assistant`. */
const words = (name: string) => name.replace(/[_-]+/g, ' ').trim()

/**
 * A tool's name as a person reads it. Core names an MCP server's tools
 * `mcp__<server>__<tool>`, and a server's title is its name, so this shows
 * the server and the tool: `Notes · search notes`.
 */
export const toolName = (name: string) => {
  const mcp = /^mcp__([a-z][a-z0-9-]*)__(.+)$/.exec(name)
  if (!mcp) {
    return name
  }
  const server = words(mcp[1])
  return `${server.charAt(0).toUpperCase()}${server.slice(1)} · ${words(mcp[2])}`
}

/**
 * How a tool call's row reads at each status. `tool_search` is how a
 * Familiar finds an MCP server's tools before using one, so it reads as
 * that step rather than as a tool of its own.
 */
export const toolLabel = (name: string, status: Status) => {
  if (name === 'tool_search') {
    return {
      running: 'Looking for tools…',
      done: 'Looked for tools',
      error: "Couldn't look for tools",
    }[status]
  }
  const shown = toolName(name)
  return {
    running: `Running ${shown}…`,
    done: `Used ${shown}`,
    error: `${shown} failed`,
  }[status]
}
