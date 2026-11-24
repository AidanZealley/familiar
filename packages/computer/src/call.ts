import { familiar } from '@familiar-ai/core'
import type {
  Context,
  ImageContent,
  TextContent,
  ToolExecutionApi,
} from '@familiar-ai/core/extensions'
import type { ComputerHost } from './host.ts'
import { shorten } from './shorten.ts'

/**
 * Calls `tool` on the calling Familiar's own computer, as a tool result for
 * the model: long text shortened, keeping its `keep` end.
 */
export async function callComputer(
  host: ComputerHost,
  tool: string,
  args: Record<string, unknown>,
  api: ToolExecutionApi,
  context: Context,
  keep: 'start' | 'end' = 'start',
) {
  const id = await familiar(context).familiarId()
  let result
  try {
    result = await host.call(
      id,
      tool,
      args,
      context.abortSignal,
      // The chat shows it, as "Waiting for you to hand back".
      () => void api.details({ waiting: true }, context).catch(() => {}),
    )
  } catch (error) {
    // Stopped, or the host is closing: Pi reports that itself.
    if (context.abortSignal?.aborted) {
      throw error
    }
    const reason = error instanceof Error ? error.message : String(error)
    return {
      output: [
        {
          type: 'text' as const,
          text: `Your computer stopped answering during this call (${reason}), so it may have partly run. Look before trying again.`,
        },
      ],
      isError: true,
    }
  }
  return {
    output: result.content.flatMap<TextContent | ImageContent>((block) =>
      block.type === 'text'
        ? [{ type: 'text', text: shorten(block.text, keep) }]
        : block.type === 'image'
          ? [{ type: 'image', data: block.data, mimeType: block.mimeType }]
          : [],
    ),
    isError: result.isError ?? false,
  }
}
