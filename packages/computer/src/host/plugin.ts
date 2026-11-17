import { definePlugin, defineTool, familiar } from '@familiar-ai/core'
import type { ImageContent, TextContent } from '@familiar-ai/core/extensions'
import { z } from 'zod'
import { annotationsOf, computerTools } from '../tools.ts'
import type { Computers } from './computers.ts'

/** The plugin's name, which a Familiar's capabilities list to use it. */
export const COMPUTER_PLUGIN = 'computer'

/** Longer than any tool's own limit: the agent stops its own calls first. */
const CALL_MAX_MS = 15 * 60_000

const NO_COMPUTER =
  "You don't have a computer. The person can give you one in Familiar's settings."
const OFFLINE =
  "Your computer is offline: it isn't connected to Familiar. Try again later, or ask the person to check it's on and running the computer agent."

const failed = (text: string) => ({
  output: [{ type: 'text' as const, text }],
  isError: true,
})

/**
 * The computer's tools for Familiars: each call goes to the calling
 * Familiar's own computer, never another's.
 */
export function computerPlugin(computers: Computers) {
  return definePlugin({
    name: COMPUTER_PLUGIN,
    title: 'Computer',
    tools: Object.entries(computerTools).map(([name, tool]) =>
      defineTool({
        name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.input) as object,
        ...('reads' in tool && { replay: 'safe' as const }),
        annotations: annotationsOf(tool),
        execute: async (args, _api, context) => {
          const id = await familiar(context).familiarId()
          try {
            const result = await computers.use(
              id,
              context.abortSignal,
              (computer) =>
                computer.callTool(
                  { name, arguments: args as Record<string, unknown> },
                  { signal: context.abortSignal, timeout: CALL_MAX_MS },
                ),
            )
            if (result === 'none') {
              return failed(NO_COMPUTER)
            }
            if (result === 'offline') {
              return failed(OFFLINE)
            }
            return {
              output: result.content.flatMap<TextContent | ImageContent>(
                (block) =>
                  block.type === 'text'
                    ? [{ type: 'text', text: block.text }]
                    : block.type === 'image'
                      ? [
                          {
                            type: 'image',
                            data: block.data,
                            mimeType: block.mimeType,
                          },
                        ]
                      : [],
              ),
              isError: result.isError ?? false,
            }
          } catch (error) {
            // Stopped, or the host is closing: Pi reports that itself.
            if (context.abortSignal?.aborted) {
              throw error
            }
            const reason =
              error instanceof Error ? error.message : String(error)
            return failed(
              `Your computer stopped answering during this call (${reason}), so it may have partly run. Look before trying again.`,
            )
          }
        },
      }),
    ),
  })
}
