import type { Redactor } from './redactor.ts'

/** Statuses whose responses cannot have a body. */
const NULL_BODY = new Set([101, 204, 205, 304])

/** Mask response headers and body before plugin code reads them. */
export async function maskResponse(
  response: Response,
  redactor: Redactor,
): Promise<Response> {
  const stream = redactor.stream()
  const body =
    response.body && !NULL_BODY.has(response.status)
      ? response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform: (chunk, controller) => {
              const safe = stream.push(chunk)
              if (safe.length > 0) {
                controller.enqueue(safe)
              }
            },
            flush: (controller) => {
              const rest = stream.end()
              if (rest.length > 0) {
                controller.enqueue(rest)
              }
            },
          }),
        )
      : null
  // Only what's checked crosses: header names and values, and no status
  // text, which is the service's to choose and rarely useful.
  const headers = new Headers()
  response.headers.forEach((value, name) => {
    if (redactor.text(name) === name) {
      headers.append(name, redactor.text(value))
    }
  })
  const redacted = new Response(body, {
    status: response.status,
    headers,
  })
  // Read-only on a constructed Response, but plugins need them.
  Object.defineProperties(redacted, {
    url: { value: response.url },
    redirected: { value: response.redirected },
  })
  return redacted
}
