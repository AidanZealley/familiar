/** At most `max` characters, ending in … when cut. */
export const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
