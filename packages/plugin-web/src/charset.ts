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

// Attributes as the prescan reads them: a name, then an optional quoted or
// unquoted value.
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

/** The charset a `<meta content>` names, as in `text/html; charset=…`. */
const contentCharset = (content: string) =>
  /charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;"']+))/i
    .exec(content)
    ?.slice(1)
    .find(Boolean)

/** The charset a `<meta>` in the first 1,024 bytes declares. */
function metaCharset(bytes: Uint8Array) {
  // Any ASCII-compatible decoding reads the markup the same.
  const head = new TextDecoder('windows-1252')
    .decode(bytes.subarray(0, PRESCAN_BYTES))
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
  for (const [, attributes] of head.matchAll(/<meta[\s/]([^>]*)>/gi)) {
    const values = new Map<string, string>()
    for (const [, name, ...value] of attributes.matchAll(ATTRIBUTE)) {
      const key = name.toLowerCase()
      if (!values.has(key)) {
        values.set(key, value.find((part) => part !== undefined) ?? '')
      }
    }
    const declared =
      values.get('charset') ??
      (values.get('http-equiv')?.toLowerCase() === 'content-type'
        ? contentCharset(values.get('content') ?? '')
        : undefined)
    const found = encoding(declared)
    if (found) {
      // A page can't be UTF-16 if its markup reads as ASCII, and
      // x-user-defined means windows-1252 here, as the spec says.
      return found.startsWith('utf-16')
        ? 'utf-8'
        : found === 'x-user-defined'
          ? 'windows-1252'
          : found
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
