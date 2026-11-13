import { Type, type Static, type TSchema } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'

/**
 * Filing's and consolidation's single calls. Each tool only receives its
 * answer, which Pi has checked against the schema, and ends the run; the
 * pass reads the call back from the transcript and applies it in one commit
 * with its progress, so a model never writes memory directly.
 */

const optionalArray = <T extends TSchema>(item: T) =>
  Type.Optional(Type.Array(item))

const evidence = {
  m: Type.Array(Type.Integer(), {
    description: 'The numbers of the messages it rests on.',
  }),
  quote: Type.String({
    description: 'Words copied exactly from one of those messages.',
  }),
}

const day = (description: string) =>
  Type.Optional(Type.String({ description: `${description}, YYYY-MM-DD.` }))

export const FileArgs = Type.Object({
  subjects: optionalArray(
    Type.Union([
      Type.Object({
        ref: Type.String({
          description:
            'A temporary name for the new subject, which other operations in this call can use as its id.',
        }),
        kind: Type.Union([Type.Literal('person'), Type.Literal('topic')]),
        name: Type.String(),
        aliases: Type.Optional(Type.Array(Type.String())),
        line: Type.String({
          description: 'One line for the roster, such as "Maya\'s partner".',
        }),
      }),
      Type.Object({
        id: Type.String({ description: 'An existing subject, s….' }),
        name: Type.Optional(Type.String()),
        aliases: Type.Optional(Type.Array(Type.String())),
        line: Type.Optional(Type.String()),
      }),
    ]),
  ),
  notes: optionalArray(
    Type.Object({
      subject: Type.String({
        description: 'The subject it is about: an id, s…, or a new ref.',
      }),
      kind: Type.Union([
        Type.Literal('fact'),
        Type.Literal('preference'),
        Type.Literal('plan'),
        Type.Literal('lesson'),
      ]),
      text: Type.String(),
      mentions: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Other subjects it names, by id or ref.',
        }),
      ),
      since: day('When it became true'),
      until: day('When it stops or stopped being true'),
      ...evidence,
      replaces: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Notes, n…, this one replaces.',
        }),
      ),
    }),
  ),
  confirm: optionalArray(Type.Object({ note: Type.String(), ...evidence })),
  retire: optionalArray(
    Type.Object({
      note: Type.String(),
      reason: Type.Union([
        Type.Literal('contradicted'),
        Type.Literal('obsolete'),
      ]),
      ...evidence,
    }),
  ),
  journal: optionalArray(
    Type.Object({
      m: evidence.m,
      on: Type.String({ description: 'The day it happened, YYYY-MM-DD.' }),
      text: Type.String(),
      subjects: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Subjects it is about, by id or ref.',
        }),
      ),
      quote: evidence.quote,
    }),
  ),
})

export type FileArgs = Static<typeof FileArgs>

export const TidyArgs = Type.Object({
  profile: Type.String(),
  line: Type.Optional(Type.String()),
  merge: optionalArray(
    Type.Object({
      keep: Type.String(),
      drop: Type.Array(Type.String()),
    }),
  ),
  supersede: optionalArray(
    Type.Object({ old: Type.String(), by: Type.String() }),
  ),
})

export type TidyArgs = Static<typeof TidyArgs>

const done = {
  output: [{ type: 'text' as const, text: 'Received.' }],
  control: { terminate: true },
}

export const fileTool = defineTool({
  name: 'file',
  description:
    'Write what is worth keeping from these messages, all in one call: subjects, notes, confirmations, retirements and journal lines. Call it with nothing if nothing is.',
  parameters: FileArgs,
  execute: async () => done,
})

export const tidyTool = defineTool({
  name: 'tidy',
  description: "Tidy this page's notes and write its profile, in one call.",
  parameters: TidyArgs,
  execute: async () => done,
})
