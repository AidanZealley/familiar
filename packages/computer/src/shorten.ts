/**
 * The most text one result gives the model. The host shortens each result
 * to it (`shorten`), only after removing saved passwords, so a cut never
 * leaves part of one.
 */
export const MAX_TEXT = 20_000

/**
 * The most text the computer collects for one result, to bound what it
 * sends: well over `MAX_TEXT`, so where it cuts, perhaps through a password,
 * is never in what the model sees.
 */
export const KEEP_TEXT = 2 * MAX_TEXT

/**
 * `text` cut to `MAX_TEXT` characters if longer, saying so: its start (a
 * page, a file), or its end (a command's output).
 */
export function shorten(text: string, keep: 'start' | 'end') {
  if (text.length <= MAX_TEXT) {
    return text
  }
  return keep === 'start'
    ? `${text.slice(0, MAX_TEXT)}\n[Shortened to its first ${MAX_TEXT} characters.]`
    : `[Shortened to its last ${MAX_TEXT} characters.]\n${text.slice(-MAX_TEXT)}`
}
