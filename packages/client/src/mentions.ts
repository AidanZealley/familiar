import type { Mention } from '@familiar-ai/core/http'

/** Someone picked in the composer, such as from an `@` menu. */
export type Picked = {
  kind: Mention['kind']
  /** A Familiar's ID, or a person's host author ID. */
  id: string | number
  /** The name shown after `@`. */
  name: string
}

/**
 * A message from what was composed: text as typed, and people or Familiars
 * picked, in order. Each pick becomes `@Name` in the text, with a mention
 * spanning it, so the text reads naturally and the server knows whom it
 * addresses. Typing `@Name` without picking it addresses no one.
 */
export function composeMessage(parts: readonly (string | Picked)[]): {
  text: string
  mentions: Mention[]
} {
  let text = ''
  const mentions: Mention[] = []
  for (const part of parts) {
    if (typeof part === 'string') {
      text += part
      continue
    }
    const start = text.length
    text += `@${part.name}`
    mentions.push({
      kind: part.kind,
      id: String(part.id),
      start,
      end: text.length,
    })
  }
  return { text, mentions }
}
