import type { Static, TSchema } from '@earendil-works/pi-ai'
import type { ToolRegistration } from '@earendil-works/pi-durable'

export { Type } from '@earendil-works/pi-ai'
export type { Static } from '@earendil-works/pi-ai'

/** JSON data persisted with a tool result, available to hosts for rendering. */
export type ToolDetails =
  | null
  | boolean
  | number
  | string
  | ToolDetails[]
  | { [key: string]: ToolDetails }

export type ToolResult = {
  output?: (
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  )[]
  structuredOutput?: ToolDetails
  details?: ToolDetails
  isError?: boolean
}

/** Invocation capabilities. No storage, transaction or harness access. */
export type ToolContext = {
  now(): number
  abortSignal?: AbortSignal
  output(chunk: string): void
  details(value: ToolDetails): Promise<void>
}

export type FamiliarTool<TParameters extends TSchema = TSchema> = {
  name: string
  description: string
  parameters: TParameters
  structuredOutputSchema?: TSchema
  /** Default unsafe: an interrupted call is not repeated after restart. */
  replay?: 'safe' | 'unsafe'
  executionMode?: 'parallel' | 'sequential'
  outputLimits?: {
    maxBytes?: number
    maxLines?: number
    retain?: 'head' | 'tail'
  }
  execute(args: Static<TParameters>, context: ToolContext): Promise<ToolResult>
}

export const defineTool = <TParameters extends TSchema>(
  tool: FamiliarTool<TParameters>,
): FamiliarTool<TParameters> => tool

/** Pi owns validation, persistence and recovery; only invocation access changes. */
export const toPiTool = (tool: FamiliarTool): ToolRegistration => ({
  ...tool,
  execute: (args, api, context) =>
    tool.execute(args, {
      now: () => api.now(),
      abortSignal: context.abortSignal,
      output: (chunk) => api.output(chunk),
      details: (value) => api.details(value, context),
    }),
})
