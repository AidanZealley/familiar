import type { Context, JsonValue } from '@earendil-works/chord'
import type { TSchema } from '@earendil-works/pi-ai'
import type {
  ToolExecutionResult,
  ToolRegistration,
} from '@earendil-works/pi-durable'

export { Type } from '@earendil-works/pi-ai'
export type { Static, TSchema } from '@earendil-works/pi-ai'
export { defineTool } from '@earendil-works/pi-durable'

// These aliases retain Pi's complete callable contracts and generic inference.
export type ToolDetails = JsonValue
export type ToolContext = Context
export type ToolResult<TDetails extends JsonValue = JsonValue> =
  ToolExecutionResult<TDetails>
export type FamiliarTool<
  TParameters extends TSchema = TSchema,
  TDetails extends JsonValue = JsonValue,
> = ToolRegistration<TParameters, TDetails>
