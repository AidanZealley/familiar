import type { FamiliarSummary, Picked } from '@familiar-ai/client'

/** The `@name` being typed at the end of the text, if any: what to suggest for. */
export const mentionQuery = (text: string) =>
  /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1]

/** The text with the `@name` being typed replaced by the picked Familiar's. */
export const completeMention = (text: string, familiar: FamiliarSummary) =>
  text.replace(/@[^\s@]*$/, `@${familiar.name} `)

/**
 * The composed text as `composeMessage` takes it: each `@Name` of a
 * Familiar picked from the menu becomes a mention of it, so editing around
 * one keeps it. A name typed without picking it addresses no one.
 */
export const toParts = (
  text: string,
  picked: readonly FamiliarSummary[],
): (string | Picked)[] => {
  // Longest first, so `@Ann Lee` wins over `@Ann`.
  const names = picked.toSorted((a, b) => b.name.length - a.name.length)
  const parts: (string | Picked)[] = []
  let plain = ''
  for (let at = 0; at < text.length;) {
    const familiar =
      text[at] === '@' &&
      /^\s?$/.test(text[at - 1] ?? '') &&
      names.find(
        ({ name }) =>
          text.startsWith(name, at + 1) &&
          !/\w/.test(text[at + 1 + name.length] ?? ''),
      )
    if (familiar) {
      parts.push(plain, {
        kind: 'familiar',
        id: familiar.id,
        name: familiar.name,
      })
      plain = ''
      at += familiar.name.length + 1
    } else {
      plain += text[at]
      at += 1
    }
  }
  return [...parts, plain].filter((part) => part !== '')
}
