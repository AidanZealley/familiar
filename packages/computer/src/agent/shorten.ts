/** The most text one result gives the model. */
export const MAX_TEXT = 20_000

/** Says how much of `total` characters a shortened result left out. */
export const shortenedNote = (total: number) =>
  `[Shortened: ${total - MAX_TEXT} of ${total} characters left out.]`

/**
 * `text` (a page, a file), cut to its first `MAX_TEXT` characters if longer,
 * saying so. Command output keeps its end instead (see `runCommand`).
 */
export function shorten(text: string) {
  return text.length <= MAX_TEXT
    ? text
    : `${text.slice(0, MAX_TEXT)}\n${shortenedNote(text.length)}`
}
