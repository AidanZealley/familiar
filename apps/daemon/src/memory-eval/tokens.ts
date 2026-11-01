import type { Usage as ModelUsage } from '@earendil-works/pi-ai'
import type { Usage } from '@familiar-ai/core'

/** Token counts only: catalog prices say little about subscription use. */
export type Tokens = {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export const noTokens: Tokens = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
}

export function addTokens(a: Tokens, b: Tokens | ModelUsage): Tokens {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  }
}

export function subtractTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input - b.input,
    cacheRead: a.cacheRead - b.cacheRead,
    cacheWrite: a.cacheWrite - b.cacheWrite,
    output: a.output - b.output,
  }
}

/** Everything a Familiar has spent, across models and tools. */
export function tokensOf(usage: Usage): Tokens {
  return [...Object.values(usage.models), ...Object.values(usage.tools)].reduce(
    addTokens,
    noTokens,
  )
}
