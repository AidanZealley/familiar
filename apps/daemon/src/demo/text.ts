export const textOf = (content: string | readonly object[] | undefined) =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .map((part) => ('text' in part ? String(part.text) : ''))
        .join('')
