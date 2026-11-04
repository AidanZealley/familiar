import type { HttpApi, HttpOperations } from '@familiar-ai/core/http'
import type { ExtractSchema } from 'hono/types'
import type { Commands } from '../commands.ts'
import type { FamiliarState } from './types.ts'

type SchemaOf<Api> = ExtractSchema<Api>
type Standard = SchemaOf<HttpApi>

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

type Groups = keyof Commands & keyof HttpOperations

/** Commands whose own route the host mounts, by the operation's name. */
type Mounted<Api, Group extends Groups> = {
  [Name in keyof Commands[Group]]: Name extends keyof HttpOperations[Group]
    ? SchemaOf<Api> extends HttpOperations[Group][Name]
      ? Name
      : never
    : never
}[keyof Commands[Group]]
type Available<Api, Group extends Groups> = Pick<
  FamiliarState[Group],
  Mounted<Api, Group>
>
/** A whole group of commands, only when the host mounts any of them. */
type Present<Api, Group extends Groups> = [Mounted<Api, Group>] extends [never]
  ? unknown
  : { [Key in Group]: Available<Api, Group> }

/** Each command is there only when the host mounts its route. */
export type HostState<Api> = Omit<FamiliarState, keyof Commands> & {
  account: Pick<FamiliarState['account'], 'state'> & Available<Api, 'account'>
  conversation: Pick<FamiliarState['conversation'], 'view' | 'history'> &
    Available<Api, 'conversation'> &
    (SchemaOf<Api> extends HttpOperations['conversation']['history']
      ? Pick<FamiliarState['conversation'], 'loadOlder'>
      : unknown)
  memory: Pick<FamiliarState['memory'], 'facts' | 'episodes'> &
    Available<Api, 'memory'>
  schedules: Pick<FamiliarState['schedules'], 'items'> &
    Available<Api, 'schedules'>
} & Present<Api, 'push'> &
  Present<Api, 'connections'> &
  Present<Api, 'mcp'>
