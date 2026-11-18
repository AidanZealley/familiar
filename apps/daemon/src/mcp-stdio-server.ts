import { Server } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

if (process.argv.includes('--wait-for-close')) {
  process.stdin.resume()
  await new Promise<void>((resolve) => process.stdin.once('end', resolve))
  process.exit(0)
}

const server = new Server(
  { name: 'stdio-test', version: '1.0.0' },
  { capabilities: { tools: {} } },
)
server.setRequestHandler('tools/list', () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echo a message and report the child process environment.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  ],
}))
server.setRequestHandler('tools/call', ({ params }) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        text: params.arguments?.text,
        pid: process.pid,
        args: process.argv.slice(2),
        environment: Object.keys(process.env),
      }),
    },
  ],
}))
await server.connect(new StdioServerTransport())
