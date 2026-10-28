/**
 * How a browser picks a page's encoding (WHATWG HTML, "determining the
 * character encoding"), cut to what a reader needs: a byte order mark, then
 * the charset in the `Content-Type` header, then for HTML a `<meta>` in the
 * first 1,024 bytes, then UTF-8.
 */

const BOMS: [number[], string][] = [
  [[0xef, 0xbb, 0xbf], 'utf-8'],
  [[0xfe, 0xff], 'utf-16be'],
  [[0xff, 0xfe], 'utf-16le'],
]

const PRESCAN_BYTES = 1024

/** The encoding a label names, or undefined if TextDecoder doesn't know it. */
function encoding(label: string | undefined) {
  if (!label) {
    return undefined
  }
  try {
    return new TextDecoder(label.trim()).encoding
  } catch {
    return undefined
  }
}

const bom = (bytes: Uint8Array) =>
  BOMS.find(([marks]) => marks.every((mark, i) => bytes[i] === mark))?.[1]

/** The charset in a `Content-Type` value: `text/html; charset="utf-8"`. */
const headerCharset = (contentType: string) =>
  /;\s*charset\s*=\s*(?:"([^"]*)"|([^;\s]*))/i
    .exec(contentType)
    ?.slice(1)
    .find(Boolean)

const isSpace = (char: string) => /^[\t\n\f\r ]$/.test(char)
const isLetter = (char: string) => /^[a-z]$/i.test(char)
const lower = (char: string) =>
  char >= 'A' && char <= 'Z' ? char.toLowerCase() : char

/**
 * The charset a `<meta content>` names, as in `text/html; charset=…` (WHATWG
 * HTML, "extracting a character encoding from a meta element").
 */
function contentCharset(content: string) {
  let at = 0
  for (;;) {
    const found = content.toLowerCase().indexOf('charset', at)
    if (found < 0) {
      return undefined
    }
    at = found + 'charset'.length
    while (isSpace(content[at] ?? '')) {
      at++
    }
    if (content[at] !== '=') {
      continue
    }
    at++
    while (isSpace(content[at] ?? '')) {
      at++
    }
    const quote = content[at]
    if (quote === '"' || quote === "'") {
      const end = content.indexOf(quote, at + 1)
      return end < 0 ? undefined : content.slice(at + 1, end)
    }
    return /^[^\t\n\f\r ;]*/.exec(content.slice(at))![0] || undefined
  }
}

/**
 * The charset a `<meta>` in the first 1,024 bytes declares, read as the
 * WHATWG HTML prescan reads them ("prescan a byte stream to determine its
 * encoding"): it skips comments, quoted attribute values and other tags, so
 * a `>` in an attribute or a `<meta` inside one can't mislead it.
 */
function metaCharset(bytes: Uint8Array) {
  // One character per byte; only ASCII matters.
  const page = String.fromCharCode(...bytes.subarray(0, PRESCAN_BYTES))
  let at = 0
  const startsWith = (text: string) =>
    page.slice(at, at + text.length).toLowerCase() === text

  /** The next attribute, null at the tag's end, or undefined at the input's. */
  const attribute = (): [string, string] | null | undefined => {
    while (isSpace(page[at] ?? '') || page[at] === '/') {
      at++
    }
    if (page[at] === '>') {
      return null
    }
    let name = ''
    let value = ''
    for (;;) {
      const char = page[at]
      if (char === undefined) {
        return undefined
      }
      if (char === '=' && name) {
        at++
        break
      }
      if (isSpace(char)) {
        while (isSpace(page[at] ?? '')) {
          at++
        }
        if (page[at] !== '=') {
          return [name, '']
        }
        at++
        break
      }
      if (char === '/' || char === '>') {
        return [name, '']
      }
      name += lower(char)
      at++
    }
    while (isSpace(page[at] ?? '')) {
      at++
    }
    const quote = page[at]
    if (quote === '"' || quote === "'") {
      for (at++; ; at++) {
        const char = page[at]
        if (char === undefined) {
          return undefined
        }
        if (char === quote) {
          at++
          return [name, value]
        }
        value += lower(char)
      }
    }
    if (quote === '>') {
      return [name, '']
    }
    for (;;) {
      const char = page[at]
      if (char === undefined) {
        return undefined
      }
      if (isSpace(char) || char === '>') {
        return [name, value]
      }
      value += lower(char)
      at++
    }
  }

  for (; at < page.length; at++) {
    if (startsWith('<!--')) {
      // The end of the first `-->`, whose dashes may be the opening's.
      const end = page.indexOf('-->', at + 2)
      if (end < 0) {
        return undefined
      }
      at = end + 2
    } else if (startsWith('<meta') && /[\t\n\f\r /]/.test(page[at + 5] ?? '')) {
      at += 5
      const names = new Set<string>()
      let pragma = false
      let needsPragma: boolean | undefined
      let charset: string | undefined
      for (let next = attribute(); next; next = attribute()) {
        const [name, value] = next
        if (names.has(name)) {
          continue
        }
        names.add(name)
        if (name === 'http-equiv') {
          pragma ||= value === 'content-type'
        } else if (name === 'content') {
          const declared = contentCharset(value)
          if (declared && charset === undefined) {
            charset = declared
            needsPragma = true
          }
        } else if (name === 'charset') {
          charset = value
          needsPragma = false
        }
      }
      if (at >= page.length) {
        return undefined
      }
      const found =
        needsPragma === true && !pragma ? undefined : encoding(charset)
      if (found) {
        // A page can't be UTF-16 if its markup reads as ASCII, and
        // x-user-defined means windows-1252 here, as the spec says.
        return found.startsWith('utf-16')
          ? 'utf-8'
          : found === 'x-user-defined'
            ? 'windows-1252'
            : found
      }
    } else if (
      (page[at] === '<' && isLetter(page[at + 1] ?? '')) ||
      (startsWith('</') && isLetter(page[at + 2] ?? ''))
    ) {
      // Another tag: past its name, then each attribute, quotes and all.
      while (at < page.length && !/[\t\n\f\r >]/.test(page[at])) {
        at++
      }
      let next = attribute()
      while (next) {
        next = attribute()
      }
      if (next === undefined) {
        return undefined
      }
    } else if (startsWith('<!') || startsWith('</') || startsWith('<?')) {
      const end = page.indexOf('>', at + 2)
      if (end < 0) {
        return undefined
      }
      at = end
    }
  }
  return undefined
}

/**
 * A body as text, in the encoding a browser would choose. Labels TextDecoder
 * doesn't support, which a Worker may not for legacy encodings, fall back to
 * UTF-8, which most pages are anyway.
 */
export function decode(
  bytes: Uint8Array,
  contentType: string,
  { html }: { html: boolean },
) {
  const chosen =
    bom(bytes) ??
    encoding(headerCharset(contentType)) ??
    (html ? metaCharset(bytes) : undefined) ??
    'utf-8'
  return new TextDecoder(chosen).decode(bytes)
}
