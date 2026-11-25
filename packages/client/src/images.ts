import type {
  IMAGE_LIMITS as CoreImageLimits,
  ImageErrorCode,
  ImageRef,
} from '@familiar-ai/core/http'

/**
 * What an image may be, as core takes it: typed against it, so a change
 * there is a type error here, without loading its runtime. The server
 * prepares each upload to fit; a client may shrink one first, to send less.
 */
export const IMAGE_LIMITS: typeof CoreImageLimits = {
  count: 10,
  bytes: 1_500_000,
  pixels: 1568,
  upload: 20 * 1024 * 1024,
}

/**
 * An upload that failed. `code` says why the server refused it, for the
 * host to word; without one, it didn't reach the server or its answer was
 * lost, and trying again may work.
 */
export class ImageUploadError extends Error {
  readonly code: ImageErrorCode | undefined
  constructor(message: string, code?: ImageErrorCode) {
    super(message)
    this.code = code
  }
}

export type UploadOptions = {
  /** Bytes sent so far, of `total`. Only without a custom `fetch`. */
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
}

/** The stored image a response answers with, or an ImageUploadError. */
const answer = (status: number, body: unknown): ImageRef => {
  if (status === 201) {
    return body as ImageRef
  }
  const { error, code } = (body ?? {}) as { error?: unknown; code?: unknown }
  throw new ImageUploadError(
    typeof error === 'string' ? error : `Upload failed: ${status}`,
    typeof code === 'string' ? (code as ImageErrorCode) : undefined,
  )
}

const unreached = () => new ImageUploadError('Upload failed: no response')

/**
 * Posts `blob` to `url` as an image upload. Through `fetch` when the host
 * gave one, so it sees every request; otherwise through XMLHttpRequest,
 * which reports progress as the bytes go.
 */
export async function uploadImage(
  url: string,
  blob: Blob,
  fetch: typeof globalThis.fetch | undefined,
  { onProgress, signal }: UploadOptions = {},
): Promise<ImageRef> {
  if (fetch || typeof XMLHttpRequest === 'undefined') {
    const response = await (fetch ?? globalThis.fetch)(url, {
      method: 'POST',
      body: blob,
      signal,
    }).catch((error: unknown) => {
      throw signal?.aborted ? error : unreached()
    })
    return answer(response.status, await response.json().catch(() => undefined))
  }
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url)
    request.responseType = 'json'
    request.upload.onprogress = (event) =>
      onProgress?.(event.loaded, event.total)
    request.onload = () => {
      try {
        resolve(answer(request.status, request.response))
      } catch (error) {
        reject(error)
      }
    }
    request.onerror = () => reject(unreached())
    request.onabort = () => reject(signal?.reason)
    signal?.addEventListener('abort', () => request.abort(), { once: true })
    request.send(blob)
  })
}
