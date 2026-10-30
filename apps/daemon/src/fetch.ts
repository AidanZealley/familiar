import type { Readable } from 'node:stream'
import type { PluginFetch } from '@familiar/core'
import nodeFetch, { type RequestInit as NodeRequestInit } from 'node-fetch'
import { useAgent } from 'request-filtering-agent'

const MAX_REDIRECTS = 5

/** Statuses whose responses can't have a body. */
const NULL_BODY = new Set([101, 204, 205, 304])

/** Cancellation may race a pending read; never enqueue after the web stream closes. */
export function responseBody(source: Readable): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]()
  let cancelled = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next()
        if (cancelled) {
          return
        }
        if (done) {
          controller.close()
        } else {
          controller.enqueue(value as Uint8Array)
        }
      } catch (error) {
        if (!cancelled) {
          controller.error(error)
        }
      }
    },
    cancel() {
      cancelled = true
      source.destroy()
    },
  })
}

/**
 * The fetch plugins get. The daemon can reach the owner's LAN and tailnet, so
 * this refuses every address that isn't public unicast, checked on the
 * address each connection actually uses, and again on every redirect.
 * request-filtering-agent does the checking, as an http.Agent; Node's own
 * fetch can't take one, hence node-fetch, converted back to a web Response.
 */
export const guardedFetch: PluginFetch = async (input, init) => {
  const response = await nodeFetch(String(input), {
    ...(init as NodeRequestInit),
    agent: (url) => useAgent(url.href),
    follow: MAX_REDIRECTS,
  })
  const body =
    response.body && !NULL_BODY.has(response.status)
      ? responseBody(response.body as Readable)
      : null
  const converted = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers],
  })
  // Read-only on a constructed Response, but plugins need the final URL.
  Object.defineProperties(converted, {
    url: { value: response.url },
    redirected: { value: response.redirected },
  })
  return converted
}
