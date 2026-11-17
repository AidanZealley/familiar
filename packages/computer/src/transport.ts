import {
  parseJSONRPCMessage,
  type JSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/server'

/** The part of a WebSocket that sends; its owner reports what arrives. */
export type Socket = {
  send(data: string): void
  close(): void
}

export type SocketTransport = Transport & {
  /** A text frame that arrived. */
  receive(data: string): void
  /** The socket closed. */
  ended(): void
}

/**
 * MCP over a WebSocket, one JSON-RPC message per text frame, for either end:
 * the computer agent opens the socket and serves MCP on it; the host accepts
 * it and is the MCP client. The SDK has no WebSocket transport, and its
 * Streamable HTTP needs the client (the host) to open each request, so the
 * computer would need an open port. A WebSocket the agent dials carries
 * both directions over one connection, through routers and proxies, and the
 * daemon's HTTP server already upgrades to it.
 */
export function socketTransport(socket: Socket): SocketTransport {
  // A message can arrive before the MCP side starts; it waits until then.
  let waiting: JSONRPCMessage[] | undefined = []
  let closed = false
  const deliver = (message: JSONRPCMessage) =>
    waiting ? waiting.push(message) : transport.onmessage?.(message)

  const transport: SocketTransport = {
    start: async () => {
      const queued = waiting ?? []
      waiting = undefined
      queued.forEach(deliver)
    },
    send: async (message) => {
      if (closed) {
        throw new Error('The connection has closed.')
      }
      socket.send(JSON.stringify(message))
    },
    close: async () => {
      socket.close()
      transport.ended()
    },
    receive: (data) => {
      try {
        deliver(parseJSONRPCMessage(JSON.parse(data)))
      } catch (error) {
        transport.onerror?.(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
    },
    ended: () => {
      if (!closed) {
        closed = true
        transport.onclose?.()
      }
    },
  }
  return transport
}
