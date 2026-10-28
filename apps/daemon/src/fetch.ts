import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { PluginFetch } from '@familiar/core'
import nodeFetch, { type RequestInit as NodeRequestInit } from 'node-fetch'
import { useAgent } from 'request-filtering-agent'

const MAX_REDIRECTS = 5

/** Statuses whose responses can't have a body. */
const NULL_BODY = new Set([101, 204, 205, 304])

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
      ? (Readable.toWeb(
          response.body as Readable,
        ) as NodeReadableStream<Uint8Array> as ReadableStream<Uint8Array>)
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
