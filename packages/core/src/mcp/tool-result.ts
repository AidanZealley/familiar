import type { ToolExecutionResult } from '@earendil-works/pi-durable'
import type { CallToolResult } from '@modelcontextprotocol/client'

/** Keep supported content in order and make unsupported content visible. */
export function toolResult(result: CallToolResult): ToolExecutionResult {
  const output: NonNullable<ToolExecutionResult['output']> = []
  for (const block of result.content) {
    switch (block.type) {
      case 'text':
      case 'image':
        output.push(block)
        break
      case 'resource_link':
        output.push({ type: 'text', text: `${block.name}: ${block.uri}` })
        break
      case 'resource':
        output.push({
          type: 'text',
          text:
            'text' in block.resource
              ? `${block.resource.uri}\n${block.resource.text}`
              : `Unsupported MCP binary resource: ${block.resource.uri}`,
        })
        break
      default:
        output.push({
          type: 'text',
          text: `Unsupported MCP content: ${block.type}`,
        })
    }
  }
  if (result.structuredContent !== undefined) {
    const text = JSON.stringify(result.structuredContent)
    if (!output.some((block) => block.type === 'text' && block.text === text)) {
      output.push({ type: 'text', text })
    }
  }
  return { output, isError: result.isError ?? false }
}
