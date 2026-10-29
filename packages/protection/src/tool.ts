import type {
  ToolExecutionApi,
  ToolExecutionResult,
  ToolRegistration,
} from '@earendil-works/pi-durable'
import type { Redactor } from './redactor.ts'

const encoder = new TextEncoder()

/** Mask every output channel before Pi can persist or stream it. */
export const maskTool = <Tool extends ToolRegistration>(
  tool: Tool,
  redactor: Redactor,
  ready: () => Promise<unknown>,
): Tool => ({
  ...tool,
  execute: async (
    args: unknown,
    api: ToolExecutionApi,
    context: Parameters<Tool['execute']>[2],
  ) => {
    await ready()
    const stream = redactor.stream()
    const decoder = new TextDecoder()
    const emit = (bytes: Uint8Array, last = false) => {
      const text = decoder.decode(bytes, { stream: !last })
      if (text) {
        api.output(text)
      }
    }
    const redacting: ToolExecutionApi = {
      ...api,
      // Pi's docs: a wrapper that transforms output must clear this, so
      // skipped text can't bypass it.
      outputWindow: undefined,
      output: (chunk) =>
        emit(
          stream.push(
            typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
          ),
        ),
      diagnostic: (diagnostic) => api.diagnostic(redactor.json(diagnostic)),
      details: (value, detailsContext) =>
        api.details(redactor.json(value), detailsContext),
    }
    let result: ToolExecutionResult
    try {
      result = await tool.execute(args as never, redacting, context)
    } catch (error) {
      // No `cause`: the original's message is what holds the secret.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        redactor.text(error instanceof Error ? error.message : String(error)),
      )
    } finally {
      emit(stream.end(), true)
    }
    return redactor.json(result)
  },
})
