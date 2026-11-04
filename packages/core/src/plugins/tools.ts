import type { Context, JsonValue } from '@earendil-works/chord'
import type { Static, TSchema } from '@earendil-works/pi-ai'
import {
  defineTool as piDefineTool,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from '@earendil-works/pi-durable'
import { toolInvoker, type Invoker } from './invoker.ts'

export { Type } from '@earendil-works/pi-ai'
export type { Static, TSchema } from '@earendil-works/pi-ai'

export type ToolDetails = JsonValue
export type ToolContext = Context
export type ToolResult<TDetails extends JsonValue = JsonValue> =
  ToolExecutionResult<TDetails>

/** Pi's tool API, plus who the call runs for. */
export type FamiliarToolApi<TDetails extends JsonValue = JsonValue> =
  ToolExecutionApi<TDetails> & {
    /**
     * Who this call runs for, resolved from the stored input that started it,
     * never from the tool's arguments. A tool that narrows what someone may
     * do with its data or actions checks it against this.
     */
    readonly invoker: Invoker
  }

export type FamiliarTool<
  TParameters extends TSchema = TSchema,
  TDetails extends JsonValue = JsonValue,
> = Omit<ToolRegistration<TParameters, TDetails>, 'execute'> & {
  execute(
    args: Static<TParameters>,
    api: FamiliarToolApi<TDetails>,
    context: Context,
  ): Promise<ToolResult<TDetails>>
}

/** Pi owns execution; Familiar adds who the call runs for. */
export function defineTool<
  TParameters extends TSchema,
  TDetails extends JsonValue = JsonValue,
>(
  tool: FamiliarTool<TParameters, TDetails>,
): ToolRegistration<TParameters, TDetails> {
  return piDefineTool({
    ...tool,
    execute: async (args, api, context) => {
      const invoker = await api.commit(
        (tx) => toolInvoker(tx, api.taskId),
        context,
      )
      // Inherit Pi's live getters rather than evaluating them into snapshots.
      const invocation = Object.create(api, {
        invoker: { value: invoker, enumerable: true },
      }) as FamiliarToolApi<TDetails>
      return tool.execute(args, invocation, context)
    },
  })
}
