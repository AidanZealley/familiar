import type { HttpApi, conversationRoutes } from '@familiar-ai/core/http'
import type { ExtractSchema } from 'hono/types'
import type { Commands } from '../commands.ts'
import type { FamiliarState } from './types.ts'

type SchemaOf<Api> = ExtractSchema<Api>
type Standard = SchemaOf<HttpApi>
type Paths<Prefix extends string> = Extract<keyof Standard, Prefix>
type Group<Schema, Path extends keyof Standard, Value> =
  Schema extends Pick<Standard, Path> ? Value : unknown

// Responses may be narrower, but the host must accept every standard input.
type Compatible<Actual, Expected> = Actual extends Expected
  ? Actual extends { input: infer Input; output: infer Output }
    ? Expected extends { input: infer StandardInput }
      ? 0 extends 1 & (Input | Output)
        ? false
        : StandardInput extends Input
          ? never
          : false
      : false
    : false
  : false
type InvalidMethods<Actual, Expected> = {
  [Method in keyof Actual & keyof Expected]: Compatible<
    Actual[Method],
    Expected[Method]
  >
}[keyof Actual & keyof Expected]
type InvalidPaths<Schema> = {
  [Path in keyof Schema & keyof Standard]: InvalidMethods<
    Schema[Path],
    Standard[Path]
  >
}[keyof Schema & keyof Standard]

/** Standard paths relative to the store URL, with unchanged route contracts. */
export type SupportedHostApi<Api> = 0 extends 1 & Api
  ? never
  : [SchemaOf<Api>] extends [never]
    ? never
    : string extends keyof SchemaOf<Api>
      ? never
      : Extract<keyof SchemaOf<Api>, keyof Standard> extends never
        ? never
        : InvalidPaths<SchemaOf<Api>> extends never
          ? Api
          : never

/** Checks whole standard route groups; partial groups expose no commands. */
export type HostState<Api> = Omit<FamiliarState, keyof Commands> & {
  account: Pick<FamiliarState['account'], 'state'> &
    Group<SchemaOf<Api>, Paths<`/account/${string}`>, Commands['account']>
  conversation: Pick<FamiliarState['conversation'], 'view' | 'history'> &
    Group<
      SchemaOf<Api>,
      keyof SchemaOf<ReturnType<typeof conversationRoutes>>,
      Pick<FamiliarState['conversation'], 'send' | 'abort' | 'loadOlder'>
    > &
    Group<
      SchemaOf<Api>,
      Paths<'/model' | `/model/${string}`>,
      Pick<
        Commands['conversation'],
        'modelOptions' | 'setModel' | 'setThinkingLevel'
      >
    >
  memory: Pick<FamiliarState['memory'], 'facts' | 'episodes'> &
    Group<SchemaOf<Api>, Paths<`/memory/${string}`>, Commands['memory']>
  schedules: Pick<FamiliarState['schedules'], 'items'> &
    Group<SchemaOf<Api>, Paths<`/schedules/${string}`>, Commands['schedules']>
} & Group<SchemaOf<Api>, Paths<`/push/${string}`>, Pick<Commands, 'push'>> &
  Group<
    SchemaOf<Api>,
    Paths<'/connections' | `/connections/${string}`>,
    Pick<Commands, 'connections'>
  > &
  Group<SchemaOf<Api>, Paths<'/mcp' | `/mcp/${string}`>, Pick<Commands, 'mcp'>>
