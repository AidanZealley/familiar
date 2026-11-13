import { formatDay, parseDay } from '../time.ts'

/**
 * The days a message names, for searches that filter by date. Only explicit
 * dates count: ordinary words like "may" or a passing number never become
 * dates, so search stays unfiltered for them.
 */

const MONTHS =
  'january february march april may june july august september october november december'.split(
    ' ',
  )
const MONTH = `(${MONTHS.join('|')})`
const ORDINAL = '(?:st|nd|rd|th)?'

export type DateRange = { start: string; end: string }

/**
 * The days and months a message names, such as "in March", "4 March 2025",
 * "March 4" or "2025-03-04", resolved to their most recent past occurrence
 * when no year is given. Only explicit dates count: ordinary words like "may"
 * or a passing number never become dates, so recall stays quiet for them.
 */
export function datesIn(text: string, today: string): DateRange[] {
  const ranges: DateRange[] = []
  const now = parseDay(today)
  const monthOf = (name: string) => MONTHS.indexOf(name.toLowerCase())

  // The given year, or the most recent one in which that date has started.
  const yearOf = (given: string | undefined, month: number, date = 1) => {
    if (given) {
      return Number(given)
    }

    const thisYear = new Date(Date.UTC(now.getUTCFullYear(), month, date))
    return thisYear > now ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
  }

  const addDay = (year: number, month: number, date: number) => {
    const at = new Date(Date.UTC(year, month, date))

    // Rejects dates like 31 February rather than rolling them over.
    if (at.getUTCMonth() !== month) {
      return
    }

    ranges.push({ start: formatDay(at), end: formatDay(at) })
  }

  const addMonth = (year: number, month: number) =>
    ranges.push({
      start: formatDay(new Date(Date.UTC(year, month, 1))),
      end: formatDay(new Date(Date.UTC(year, month + 1, 0))),
    })

  // 2025-03-04
  for (const [, year, month, date] of text.matchAll(
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  )) {
    addDay(Number(year), Number(month) - 1, Number(date))
  }

  // 4 March, 4th of March 2025
  for (const [, date, name, year] of text.matchAll(
    new RegExp(
      `\\b(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH}\\b(?:,?\\s+(\\d{4}))?`,
      'gi',
    ),
  )) {
    const month = monthOf(name)
    addDay(yearOf(year, month, Number(date)), month, Number(date))
  }

  // March 4, March 4th, 2025
  for (const [, name, date, year] of text.matchAll(
    new RegExp(
      `\\b${MONTH}\\s+(\\d{1,2})${ORDINAL}\\b(?:,?\\s+(\\d{4}))?`,
      'gi',
    ),
  )) {
    const month = monthOf(name)
    addDay(yearOf(year, month, Number(date)), month, Number(date))
  }

  // March 2025
  for (const [, name, year] of text.matchAll(
    new RegExp(`\\b${MONTH}\\s+(\\d{4})\\b`, 'gi'),
  )) {
    addMonth(Number(year), monthOf(name))
  }

  // A month after a word that makes it one: "in March", "early March",
  // "since May". A bare "may" is a verb far more often.
  for (const [, name] of text.matchAll(
    new RegExp(
      `\\b(?:in|during|throughout|since|until|by|of|early|late|mid|last|this|next)\\s+(?:early\\s+|late\\s+|mid-?\\s*)?${MONTH}\\b(?!\\s+\\d)`,
      'gi',
    ),
  )) {
    const month = monthOf(name)
    addMonth(yearOf(undefined, month), month)
  }

  return ranges
}

/** Whether two spans of days share at least one. */
export const overlaps = (a: DateRange, b: DateRange) =>
  a.start <= b.end && b.start <= a.end

/** The month a day is in, `YYYY-MM`. */
export const monthOf = (day: string) => day.slice(0, 7)
