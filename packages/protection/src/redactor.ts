/** Shorter values are too likely to appear in ordinary text. */
const REDACT_MIN_LENGTH = 8

const REDACTED = '[secret]'

const encoder = new TextEncoder()
const REDACTED_BYTES = encoder.encode(REDACTED)

const concat = (parts: readonly Uint8Array[]) => {
  const joined = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  )
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

const startsWithAt = (bytes: Uint8Array, value: Uint8Array, at: number) => {
  if (at + value.length > bytes.length) {
    return false
  }
  for (let i = 0; i < value.length; i++) {
    if (bytes[at + i] !== value[i]) {
      return false
    }
  }
  return true
}

/** `bytes` with each of `values` (longest first) replaced by `[secret]`. */
const redactBytes = (bytes: Uint8Array, values: readonly Uint8Array[]) => {
  const parts: Uint8Array[] = []
  let start = 0
  for (let at = 0; at < bytes.length;) {
    const value = values.find((value) => startsWithAt(bytes, value, at))
    if (value) {
      parts.push(bytes.subarray(start, at), REDACTED_BYTES)
      at += value.length
      start = at
    } else {
      at++
    }
  }
  parts.push(bytes.subarray(start))
  return concat(parts)
}

/** Tracks known values and masks text, JSON and streamed bytes. */
export function createRedactor() {
  const known = new Set<string>()
  const learn = (value: string | undefined) => {
    if (value !== undefined && value.length >= REDACT_MIN_LENGTH) {
      known.add(value)
    }
    return value
  }

  const redactString = (text: string) => {
    let redacted = text
    for (const value of known) {
      redacted = redacted.replaceAll(value, REDACTED)
    }
    return redacted
  }

  // Known values as bytes, longest first so one inside another is covered
  // whole; rebuilt only when a value is learned.
  let knownBytes: Uint8Array[] = []
  const currentBytes = () => {
    if (knownBytes.length !== known.size) {
      knownBytes = [...known]
        .map((value) => encoder.encode(value))
        .sort((a, b) => b.length - a.length)
    }
    return knownBytes
  }

  /**
   * Redacts a stream of bytes as it passes, holding back only enough to
   * catch a value split across chunks: one byte less than the longest value.
   * Each chunk is checked against the values known then, so a value learned
   * while the stream runs is caught too. `push` returns what's safe to pass
   * on; `end` returns the rest.
   */
  const redactStream = () => {
    let held = new Uint8Array(0)
    return {
      push: (chunk: Uint8Array) => {
        const values = currentBytes()
        const hold = Math.max(1, ...values.map((value) => value.length)) - 1
        const redacted = redactBytes(concat([held, chunk]), values)
        const cut = Math.max(0, redacted.length - hold)
        held = redacted.slice(cut)
        return redacted.subarray(0, cut)
      },
      end: () => {
        const rest = held
        held = new Uint8Array(0)
        return rest
      },
    }
  }

  // Generic, for the typed channels a tool reports on; all of them are JSON.
  // Keys too: a plugin may index results by an authenticated URL.
  const redactJson = <Value>(value: Value): Value => {
    if (typeof value === 'string') {
      return redactString(value) as Value
    }
    if (Array.isArray(value)) {
      return value.map(redactJson) as Value
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          redactString(key),
          redactJson(item),
        ]),
      ) as Value
    }
    return value
  }

  return {
    remember: learn,
    text: redactString,
    json: redactJson,
    stream: redactStream,
  }
}

export type Redactor = ReturnType<typeof createRedactor>
