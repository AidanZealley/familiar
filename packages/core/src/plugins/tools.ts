import type { Context, JsonValue } from '@earendil-works/chord'
import type { Static, TSchema } from '@earendil-works/pi-ai'
import {
  defineTool as piDefineTool,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from '@earendil-works/pi-durable'
import type { Invoker } from '../authorization.ts'

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
     * never from the tool's arguments. The host already allowed it to run; a
     * tool that keeps per-record permissions checks them against this.
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

/**
 * Types a tool whose `execute` reads `api.invoker`. Pi owns execution;
 * Familiar's registry resolves the invoker and asks the host before every
 * call, whichever way the tool is defined, so this adds nothing at runtime.
 */
export function defineTool<
  TParameters extends TSchema,
  TDetails extends JsonValue = JsonValue,
>(
  tool: FamiliarTool<TParameters, TDetails>,
): ToolRegistration<TParameters, TDetails> {
  return piDefineTool(tool as ToolRegistration<TParameters, TDetails>)
}
