import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

const transport = new StdioServerTransport()
transport.onmessage = (message) => {
  if (
    'method' in message &&
    message.method === 'initialize' &&
    'id' in message
  ) {
    void transport.send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32603, message: 'Initialization refused' },
    })
  }
}
await transport.start()
