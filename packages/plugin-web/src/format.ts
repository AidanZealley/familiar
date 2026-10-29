const pad = (value: number) => String(value).padStart(2, '0')

/** A time as `2026-10-28 14:05`, in local time, as Familiar writes times. */
export const timestamp = (at: number) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** At most `max` characters, ending in … when cut. */
export const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
