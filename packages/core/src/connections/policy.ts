import { defineDoc, type Tx } from '@earendil-works/pi-durable'
import type { Connection } from './secrets.ts'

/**
 * Whether a connection's tool runs when the model calls it: at once, after
 * the person approves it, or never. Core's own tools always run.
 */
export type Policy = 'allow' | 'ask' | 'deny'

export const POLICIES: readonly Policy[] = ['allow', 'ask', 'deny']

/**
 * What a tool says about itself: MCP's tool annotations, which plugins'
 * tools declare too. Hints, not guarantees; the owner has the last word.
 */
export type ToolAnnotations = {
  readOnlyHint?: boolean
  destructiveHint?: boolean
}

/**
 * MCP's defaults: a tool that doesn't say it only reads, or that it's not
 * destructive, is treated as destructive, and asks.
 */
export const defaultPolicy = (annotations: ToolAnnotations | undefined) =>
  annotations?.readOnlyHint === true || annotations?.destructiveHint === false
    ? 'allow'
    : 'ask'

/** One connection's overrides: for every tool, and for each by its name there. */
type ConnectionPolicy = { all?: Policy; tools: Record<string, Policy> }

/** The owner's overrides, by connection (`<kind>:<name>`). */
export const ToolPolicies = defineDoc<Record<string, ConnectionPolicy>>({
  kind: 'familiar.tool-policies',
  version: 1,
  scope: 'session',
  initial: () => ({}),
  checkpointWhen: () => true, // small: always store it whole
})

const key = (connection: Connection) => `${connection.kind}:${connection.name}`

/**
 * A tool's policy: the owner's choice for it, if any, and what it does
 * without one: the choice for its connection, else what it says about itself.
 */
export function policyOf(
  policies: Readonly<Record<string, ConnectionPolicy>> | undefined,
  connection: Connection,
  tool: string,
  annotations: ToolAnnotations | undefined,
) {
  const set = policies?.[key(connection)]
  const chosen = set?.tools[tool]
  const fallback = set?.all ?? defaultPolicy(annotations)
  return {
    /** What applies. */
    policy: chosen ?? fallback,
    /** The owner's choice for this tool, if any. */
    chosen,
    /** What applies without it. */
    fallback,
  }
}

/** The owner's choice for all of a connection's tools, if any. */
export const connectionPolicy = (
  policies: Readonly<Record<string, ConnectionPolicy>> | undefined,
  connection: Connection,
) => policies?.[key(connection)]?.all

/**
 * Sets the owner's choice for `connection`'s `tool`, or for all its tools
 * without one; `null` clears it, back to the default.
 */
export async function setPolicy(
  tx: Tx,
  connection: Connection,
  tool: string | undefined,
  policy: Policy | null,
) {
  const policies = await tx.doc(ToolPolicies)
  policies[key(connection)] ??= { tools: {} }
  // Read back through the draft, which tracks changes; the literal doesn't.
  const set = policies[key(connection)]!
  if (tool === undefined) {
    if (policy) {
      set.all = policy
    } else {
      delete set.all
    }
  } else if (policy) {
    set.tools[tool] = policy
  } else {
    delete set.tools[tool]
  }
}
