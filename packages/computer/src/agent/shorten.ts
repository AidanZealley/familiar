/** The most text one result gives the model. */
export const MAX_TEXT = 20_000

/**
 * `text`, cut to `MAX_TEXT` characters if longer, keeping its start (a page,
 * a file) or its end (a command's output, where errors land), and saying so.
 */
export function shorten(text: string, keep: 'start' | 'end') {
  if (text.length <= MAX_TEXT) {
    return text
  }
  const note = `[Shortened: ${text.length - MAX_TEXT} of ${text.length} characters left out.]`
  return keep === 'start'
    ? `${text.slice(0, MAX_TEXT)}\n${note}`
    : `${note}\n${text.slice(-MAX_TEXT)}`
}
