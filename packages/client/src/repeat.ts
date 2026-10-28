// rrule's ES module build has no default export.
import { rrulestr } from 'rrule'

/**
 * A repeat's pattern in words, such as "Every weekday", without its time:
 * rrule writes times as hours alone ("at 7"), and the next time shown
 * beside it says when anyway.
 */
export const repeatText = (repeat: string) => {
  const text = rrulestr(repeat.replace(/^RRULE:/i, ''))
    .toText()
    .replace(/ at \d+(?:(?:, | and )\d+)*/, '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
